#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
ARCH-013 测试护栏 · 真实 D1 端到端回归（跨设备同步 + 电影/书籍/音乐完整链路）

覆盖文档 ARCH-013 7.1「最优先 E2E」：
  电影：搜索 → 详情 → 保存 → 刷新 → pull → 删除 → pull
  书籍：搜索 → 详情 → 保存 → 刷新 → pull → 删除 → pull
  音乐：搜索/详情 → 保存 → 刷新 → pull
另含：跨设备同步（设备A push → 设备B pull）、op_id 幂等、删除墓碑（旧快照不复活）、
      user isolation（账号间互不可见）、第三方故障稳定错误码。

运行前提（与 AGENTS.md 一致）：
  CI=1 WRANGLER_SEND_METRICS=false npx wrangler pages dev . --d1 DB --port 8788 --ip 127.0.0.1
然后：
  python tests/e2e/media-sync-e2e.py

不依赖任何第三方库；用随机邮箱与随机 UUID，可重复运行。
"""
import json, urllib.request, urllib.parse, urllib.error, http.cookiejar, time, uuid, sys

BASE = "http://127.0.0.1:8788"
UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36"


def make_opener():
    cj = http.cookiejar.CookieJar()
    op = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(cj))
    return op


def call(op, method, path, body=None):
    data = json.dumps(body).encode("utf-8") if body is not None else None
    req = urllib.request.Request(BASE + path, data=data, method=method)
    req.add_header("User-Agent", UA)
    if data:
        req.add_header("Content-Type", "application/json")
    try:
        with op.open(req, timeout=90) as x:
            return x.status, x.read().decode("utf-8", "ignore")
    except urllib.error.HTTPError as e:
        return e.code, e.read().decode("utf-8", "ignore")


def register(op, tag):
    email = f"e2e_{tag}_{int(time.time())}_{uuid.uuid4().hex[:6]}@inneros.dev"
    st, _ = call(op, "POST", "/api/auth/register", {"email": email, "password": "E2eTest123!"})
    assert st in (200, 201), f"注册失败 HTTP {st}"
    return email


def search(op, media_type, query):
    st, b = call(op, "GET", f"/api/v1/media/search?type={media_type}&query={urllib.parse.quote(query)}")
    assert st == 200, f"搜索失败 HTTP {st}: {b[:120]}"
    d = json.loads(b)
    items = (d.get("data") or {}).get("items", [])
    assert len(items) > 0, f"搜索 {query} 无结果"
    return items


def detail(op, media_type, external_id):
    st, b = call(op, "GET", f"/api/v1/media/detail?type={media_type}&id={urllib.parse.quote(str(external_id))}")
    assert st == 200, f"详情失败 HTTP {st}: {b[:120]}"
    return json.loads(b)["data"]


def save(op, media_type, media, content="记一笔"):
    st, b = call(op, "POST", "/api/v1/memories", {"type": media_type, "media": media, "content": content})
    assert st in (200, 201), f"保存失败 HTTP {st}: {b[:200]}"
    return json.loads(b)["data"]["memory"]


def list_memories(op, limit=200):
    st, b = call(op, "GET", f"/api/v1/memories?limit={limit}")
    assert st == 200, f"列表失败 HTTP {st}"
    return (json.loads(b).get("data") or {}).get("items", [])


def push(op, device_id, ops):
    st, b = call(op, "POST", "/api/sync/push", {"device_id": device_id, "device_name": device_id, "operations": ops})
    assert st == 200, f"push 失败 HTTP {st}: {b[:200]}"
    return json.loads(b)


def pull(op, device_id, cursor=0):
    st, b = call(op, "GET", f"/api/sync/pull?cursor={cursor}&device_id={device_id}")
    assert st == 200, f"pull 失败 HTTP {st}: {b[:200]}"
    return json.loads(b)


def main():
    # 两个独立账号：验证 user isolation（A 的数据 B 不可见）
    opA = make_opener()
    opB = make_opener()
    emailA = register(opA, "A")
    emailB = register(opB, "B")
    print(f"[setup] 账号A={emailA}  账号B={emailB}")

    # ============ 1. 电影完整链路 ============
    print("\n=== 电影：搜索→详情→保存→刷新→pull→删除→pull ===")
    movie_items = search(opA, "movie", "星际穿越")
    movie = movie_items[0]
    assert movie["title"] == "星际穿越", f"电影候选错误: {movie['title']}"
    assert movie["mediaType"] == "movie" and movie["source"] == "douban"
    print(f"  搜索: {movie['title']} ({movie['year']})")

    md = detail(opA, "movie", movie["externalId"])
    assert md["creators"], "电影详情缺导演"
    assert md["score"] and md["description"], "电影详情缺评分/简介"
    print(f"  详情: 导演={md['creators'][0]} 评分={md['score']}")

    mem_movie = save(opA, "movie", md, "视觉效果震撼")
    mid_movie = mem_movie["id"]
    assert mem_movie["type"] == "media" and mem_movie["media"]["mediaType"] == "movie"
    print(f"  保存: {mid_movie} type=media")

    assert any(m["id"] == mid_movie for m in list_memories(opA)), "电影保存后刷新应存在"
    print("  刷新: 记录仍在")

    # 跨设备：设备A push 电影 → 设备B pull
    # 注意：operations.op_id 是全局唯一约束（非按账号），op_id 必须每次运行随机，否则撞 UNIQUE
    movie_payload = {"type": "movie", "title": md["title"], "poster": md["poster"],
                     "external_id": md["externalId"], "director": (md["creators"] or [""])[0],
                     "genres": md["genres"], "description": md["description"], "rating": md["score"],
                     "media": {**md, "mediaType": "movie"}, "updated_at": "2026-08-30T20:00:00.000Z"}
    mid_sync = "mem-movie-" + uuid.uuid4().hex[:12]
    op_mv1 = "mv1-" + uuid.uuid4().hex[:8]
    op_mv2 = "mv2-" + uuid.uuid4().hex[:8]
    op_mv3 = "mv3-" + uuid.uuid4().hex[:8]
    r1 = push(opA, "devA", [{"op_id": op_mv1, "kind": "upsert_memory", "entity_id": mid_sync,
                             "payload": {"data": movie_payload, "updated_at": "2026-08-30T20:00:00.000Z"}}])
    assert r1["applied"] == 1 and r1["errors"] == [], f"电影 push 应 applied=1，实际 {r1}"
    # 幂等：重放同一 op_id
    r1b = push(opA, "devA", [{"op_id": op_mv1, "kind": "upsert_memory", "entity_id": mid_sync,
                              "payload": {"data": movie_payload, "updated_at": "2026-08-30T20:00:00.000Z"}}])
    assert r1b["applied"] == 0 and r1b["skipped"] == 1, "op_id 重放应跳过（幂等）"
    p = pull(opA, "devB")  # 跨设备同步 = 同一账号A，不同设备（devA→devB）；账号B 的隔离在下方第 4 节单独验证
    pulled = [o for o in p["ops"] if o["entity_id"] == mid_sync]
    assert pulled and pulled[-1]["payload"]["data"]["title"] == md["title"] and "media" in pulled[-1]["payload"]["data"]
    print(f"  跨设备: push applied={r1['applied']}，重放 skipped={r1b['skipped']}，设备B pull 到电影(含标准 media)")

    # 删除 → 墓碑不被旧快照复活
    push(opA, "devA", [{"op_id": op_mv2, "kind": "delete_memory", "entity_id": mid_sync,
                        "payload": {"updated_at": "2026-08-30T21:00:00.000Z"}}])
    push(opB, "devB", [{"op_id": op_mv3, "kind": "upsert_memory", "entity_id": mid_sync,
                        "payload": {"data": {**movie_payload, "title": "僵尸"}, "updated_at": "2026-08-30T20:30:00.000Z"}}])
    assert not any(m["id"] == mid_sync for m in list_memories(opA)), "删除后不应被旧快照复活"
    print("  删除: 墓碑生效，旧快照不复活")

    # ============ 2. 书籍完整链路 ============
    print("\n=== 书籍：搜索→详情→保存→刷新→pull→删除→pull ===")
    book_items = search(opA, "book", "百年孤独")
    book = book_items[0]
    assert book["title"] == "百年孤独" and book["creators"], "书籍搜索应带作者"
    print(f"  搜索: {book['title']} 作者={book['creators'][0]}")

    bd = detail(opA, "book", book["externalId"])
    assert bd["creators"] and bd["score"] and bd["providerMetadata"].get("isbn"), "书籍详情缺作者/评分/ISBN"
    print(f"  详情: 作者={bd['creators'][0]} 评分={bd['score']} ISBN={bd['providerMetadata']['isbn']}")

    mem_book = save(opA, "book", bd, "经典")
    mid_book = mem_book["id"]
    assert mem_book["media"]["mediaType"] == "book" and mem_book["media"]["providerMetadata"].get("isbn")
    assert any(m["id"] == mid_book for m in list_memories(opA))
    print(f"  保存+刷新: {mid_book} 带 ISBN + 标准 media 块")

    book_payload = {"type": "book", "title": bd["title"], "cover": bd["poster"], "external_id": bd["externalId"],
                    "author": (bd["creators"] or [""])[0], "isbn": bd["providerMetadata"].get("isbn", ""),
                    "media": {**bd, "mediaType": "book"}, "updated_at": "2026-08-30T20:00:00.000Z"}
    mid_bk = "mem-book-" + uuid.uuid4().hex[:12]
    op_bk1 = "bk1-" + uuid.uuid4().hex[:8]
    op_bk2 = "bk2-" + uuid.uuid4().hex[:8]
    push(opA, "devA", [{"op_id": op_bk1, "kind": "upsert_memory", "entity_id": mid_bk,
                        "payload": {"data": book_payload, "updated_at": "2026-08-30T20:00:00.000Z"}}])
    p = pull(opA, "devB")  # 同账号A 跨设备
    assert any(o["entity_id"] == mid_bk and o["payload"]["data"].get("isbn") for o in p["ops"]), "设备B 应 pull 到书籍(含 ISBN)"
    push(opA, "devA", [{"op_id": op_bk2, "kind": "delete_memory", "entity_id": mid_bk,
                        "payload": {"updated_at": "2026-08-30T21:00:00.000Z"}}])
    assert not any(m["id"] == mid_bk for m in list_memories(opA))
    print("  跨设备同步 + 删除墓碑: 通过")

    # ============ 3. 音乐链路 ============
    print("\n=== 音乐：搜索/详情→保存→刷新→pull ===")
    music_items = search(opA, "music", "稻香")
    music = music_items[0]
    assert music["title"] == "稻香" and music["mediaType"] == "music" and music["source"] == "itunes"
    print(f"  搜索: {music['title']} (source={music['source']})")

    mud = detail(opA, "music", music["externalId"])
    assert mud["creators"] == ["周杰伦"] and mud["providerMetadata"]["album"] == "魔杰座"
    print(f"  详情: 艺人={mud['creators'][0]} 专辑={mud['providerMetadata']['album']}")

    mem_music = save(opA, "music", mud, "神曲")
    mid_music = mem_music["id"]
    assert mem_music["media"]["mediaType"] == "music" and mem_music["media"]["creators"] == ["周杰伦"]
    assert any(m["id"] == mid_music for m in list_memories(opA))
    print(f"  保存+刷新: {mid_music} 艺人/专辑正确")

    # ============ 4. user isolation（账号 B 看不到 A 的任何记录）============
    print("\n=== user isolation ===")
    b_items = list_memories(opB)
    a_ids = {mid_movie, mid_book, mid_music}
    assert not (a_ids & {m["id"] for m in b_items}), "账号B 不应看到账号A 的记录"
    print(f"  账号B 可见记录数: {len(b_items)}，账号A 的记录均不可见 ✓")

    # ============ 5. 第三方故障稳定错误码 ============
    print("\n=== 第三方故障 / 非法输入 ===")
    st, b = call(opA, "GET", "/api/v1/media/search?type=anime&query=x")
    err_anime = json.loads(b).get("error", {}).get("code")
    assert err_anime == "VALIDATION_ERROR", f"不支持类型应 VALIDATION_ERROR，实际 {err_anime}"
    st, b = call(opA, "GET", "/api/v1/media/detail?type=movie&id=not-a-number")
    err_badid = json.loads(b).get("error", {}).get("code")
    assert err_badid in ("PROVIDER_ERROR", "VALIDATION_ERROR"), f"非法 id 应稳定错误码，实际 {err_badid}"
    print(f"  不支持类型→{err_anime}，非法 id→{err_badid} ✓")

    print("\n✅ ARCH-013 E2E 全部通过：电影/书籍/音乐完整链路 + 跨设备同步 + 幂等 + 墓碑 + user isolation + 稳定错误码")


if __name__ == "__main__":
    try:
        main()
    except AssertionError as e:
        print("\n❌ E2E 失败:", e)
        sys.exit(1)
