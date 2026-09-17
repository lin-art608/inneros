# -*- coding: utf-8 -*-
"""桌宠素材构建脚本（可复现）。

背景：仓库此前发的是 200x250 的优化 PNG，而桌面版素材原生就是 400x500，
在大屏/高分屏上必然发虚。本脚本把桌面素材源（原生 400x500 RGBA 序列帧）
重导为网页用的 400x500 WebP：

  1. 原样重导：dance(64) / feed(8) / jump(8) / wave(8)
  2. idle 默认重建为"静息呼吸环"：源 idle 8 帧是 8 个互不一致的 AI 姿势
     （相邻帧 RGB 平均绝对差 10~36、剪影宽度 211~230），连播就是"一直晃"。
     改为取 8 帧中位代表帧（medoid，与其余帧差异最小）做 8 步低频呼吸位移。
     传 --idle-mode source 可退回源 idle 帧原样导出。
  3. 微动作（无新素材，纯几何形变，全部叠在原图上 → 不会破洞）：
     blink 眨眼近似（头部带整体下沉 4px，4 帧）/ tidy 整理衣服近似
     （上半身带侧向微移 3px，6 帧）。素材里没有闭眼帧，二者是形变近似。

命名规则不变：{action}/{action}_{i}.webp（不补零）。

用法：
  python tools/build_pet_assets.py                       # 用默认源目录
  python tools/build_pet_assets.py --src <actions目录>
  python tools/build_pet_assets.py --idle-mode source    # idle 退回源帧
"""
import argparse
import io
import math
import os
import shutil
import sys

from PIL import Image

DEFAULT_SRC = r"C:\Users\HONOR\Desktop\工作文件夹\Trae work\桌宠\v10\assets\actions"
COPY_ACTIONS = ("dance", "feed", "jump", "wave")
IDLE_FRAMES = 8
# 呼吸位移（正数=向上，单位=原生像素）；8 帧一个循环，振幅 3px ≈ 画布高度 0.6%
BREATH_DY = (0, 1, 2, 3, 3, 2, 1, 1)
BLINK_DY = (0, 4, 4, 0)        # 头部带下沉
TIDY_DX = (0, -2, -3, -3, -2, 0)  # 上半身带侧移
HEAD_BAND = 0.32               # 头部带下沿 = bbox 顶部 + 32% 身高
HIP_BAND = 0.62                # 上半身带下沿 = bbox 顶部 + 62% 身高


def log(msg):
    sys.stdout.write(msg + "\n")


def load_frames(src_dir, action):
    """读取某动作的全部源帧，按帧序返回 [(index, Image)]。

    桌面版素材是**平铺**放的（actions/dance_000.png、actions/idle_0.png …），
    也兼容每个动作一个子目录的布局。源命名可能补零，按整数序重排。
    """
    d = os.path.join(src_dir, action)
    if not os.path.isdir(d):
        d = src_dir  # 平铺布局
    if not os.path.isdir(d):
        raise SystemExit("找不到源目录：%s" % d)
    items = []
    for name in os.listdir(d):
        if not name.lower().endswith(".png"):
            continue
        stem = os.path.splitext(name)[0]
        if not stem.startswith(action + "_"):
            continue
        try:
            idx = int(stem[len(action) + 1:])
        except ValueError:
            continue
        items.append((idx, os.path.join(d, name)))
    items.sort()
    if not items:
        raise SystemExit("目录里没有 %s_*.png：%s" % (action, d))
    return [(i, Image.open(p).convert("RGBA")) for i, p in items]


def bbox_of(img):
    return img.getchannel("A").point(lambda v: 255 if v > 8 else 0).getbbox()


def mean_abs_diff(a, b):
    """两帧 RGB 平均绝对差（整张画布，含透明区 RGB=0）。"""
    pa = a.convert("RGB").tobytes()
    pb = b.convert("RGB").tobytes()
    step = 173  # 质数步长，抽样即可
    total = 0
    n = 0
    for i in range(0, len(pa) - 3, step):
        total += abs(pa[i] - pb[i]) + abs(pa[i + 1] - pb[i + 1]) + abs(pa[i + 2] - pb[i + 2])
        n += 3
    return total / float(n) if n else 0.0


def medoid(frames):
    """与其余帧平均差异最小的那一帧 → 最能代表整组姿势的一帧。"""
    if len(frames) == 1:
        return 0, 0.0
    best_i, best_d = 0, None
    for i in range(len(frames)):
        d = sum(mean_abs_diff(frames[i], frames[j]) for j in range(len(frames)) if j != i)
        d /= (len(frames) - 1)
        if best_d is None or d < best_d:
            best_i, best_d = i, d
    return best_i, best_d


def eye_darkness(img, box):
    """头部带内的暗像素占比（近似眼睛/眉毛/头发暗部量，供人工判断是否有闭眼帧）。"""
    top, bottom = box[1], box[3]
    head = img.crop((box[0], top, box[2], top + int((bottom - top) * HEAD_BAND)))
    gray = head.convert("L")
    px = gray.load()
    alpha = head.getchannel("A").load()
    w, h = head.size
    dark = solid = 0
    for y in range(h):
        for x in range(w):
            if alpha[x, y] > 128:
                solid += 1
                if px[x, y] < 70:
                    dark += 1
    return (dark / float(solid)) if solid else 0.0


