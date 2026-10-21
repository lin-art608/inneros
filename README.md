# InnerOS · 个人数字空间

私人数字人生档案：电影 / 剧集 / 书籍 / 音乐 / 游戏 / 地点 / 事件 / 日记 / 速记统一记录在一条时间线上，多账户登录，多设备实时同步。

线上地址：[inneros.pages.dev](https://inneros.pages.dev) · [inneros.asia](https://inneros.asia)

**当前版本 v1.31.0**（新增邮件验证修改密码；另有 V1.30 Windows 桌面端）

## 技术形态

无框架、无打包纯静态 Web App（Cloudflare Pages）+ Pages Functions + D1 + Resend；
Windows 桌面端是 Electron 外壳，加载线上网页。无付费服务，密钥只放 Cloudflare 环境变量。

## 文档

| 文档 | 用途 |
|---|---|
| [项目.md](项目.md) | **唯一权威文档**：产品、架构、数据契约、部署、已知限制、**项目开发守则** |
| [AGENTS.md](AGENTS.md) | AI 编码助手入口：结构地图、命令、硬性约束、交付流程 |
| [CHANGELOG.md](CHANGELOG.md) | 逐轮变更记录（Keep a Changelog） |
| [docs/architecture/README.md](docs/architecture/README.md) | V2 分层规范（ARCH-001~017） |
| [desktop/README.md](desktop/README.md) | Windows 桌面端使用与打包 |

## 本地开发

```bash
python server.py            # http://localhost:8765（鉴权/同步/足球/auth 反代线上）
node --check app.js         # 语法检查
bash tests/run-all.sh       # 单元 + 集成（零依赖，Node 22.13+）
bash tests/run-e2e.sh       # 完整 E2E（需先 npm i --no-save wrangler）
```

提交规范：`feat:` / `fix:` / `docs:` / `chore:` + 中文一句话（写明根因）。每轮迭代按 [项目.md §7](项目.md#7-项目开发守则) 的四件套收尾。
