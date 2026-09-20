# InnerOS — Agent 工作约定

> 供 AI 编码助手在本仓库工作时自动读取。**改代码前先读完本文件 + `项目.md`（产品与架构）**，可避免 90% 的重复探查。项目结构或流程变更后必须同步更新本文件与 `CHANGELOG.md`。

个人数字空间（InnerOS）：无框架纯静态 Web App，部署于 Cloudflare Pages（inneros.pages.dev / inneros.asia）。**多账户云同步已上线**：Cloudflare D1 + 操作日志协议；坚果云/WebDAV 方案已删除（勿重新引入）。

## 架构升级（V2，进行中）
架构规则/目录约定/统一信封见 `docs/architecture/README.md`（ARCH-001 生效）。要点：
- **新增后端 API** 一律走 `/api/v1/**` + `functions/_infra/errors.js` 统一信封（ok()/fail()/errors.*，带 requestId）；旧 /api/* 保持原样勿迁移
- **新增前端 API 调用** 一律走 `src/services/api-client.js` 的 `InnerOSApi.get/post`（新旧响应都兼容解析）
- 共享层用下划线前缀目录（`_infra/_domain/_repositories/_services/_adapters`）——CF Pages 不路由下划线文件
- **前端渐进式拆分**：app.js 不再强制单文件。新增功能/页面优先放入 `src/features/` 下的独立模块（IIFE + `window.InnerOSXxx` 命名空间，与 media.js/api-client.js 同模式），触碰既有大块逻辑时顺手迁出；app.js 保留生命周期/事件协调/兼容入口
- 禁止：UI 直接 fetch 第三方/D1、业务塞回 app.js、微服务/TS 大迁移/新框架（方案第二十节负面清单）

## 结构地图（改哪查哪）
| 文件 | 内容 |
|---|---|
| `index.html` | 单页外壳，全部 CSS 内联。页面路由：memory / resources 两个父级 Hub，以及 today / quickchat(速信) / timeline / library / search / onthisday / random / year-review / settings / res-cs / res-football / res-ai / res-links / knowledge / ai-assistant |
| `app.js` | 前端主逻辑（渐进式拆分中，新功能优先放 `src/features/`）。分节：TYPE_META / 图片代理 / ContentProvider / IndexedDB v4 / 账户与同步引擎 / 速记对话 / 各页渲染 / History 返回栈（Sports 渲染已全部迁出，仅剩 2 个薄委托） |
| `src/features/navigation.js` | V1.27.0 页面父子关系、记忆/资源 Hub 与移动端横滑判定（IIFE + `window.InnerOSNavigation`）。返回目标必须查 `PAGE_PARENT`，禁止再用访问历史猜产品层级 |
| `src/features/media.js` | 前端媒体数据层（电影/书籍/音乐搜索+详情+字段映射，IIFE + `window.InnerOSMedia`） |
| `src/features/sports.js` | V1.27.0 Sports Center V2（足球+CS2，IIFE + `window.InnerOSSports`）。统一 Match + SportsScheduleQuery；资源 Hub 内提供双项目三日汇总；同 URL 并发读取必须经 `rawInflight` 合并，避免触发 Provider 限流；CS2 使用 v1 最多 200 场窗口，不套 A 级白名单 |
| `src/features/memory-detail.js` | V1.25.0 记忆详情 UI 纯逻辑：统一线性 SVG 类型图标、Unicode 字素安全截断、日记兜底标题、初记/续写篇章标签、相册循环索引（IIFE + `window.InnerOSMemoryDetail`） |
| `src/services/api-client.js` | 前端统一 API Client（`window.InnerOSApi`，兼容新旧信封） |
| `server.py` | 本地服务默认 :8765（可用 `INNEROS_PORT` 临时换端口）。代理：`/img`（豆瓣图）、`/api/douban`、`/api/sports`、`/api/v1/sports/cs2/matches`；`/api/v1/football/**`、`/api/auth`、`/api/sync` **反代到 pages.dev**；另有 `/api/search` |
| `functions/_lib.js` | D1 schema 自建（IF NOT EXISTS）/ PBKDF2 / Cookie 会话 |
| `functions/api/auth/[action].js` | register / login / logout / me / send-code（Resend 验证码） |
| `functions/api/sync/[action].js` | push（幂等批量）/ pull（游标增量）。**ARCH-008 后为薄路由**：只 auth/parse/service/response，编排在 sync-service |
| `functions/api/douban.js` | 豆瓣 suggest + rexxar 详情（电影/书籍简介、评分） |
| `functions/api/sports.js` | 旧兼容体育接口：足球=TheSportsDB（官方免费 key 123），CS2=Liquipedia teamsearch/cs2matches；新功能禁止继续堆入，主链走 v1 |
| `functions/_lib.js` | D1 schema 自建（IF NOT EXISTS）/ PBKDF2 / Cookie 会话（旧共享库，逐步收敛） |
| `functions/_domain/memory.js` | Memory 领域模型：normalizeMemory（旧字段→标准结构；有标准 `media` 块时以其为准）/validateMemory/canonicalType/validateOperation |
| `functions/_domain/media.js` | ARCH-009 Media 领域模型：normalizeMedia/validateMedia/**mediaToMemoryPatch**（标准 Media → 记忆记录补丁；第三方原始 JSON 只进 providerMetadata） |
| `functions/_repositories/memory-repository.js` | Memory 的 D1 访问集中：upsertNewer/tombstone/appendEntry/updateEntryContent/**upsertAttachment**/listByUser。**只管 memory/entry/attachment**（操作日志与设备已迁出）。写入方法均支持可选 `collect` 参数：传入数组时只生成语句不执行（供 db.batch 提交） |
| `functions/_repositories/operation-repository.js` | ARCH-008 操作日志访问：opExists（幂等判据）/record/listSince（游标增量+排除设备）/maxSeq。record 的 `prepend` 参数传入业务语句时用 `db.batch()` 与记录同事务提交 |
| `functions/_repositories/device-repository.js` | ARCH-008 设备访问：ensureDevice/getCursor/updateCursor（last_seq 由 Service 传入，便于脱离 D1 单测） |
| `functions/_services/memory-service.js` | Memory 业务编排：createMemory（领域校验）/list（归一化）/append（空追加拒绝）/delete（墓碑）/NOT_FOUND 语义 |
| `functions/_services/media-service.js` | 媒体编排：Provider 选择（movie/book→douban，music→itunes）/query 校验/错误映射（第三方原始错误只进日志） |
| `functions/_services/sports-service.js` | ARCH-017 体育编排：CS2 查询参数校验、Liquipedia Provider 调用、覆盖信息与 CC BY-SA 署名、第三方错误映射 |
| `functions/_services/sync-service.js` | ARCH-008/008.1 同步编排：push（validateOperation→幂等→applyOperation→推进游标）/pull（增量+排除本机）。`applyOperation` 的 kind→repository 分发在此，勿搬回路由。请求级错误抛 `ServiceError` + `ErrorCode`；单条错误带 `code` 字段（客户端按 code 判断，禁止依赖中文 message）。可语句化的 5 种 kind 走 `db.batch` 与 operation 记录同事务 |
| `functions/_adapters/douban-adapter.js` | 豆瓣适配器：searchMedia/getMediaDetail 标准结构 + 旧形状兼容输出（movie/book） |
| `functions/_adapters/itunes-adapter.js` | ARCH-011 iTunes 适配器（music）：searchMedia/getMediaDetail 标准结构；免 Key、country=CN；iTunes 无评分/简介 → score=null、description='' |
| `functions/_adapters/liquipedia-adapter.js` | ARCH-017 Liquipedia 适配器：官方 MediaWiki action=parse、最多 200 场 ticker、标准比赛字段；描述性 UA + gzip + 15 分钟边缘缓存 |
| `functions/_infra/errors.js` | 统一错误模型（ARCH-002）：ok/fail/errors.*/ServiceError + requestId |
| `functions/api/v1/` | 新版 API（统一信封）：me / memories / media/search / media/detail / sports/cs2/matches |
| `app.js` 电影链路 | ARCH-009：搜索与详情走 `InnerOSApi` → `/api/v1/media/search\|detail`，`mediaToWorkFields()` 做标准结构→本地字段映射；v1 失败回退 `/api/douban` |
| `app.js` 书籍链路 | ARCH-010：同电影，`mediaToWorkFields(m,'book')` 映射书籍扩展字段（cover/authors/publisher/isbn/...）；保存带标准 `media` 块 |
| `app.js` 音乐链路 | ARCH-011：搜索/详情走 v1（`/api/v1/media/search\|detail?type=music` → iTunes），`mediaToWorkFields(m,'music')` 映射 artist/album/preview_url/track_price；v1 失败回退旧直连 iTunes；保存带标准 `media` 块 |
| `src/services/api-client.js` | 前端统一 API Client（InnerOSApi，经典脚本命名空间；新调用必经） |
| `src/features/media.js` | ARCH-012/1.16.1 前端媒体数据层：`mediaToWorkFields`/`searchMovie`/`searchBook`/`searchMusic`/`enrichWorkDetail` 从 app.js 迁出（IIFE + `window.InnerOSMedia`）。**唯一前端媒体数据入口**；app.js 的 `ContentProvider`/`enrichWorkDetail` 现为薄委托。**第三方 URL（/api/douban、itunes）只存在于本文件的「兼容 fallback 层」（legacy* 函数），feature 主链始终走 v1** |
| `tests/unit/` | 零依赖单测：errors/domain-memory/media/navigation/memory-detail/sync/sports/pet 等（node 直接运行）；导航覆盖父级与横滑判定，sports 覆盖统一 Match、缓存降级、Liquipedia Adapter/Service/v1 路由与 200 场请求 |
| `tests/integration/sync-route.test.mjs` | ARCH-008.2 集成测试：真实 `onRequestPost/Get` + Cookie 会话 + 内存 D1 仿真（按 SQL 模式处理，未知 SQL 抛错防漂移）。**改同步相关代码后必跑** |
| `tests/e2e/media-sync-e2e.py` | ARCH-013 真实 D1 端到端：电影/书籍/音乐 搜索→详情→保存→刷新→pull→删除→pull + 跨设备同步 + 幂等 + 墓碑 + user isolation + 稳定错误码。**需先起 wrangler**（零第三方依赖，Python 直接跑） |
| `tests/run-all.sh` | 零依赖快速测试入口：一条命令跑全部单测 + 集成（**不含** E2E） |
| `tests/run-e2e.sh` | 完整 E2E 入口：自动起 wrangler 本地 D1 → 跑 Python E2E → 停止 wrangler（需先 `npm install --no-save wrangler`） |
| `CHANGELOG.md` | 每轮迭代必更新（日期 + 根因 + Fixed/Changed + 实测） |
| `src/pet/*` | 桌宠网页模块（config/adapter/view/controller/events/mount + **state（属性数值）/interact（点击菜单·双击喂食·自动说话）** + pet.css）：挂载于 AI 助手页 `#pet-container`，对外 `window.InnerOSPet`；属性存 localStorage `inneros_pet_state`（不进 IndexedDB/不上云）。**桌面版桌宠素材源在仓库外，勿改动 assets/pet 帧命名规则（{action}_{i}.png）**。样式改浮层显隐时注意：作者 `display` 会盖过 UA 的 `[hidden]{display:none}`，需显式写 `[hidden]` 规则。**V1.23.0+ 新增**：`image-rendering:crisp-edges` 高清渲染、`pet-draggable` 自由拖动（位置存 `inneros_pet_position`）、右键菜单+左键互动效果、`microActions` 待机微动作（blink/lookaround/stretch/adjust，CSS transform 叠加，无需额外素材） |