def report_idle(frames, box):
    """打印源 idle 帧的抖动量化 + 暗部占比：给"为什么一直晃"和"有没有闭眼帧"留证据。"""
    log("  源 idle 帧差异矩阵（相邻帧 RGB 平均绝对差，越大越晃）：")
    for i in range(len(frames)):
        j = (i + 1) % len(frames)
        w_i = bbox_of(frames[i])[2] - bbox_of(frames[i])[0]
        log("    idle_%d→idle_%d = %6.2f   （idle_%d 剪影宽 %d）"
            % (i, j, mean_abs_diff(frames[i], frames[j]), i, w_i))
    log("  源 idle 帧头部带暗像素占比（明显偏低者可能是闭眼/低头的帧）：")
    for i, f in enumerate(frames):
        log("    idle_%d = %.2f%%" % (i, eye_darkness(f, box) * 100))


def breath_frames(base):
    """静息呼吸：整幅上移 0~3px，足部随之抬起（站姿呼吸的自然表现）。"""
    out = []
    w, h = base.size
    for dy in BREATH_DY:
        canvas = Image.new("RGBA", (w, h), (0, 0, 0, 0))
        canvas.alpha_composite(base, (0, -dy))
        out.append(canvas)
    return out


def band_shift(base, box, split_ratio, offsets, axis):
    """把 [bbox顶, 分界线] 的带状区域整体平移，叠在原图上（不挖洞）。"""
    top = box[1]
    split = top + int((box[3] - top) * split_ratio)
    band = base.crop((0, top, base.width, split))
    out = []
    for off in offsets:
        canvas = base.copy()
        dx, dy = (off, 0) if axis == "x" else (0, off)
        canvas.alpha_composite(band, (dx, top + dy))
        out.append(canvas)
    return out


def save_frames(out_dir, action, frames, quality):
    d = os.path.join(out_dir, action)
    if os.path.isdir(d):
        shutil.rmtree(d)
    os.makedirs(d)
    total = 0
    for i, img in enumerate(frames):
        path = os.path.join(d, "%s_%d.webp" % (action, i))
        buf = io.BytesIO()
        img.save(buf, "WEBP", quality=quality, method=6)
        data = buf.getvalue()
        with open(path, "wb") as f:
            f.write(data)
        total += len(data)
    n = len(frames)
    log("  %-6s %2d 帧  %6.0f KB（均 %.1f KB/帧）" % (action, n, total / 1024.0, total / 1024.0 / n))
    return total, n


def dir_size(d):
    total = n = 0
    for root, _dirs, files in os.walk(d):
        for f in files:
            if f.lower().endswith(".png"):
                total += os.path.getsize(os.path.join(root, f))
                n += 1
    return total, n


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--src", default=DEFAULT_SRC, help="桌面版 actions 素材目录")
    ap.add_argument("--out", default=os.path.join(os.path.dirname(os.path.dirname(
        os.path.abspath(__file__))), "assets", "pet"), help="输出目录")
    ap.add_argument("--quality", type=int, default=92, help="WebP 质量")
    ap.add_argument("--idle-mode", choices=("breathe", "source"), default="breathe")
    args = ap.parse_args()

    if not os.path.isdir(args.src):
        raise SystemExit("素材源不存在：%s" % args.src)
    if not os.path.isdir(args.out):
        os.makedirs(args.out)

    old_bytes, old_n = dir_size(args.out)
    log("源：%s" % args.src)
    log("输出：%s（WebP q%d）" % (args.out, args.quality))
    if old_n:
        log("旧素材：%d 帧 PNG，合计 %.1f MB（构建后请删除）" % (old_n, old_bytes / 1024.0 / 1024.0))
    log("")

    grand = 0
    count = 0

    for action in COPY_ACTIONS:
        frames = [f for _i, f in load_frames(args.src, action)]
        b, c = save_frames(args.out, action, frames, args.quality)
        grand += b
        count += c

    src_idle = [f for _i, f in load_frames(args.src, "idle")]
    box = bbox_of(src_idle[0])
    report_idle(src_idle, box)
    log("")

    if args.idle_mode == "source":
        log("idle：源帧原样导出（--idle-mode source）")
        idle = src_idle
    else:
        mid, avg = medoid(src_idle)
        log("idle：以 medoid 帧 idle_%d（与其余帧平均差 %.2f，最小）为基帧，生成 %d 步呼吸环"
            % (mid, avg, IDLE_FRAMES))
        idle = breath_frames(src_idle[mid])
    b, c = save_frames(args.out, "idle", idle, args.quality)
    grand += b
    count += c

    log("")
    log("微动作（几何形变近似，源素材无对应帧）：")
    base = idle[0]
    b, c = save_frames(args.out, "blink", band_shift(base, box, HEAD_BAND, BLINK_DY, "y"), args.quality)
    grand += b
    count += c
    b, c = save_frames(args.out, "tidy", band_shift(base, box, HIP_BAND, TIDY_DX, "x"), args.quality)
    grand += b
    count += c

    log("")
    log("合计 %d 帧 / %.2f MB" % (count, grand / 1024.0 / 1024.0))
    if old_n:
        log("对比旧 PNG：%d 帧 / %.2f MB → 帧数 %+d，体积 %+.2f MB，像素数为旧版的 4 倍（400x500 vs 200x250）"
            % (old_n, old_bytes / 1024.0 / 1024.0, count - old_n, (grand - old_bytes) / 1024.0 / 1024.0))
    log("")
    log("下一步：确认 assets/pet/**.png 已删除，再跑 node --check app.js 与 bash tests/run-all.sh")


if __name__ == "__main__":
    main()
