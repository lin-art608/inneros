# InnerOS — Agent 工作约定

> 供 AI 编码助手在本仓库工作时自动读取。**改代码前先读完本文件 + `项目.md`（产品与架构）**，可避免 90% 的重复探查。项目结构或流程变更后必须同步更新本文件与 `CHANGELOG.md`。

个人数字空间（InnerOS）：无框架纯静态 Web App，部署于 Cloudflare Pages（inneros.pages.dev / inneros.asia）。**多账户云同步已上线**：Cloudflare D1 + 操作日志协议；坚果云/WebDAV 方案已删除（勿重新引入）。

## 结构地图（改哪查哪）
| 文件 | 内容 |
|---|---|
| `index.html` | 单页外壳，全部 CSS 内联。页面路由：today / quickchat(速信) / timeline / library / search / onthisday / random / year-review / settings / res-cs / res-football / res-ai / res-links / knowledge / ai-assistant |
| `app.js`（~3100 行） | 全部前端逻辑，**有意单文件，勿建议拆分**。分节：TYPE_META / 图片代理 / ContentProvider(豆瓣·iTunes·FreeToGame) / IndexedDB v4 / 账户与同步引擎(搜"多账户云同步 v2") / 速记对话 / 收藏赛程 / Sports 渲染 / 各页渲染 / History 返回栈 |
| `server.py` | 本地服务 :8765。代理：`/img`（豆瓣图）、`/api/douban`、`/api/sports`、`/api/auth`+`/api/sync`（**反代到 pages.dev**）、`/api/search` |
| `functions/_lib.js` | D1 schema 自建（IF NOT EXISTS）/ PBKDF2 / Cookie 会话 |
| `functions/api/auth/[action].js` | register / login / logout / me / send-code（Resend 验证码） |
| `functions/api/sync/[action].js` | push（幂等批量）/ pull（游标增量） |
| `functions/api/douban.js` | 豆瓣 suggest + rexxar 详情（电影/书籍简介、评分） |
| `functions/api/sports.js` | 足球=TheSportsDB(key 3)、CS2=Liquipedia（teamsearch/matches/leagueseason/cs2matches） |
| `CHANGELOG.md` | 每轮迭代必更新（日期 + 根因 + Fixed/Changed + 实测） |

## 命令
```
python server.py                                   # 本地服务 localhost:8765（/api/auth、/api/sync 反代线上）
node --check app.js                                # 语法检查（唯一的"测试"手段，每次改完必跑）
npx wrangler pages dev . --d1 DB --port 8788       # 本地 D1 模拟，全接口 E2E（改后端后必跑）
curl -X POST https://inneros.pages.dev/api/...     # 线上接口探测（部署后验证）
```

## 数据契约
**IndexedDB `memory_os` v4**：`entries`（id=uuid；含 type/title/entries[]追加模型/photos dataURL/seed 标记）、`teams`（sport/provider/provider_team_id/tsdb_id/badge）、`meta`（kv）、`ops`（op_id/kind/entity_id/payload/created_at —— 待推送操作队列）。
**D1**：users / sessions / devices(last_seq 游标) / memories(kind memory|team, data JSON, deleted 墓碑, _conflicts) / memory_entries(只追加) / attachments(一图一行 base64≤900KB) / operations(seq 游标源) / codes(注册验证码)。
**操作类型**：upsert_memory（新者胜，败方进 data._conflicts）/ append_entry（只追加幂等）/ delete_memory·delete_entry（墓碑）/ upsert_attachment。
**同步时机**：改动即时 + 60 秒定时 + online 事件；push 批 50；pull 排除本机操作。

## API 一览（均带 CORS）
`/api/auth/register|login|logout|send-code`(POST) `/api/auth/me`(GET，Cookie 会话 90 天) · `/api/sync/push`(POST) `/api/sync/pull?cursor&device_id`(GET) · `/api/douban?type=movie|book&q=` `?type=detail&kind=&id=` · `/api/sports?type=teamsearch|matches|leagueseason|cs2matches` · `/img?url=`

## 硬性约束与踩坑清单（违反必返工）
1. **内联 onclick 里的 id 必须加引号**：`openDetail('${e.id}')`。id 已是 UUID（含连字符），不加引号 = 点击即 JS 语法错误（已回归过一次）。
2. **双端代理**：同逻辑存在于 `functions/api/*.js` 与 `server.py`，改任何 API 两端必须同步；`server.py` 反代必须**透传浏览器 User-Agent**（CF Bot Fight Mode 对 python-urllib 签名返回 1010）。
3. **合规红线**：不引入付费服务（R2 免费档也要绑卡，禁用）；密钥只进 CF 环境变量（现 `EMAIL_API_KEY`）；禁止 mock 冒充真实数据；不接 Supabase；不改 DNS。
4. **Resend 测试模式**：未验证域名只能发给 Resend 账号本人邮箱（403 已转中文提示）。验证码逻辑：配置了 `EMAIL_API_KEY` 才强制验证码。
5. **Liquipedia**：必须 gzip + 描述性 UA + 缓存≥5min（≤2 req/s）。**坚果云**：风控拦数据中心 IP，已弃用，勿再排查。
6. **D1 限制**：绑定参数 ≤1MB —— 附件 base64 压缩到 ≤1280px/JPEG0.8 后仍超 900KB 则跳过云端（原图只留本地）。
7. IndexedDB 结构变更必须递增 `DB_VERSION` 并写迁移（v4 做过数字 id→UUID 迁移，勿回退）。
8. **UI 约定**：右下角＋按钮只在记忆页显示（非记忆页 navigate 里隐藏）；首页赛程=收藏制（★ localStorage `inneros_fav_matches`）；速记(type `quick`)不计入统计；日记无标题/心情输入（标题=正文前 18 字）；时间线每条直显日期时间类型；侧边栏 overflow-y:auto。
9. D1 里有测试账号残留（e2e@/curltest@/notarget@inneros.dev），勿当用户数据。

## 风格与流程
- 注释、UI 文案、错误提示一律中文；错误提示必须是人话+下一步动作。
- commit：`feat:`/`fix:`/`docs:`/`chore:` + 中文一句话（写明根因）。
- 每轮迭代必须同步做四件事：
  1. `app.js` 顶部 `APP_VERSION` 递增（次版本 +0.1；紧急修复 +0.0.1），同时更新 `index.html` 的 `app.js?v=` 查询参数（**破缓存**：手机端不硬刷也能拿到新版）
  2. 更新 `CHANGELOG.md`（日期 + 根因/Fixed/Changed + 实测记录）
  3. 功能或限制变化时更新 `项目.md`；结构变化时更新本文件
  4. commit → 回复末尾附 GitHub Desktop 的 Summary + Description 文案（用户自己在 GitHub Desktop 推送）
- 版本号是部署成功的判据：用户在侧边栏页脚/设置页看到的版本 = 最新 commit 的版本号即部署成功。
- 长脚本改 `app.js` 用 python 正则时，替换串必须用 **lambda**（避免 `\${` 转义坑，踩过两次）。

## 省 token 约定
- 全程中文、解释从简、不输出整文件、只给改动片段。
- 先读本文件定位文件/分节，再精读那一段；不要全仓库搜索。
- 纯问答不触发 CHANGELOG 流程。