## 命令
```
python server.py                                   # 本地服务 localhost:8765（/api/auth、/api/sync 反代线上）
node --check app.js                                # 语法检查（每次改完必跑）
bash tests/run-all.sh                              # 零依赖快速测试入口：跑全部单测 + 集成（不含 E2E）
bash tests/run-e2e.sh                              # 完整 E2E 入口：自动起 wrangler 本地 D1 → Python E2E → 停止（需先 npm i --no-save wrangler）
python tests/e2e/media-sync-e2e.py                 # ARCH-013 真实 D1 E2E（手动方式，需先起 wrangler；电影/书籍/音乐全链路+跨设备同步）
curl -X POST https://inneros.pages.dev/api/...     # 线上接口探测（部署后验证）
```

## 数据契约
**IndexedDB `memory_os` v4**：`entries`（id=uuid；含 type/title/entries[]追加模型/photos dataURL/seed 标记）、`teams`（sport/provider/provider_team_id/tsdb_id/badge）、`meta`（kv）、`ops`（op_id/kind/entity_id/payload/created_at —— 待推送操作队列）。
**D1**：users / sessions / devices(last_seq 游标) / memories(kind memory|team, data JSON, deleted 墓碑, _conflicts) / memory_entries(只追加) / attachments(一图一行 base64≤900KB) / operations(seq 游标源) / codes(注册验证码)。
**操作类型**：upsert_memory（新者胜，败方进 data._conflicts）/ append_entry（只追加幂等）/ delete_memory·delete_entry（墓碑）/ upsert_attachment。
**同步时机**：改动即时 + 60 秒定时 + online 事件；push 批 50；pull 排除本机操作。

