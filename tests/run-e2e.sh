#!/usr/bin/env bash
# V1.16.1 完整 E2E 入口（真实 Cloudflare D1，需 wrangler）
# 与 tests/run-all.sh 区分：
#   - run-all.sh  = 零依赖快速测试（8 单测 + 1 集成，node 直接跑，无需联网）
#   - run-e2e.sh  = 起 wrangler 本地 D1 后跑 Python E2E（电影/书籍/音乐全链路 + 跨设备同步）
# 用法：bash tests/run-e2e.sh
set -e
cd "$(dirname "$0")/.."

PORT=8788
PY="${PY:-python}"
NODE="${NODE:-node}"
WRANGLER="node_modules/wrangler/wrangler-dist/cli.js"

if [ ! -f "$WRANGLER" ]; then
  echo "✗ 未找到 wrangler（$WRANGLER）"
  echo "  请先安装（不污染 package.json）：npm install --no-save wrangler"
  exit 1
fi

echo "==> 启动 wrangler 本地 D1（port $PORT）"
CI=1 WRANGLER_SEND_METRICS=false "$NODE" "$WRANGLER" pages dev . --d1 DB --port "$PORT" --ip 127.0.0.1 &
WRANGLER_PID=$!

cleanup() {
  echo "==> 停止 wrangler（pid $WRANGLER_PID）"
  kill "$WRANGLER_PID" 2>/dev/null || true
}
trap cleanup EXIT

# 等待就绪（最多 30s）
echo "==> 等待服务就绪"
for _ in $(seq 1 30); do
  if curl -s -o /dev/null "http://127.0.0.1:$PORT/" 2>/dev/null; then break; fi
  sleep 1
done

echo "==> 运行 E2E"
"$PY" tests/e2e/media-sync-e2e.py
echo "✅ E2E 完成"
