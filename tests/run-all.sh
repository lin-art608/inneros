#!/usr/bin/env bash
# ARCH-013 测试护栏 · 统一测试入口
# 跑所有零依赖测试（8 套单测 + 1 套集成），node 直接运行，无需安装任何包。
# 用法：bash tests/run-all.sh
#
# 真实 D1 端到端（E2E）另见 tests/e2e/media-sync-e2e.py —— 需先起 wrangler：
#   CI=1 WRANGLER_SEND_METRICS=false npx wrangler pages dev . --d1 DB --port 8788 --ip 127.0.0.1
#   python tests/e2e/media-sync-e2e.py
set -e
cd "$(dirname "$0")/.."

NODE="${NODE:-node}"
fail=0
total=0

for f in tests/unit/*.test.mjs tests/integration/*.test.mjs; do
  [ -f "$f" ] || continue
  total=$((total + 1))
  printf '── %s\n' "$f"
  if "$NODE" "$f" >/dev/null 2>&1; then
    printf '   ✓ 通过\n'
  else
    printf '   ✗ 失败\n'
    "$NODE" "$f" 2>&1 | tail -15
    fail=1
  fi
done

printf '\n共 %d 套测试\n' "$total"
if [ "$fail" -eq 0 ]; then
  echo '✅ 全部测试通过'
else
  echo '❌ 存在失败'
  exit 1
fi