## API 一览（均带 CORS）
`/api/auth/register|login|logout|send-code`(POST) `/api/auth/me`(GET，Cookie 会话 90 天) · `/api/sync/push`(POST) `/api/sync/pull?cursor&device_id`(GET) · `/api/v1/sports/cs2/matches` · `/api/douban?type=movie|book&q=` `?type=detail&kind=&id=` · `/api/sports?type=teamsearch|matches|leagueseason|cs2matches`（旧兼容） · `/img?url=`

## 硬性约束与踩坑清单（违反必返工）
1. **内联 onclick 里的 id 必须加引号**：`openDetail('${e.id}')`。id 已是 UUID（含连字符），不加引号 = 点击即 JS 语法错误（已回归过一次）。
2. **双端代理**：同逻辑存在于 `functions/api/*.js` 与 `server.py`，改任何 API 两端必须同步；`server.py` 反代必须**透传浏览器 User-Agent**（CF Bot Fight Mode 对 python-urllib 签名返回 1010）。
3. **合规红线**：不引入付费服务（R2 免费档也要绑卡，禁用）；密钥只进 CF 环境变量（现 `EMAIL_API_KEY`）；禁止 mock 冒充真实数据；不接 Supabase；不改 DNS。
4. **Resend 测试模式**：未验证域名只能发给 Resend 账号本人邮箱（403 已转中文提示）。验证码逻辑：配置了 `EMAIL_API_KEY` 才强制验证码。
5. **Liquipedia**：只能走官方 MediaWiki API，禁止抓网页 HTML；必须 gzip + 描述性 UA。通用 API ≤1 次/2 秒，`action=parse` ≤1 次/30 秒；赛事 parse 缓存≥15min；UI 必须展示 Liquipedia + CC BY-SA 署名。**坚果云**：风控拦数据中心 IP，已弃用，勿再排查。
6. **D1 限制**：绑定参数 ≤1MB —— 附件 base64 压缩到 ≤1280px/JPEG0.8 后仍超 900KB 则跳过云端（原图只留本地）。
7. IndexedDB 结构变更必须递增 `DB_VERSION` 并写迁移（v4 做过数字 id→UUID 迁移，勿回退）。
8. **UI 约定**：右下角＋按钮只在记忆页显示（非记忆页 navigate 里隐藏）；详情页打开时＋=追加到当前记录（captureTriggerClick）；手机详情页左上角保留返回兜底，右上角为更多菜单+分享，删除收进更多菜单；首页/时间线不放编辑图标，篇章编辑只在详情出现；只有日记标题可在详情原位编辑，电影/书籍等标题只读；首页摘要固定展示初记；首页赛程=收藏制（★ localStorage `inneros_fav_matches`）；速记(type `quick`)不计入统计；日记留空标题才按 Unicode 字素安全生成兜底标题；时间线每条直显日期时间类型；侧边栏 overflow-y:auto；皮肤偏好保存在 localStorage `inneros_skin`。
9. D1 里有测试账号残留（e2e@/curltest@/notarget@inneros.dev），勿当用户数据。
10. **D1 原子性**：无交互式事务（不能 BEGIN…COMMIT 跨 await）。要原子就用 `db.batch([stmt...])`（batch 即事务）。需先读后写的逻辑（如 upsertNewer 冲突判定）无法进 batch，改靠"写入语义幂等 + op_id 未记录即可安全重试"保证一致性。
11. **`operations.seq` 是全局 AUTOINCREMENT**，不是每账号从 1 开始。写同步相关断言/客户端逻辑时禁止用"条数"推算 seq，必须取实际返回值（踩过两次）。
12. **Service 抛错必须 `new ServiceError(...)`**，禁止自建 Error 类或裸 Error + `.code`。v1 路由用 `e instanceof ServiceError` 判定，裸 Error 会被判成内部错误 → **所有业务/第三方错误都退化成 500 INTERNAL**（ARCH-009 修复过一次：media/memory service 原用本地 businessError 造裸 Error）。

## 网页开发可靠性守则
- **产品层级显式化**：页面父子关系集中在 `src/features/navigation.js`；浏览器返回、页内返回和手机系统返回必须收敛到同一父级规则。禁止把 `history.back()` 当产品信息架构，也禁止在各页面散写父级判断。
- **移动端优先验收**：涉及布局/导航/触摸时至少检查 375×812、390×844、430×932；必须确认无横向溢出、输入/相册/横向 Tab 不误触全局手势、右滑开栏与左滑关栏可用。
- **模块边界**：新页面/交互放 `src/features/`，`app.js` 只做生命周期和协调；新外部数据必须是 `UI → InnerOSApi → v1 Route → Service → Adapter`，第三方响应不可直接进入 UI。
- **真实与合规数据**：只接官方、授权或明确允许的 API；禁止网页抓取冒充 API。每个 Provider 必须记录来源、许可、配额/限流、缓存和覆盖窗口；降级时必须向用户如实说明缺失，不用假数据补齐。
- **安全与可访问性**：所有用户/第三方文本输出前转义；外链使用 `rel="noopener"`；交互控件优先 `<button>` 并提供可读文本/aria；键盘焦点与 Escape/返回行为不得丢失。
- **失败可恢复**：网络调用要有超时语义、稳定错误码、可重试提示；可安全缓存的读请求允许 stale 降级，写操作必须幂等；日志不得包含正文、Cookie、密钥或验证码。
- **完成定义**：每轮至少执行相关 `node --check`、新增/受影响单测、`bash tests/run-all.sh`、`git diff --check`；UI 变更用真实浏览器检查手机视口、返回层级和控制台。若无法执行某项，必须在交付中写明。

## 风格与流程
- 注释、UI 文案、错误提示一律中文；错误提示必须是人话+下一步动作。
- commit：`feat:`/`fix:`/`docs:`/`chore:` + 中文一句话（写明根因）。
- 每轮迭代必须同步做四件事：
  1. `app.js` 顶部 `APP_VERSION` 递增（次版本 +0.1；紧急修复 +0.0.1），同时更新 `index.html` 的 `app.js?v=` 查询参数（**破缓存**：手机端不硬刷也能拿到新版）；涉及的 feature 模块（如 `src/pet/`、`src/features/`）的 `?v=` 同步更新
  2. 更新 `CHANGELOG.md`（日期 + 根因/Fixed/Changed + 实测记录）
  3. 功能或限制变化时更新 `项目.md`；结构变化时更新本文件
  4. 代码全部改完后，**Agent 直接执行 git add + commit + push**（见下方交付流程），不再只给提交文案让用户手动操作
- 版本号是部署成功的判据：用户在侧边栏页脚/设置页看到的版本 = 最新 commit 的版本号即部署成功。
- 长脚本改 `app.js` 用 python 正则时，替换串必须用 **lambda**（避免 `\${` 转义坑，踩过两次）。

### 标准迭代交付流程（所有项目通用）

> 代码改完 → Agent 自动 git add/commit/push → Cloudflare Pages 自动部署 → 验证线上版本号

1. **代码修改完成**：所有目标文件改动完毕，`node --check` 语法通过
2. **四件套同步**：APP_VERSION / index.html?v / CHANGELOG.md / 项目文档 全部更新
3. **Agent 自动提交推送**：Agent 直接执行 `git add .` → `git commit -m "feat: xxx"` → `git push`，全程无需用户手动操作 GitHub Desktop
4. **部署验证**：推送后约 1~2 分钟，访问线上站点，侧边栏页脚/设置页看到新版本号即为成功

**commit 规范**：`feat:`/`fix:`/`docs:`/`chore:` + 中文一句话（写明根因），例如：
- `feat: 桌宠体验升级：高清渲染/自由拖动/右键菜单/自然待机`
- `fix: 互动菜单 hidden 属性被作者样式覆盖导致不隐藏`
- `docs: 更新 AGENTS.md 交付流程为 Agent 自动 git push`

## 省 token 约定
- 全程中文、解释从简、不输出整文件、只给改动片段。
- 先读本文件定位文件/分节，再精读那一段；不要全仓库搜索。
- 纯问答不触发 CHANGELOG 流程。
