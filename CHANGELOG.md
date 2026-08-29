# Changelog · 变更记录

本项目所有重要变更记录在此文件（GitHub 官方惯例，[Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/) 格式）。
开发约定：**每轮迭代完成后，Agent 直接在本文件新增/更新对应日期小节**，并在回复中附上 GitHub Desktop 的 Summary + Description 文案。

---

## [Unreleased]

### S1（进行中）：多账户云同步 v2 —— D1 + 操作日志协议

#### Added（2026-08-29 深夜，S1 后端阶段）
- `functions/_lib.js`：D1 schema 自动建表（7 张表，IF NOT EXISTS 幂等）、PBKDF2-SHA256(10万次) 密码哈希、httpOnly 会话 Cookie（90天）
- `functions/api/auth/[action].js`：注册/登录/登出/me（重复邮箱 409、错误凭据 401）
- `functions/api/sync/[action].js`：操作日志同步协议——push 幂等批量（op_id 去重）+ 墓碑删除 + 冲突双版本保留（_conflicts）+ 附件行级存储；pull 按设备游标增量回放（排除本机操作）
- `server.py`：/api/auth、/api/sync 反代线上 API（本地版与线上版行为一致，Cookie 域名自动改写）
- 架构决策：照片客户端压缩后存 D1 attachments 表（一图一行，记忆主行只存图片 id）；R2 为 v1.1 可选升级（免费档需绑卡，§12 有摩擦，由用户决定）
- 用户一次性操作：CF Dashboard 创建 D1 数据库并绑定到 Pages 项目（变量名 DB）

#### S2+S3+S4（2026-08-30，前端接入完成，全链路实测通过）
- 登录界面接线：复用既有 auth-screen（注册/登录/访客模式），启动时鉴权，未登录先登录；网络不可达按离线访客放行
- DB v4：ops 操作日志队列表 + 一次性 UUID 迁移（数字自增 id → uuid，legacy_id 保留；子条目同步换 uuid）
- 保存/追加/删除/球队关注与取消 → 全部写入操作日志并自动同步（改动即时 + 每 5 分钟 + 网络恢复时）
- 照片：保存时压缩（≤1280px/JPEG 0.8）→ upsert_attachment 操作 → 云端 attachments 表；原图仅留本地
- 首次登录引导：先回放云端（第二台设备即恢复），再上传本地非 seed 数据；seed 演示数据自动去重
- 设置页「账户」区（状态/立即同步/退出）；WebDAV 降级为可选手动导出；详情页新增冲突版本标记

#### 全链路实测（本地版 UI → 线上 D1，真账号）
- 注册 e2e 测试账号 → 自动登录 → 首次引导上传 26 个操作（20 记录 + 3 球队）
- 模拟第二台设备 pull 全量 26 ops ✓；UI 新增记录 → 第二台设备增量可见（seq 26→28）✓
- UI 删除 → 墓碑同步到第二台设备（seq 29），不会复活 ✓
- 已知小延迟：保存瞬间若上一次同步仍在途，本次会跳过、由 5 分钟定时器或下次改动补推

#### 实测（wrangler 本地 D1 模拟，全部通过）
- 注册→登录→me→登出→me(401)；错误密码 401；重复注册 409
- 设备A push（upsert+append）→ 设备B pull 增量可见；本机操作不回放给自己
- 删除墓碑不被旧快照复活；重复 push 幂等跳过；旧时间戳并发编辑保留进 _conflicts
- 附件 base64 行级存储/读回

## [2026-08-29] 测试连接 409 修复：探测目标改为父目录（密码已验证正确）

### 根因（实测确认）
- 假凭据 PROPFIND 任意路径 → 401（坚果云先验密码）；用户拿到的 409 发生在**密码验证通过之后**
- 409 = 协议语义"父目录不存在"：首次使用时备份文件还没创建，旧逻辑却对**文件本身**发 PROPFIND → 把正确的凭据误报为失败

### Fixed
- 「测试连接」改为探测目标文件的**父目录**（两端同步修复）；上传路径的 409 之前已带自动建目录
- 409 新增兜底提示

## [2026-08-29] 线上版连坚果云 520：确认为坚果云风控拦截云服务器 IP（已知限制）

### 结论（实测对照）
- 本机直连 dav.jianguoyun.com → 401（链路通，假密码被正常拒绝）
- 线上 Cloudflare Worker → 坚果云 → 520（复现用户报错）
- 本地 server.py 代理 → 坚果云 → 401 友好提示（链路通）
- 社区同例：NextChat Issue #4532 部署在服务器上 check 坚果云同样返回 520

### Changed
- 401/403/405/520 全部映射为针对性中文提示；520 明确告知「线上版被坚果云风控拦截，请在本地版使用同步」
- 设置页云同步说明加入此限制说明（线上版建议用本地版同步，或改用不拦数据中心 IP 的自建 WebDAV）

## [2026-08-29] 云同步首连报错修复（用户实测反馈）

### Fixed
- **首传 409 根因**：目标文件夹不存在时应对父目录发 MKCOL，但 server.py 误对文件 URL 发（JS 端正确），坚果云返回 409 冲突——已修复并用本地模拟 WebDAV 实测「PUT 到不存在目录 → 自动建目录 → 201 成功」
- **地址容错**：只填网盘根地址（如坚果云弹窗展示的 `https://dav.jianguoyun.com/dav/`）时自动补默认文件路径 `InnerOS/inneros-backup.json`
- **错误提示友好化**：401 →「账号或应用密码不对（要用应用密码，不是登录密码）」；403 → 权限提示；405 →「地址应指向文件路径」
- 本地回环地址（127.0.0.1/localhost）允许 http 供开发测试；线上 CF 函数仍强制 https

### 实测（本地模拟 WebDAV + 浏览器端到端）
- 测试连接 ✓ → 上传到云端「✓ 已上传 18 条」→ 云端文件确有 18 entries → 从云端恢复（确认弹窗→合并→状态更新）✓
- 错误密码 → 返回友好中文提示 ✓

## [2026-08-29] V1.3：CS 赛事中心重构 + 联赛赛程检索 + 云同步 v1（WebDAV）

### Fixed
- **队徽覆盖率 62/98 → 100%**（用户反馈"为什么还有圆形字标"）：实测 Liquipedia ticker 中 ~2/3 队伍块用无后缀的 `team-template-image-icon` 类，原正则只认 `-lightmode` 变体；放宽为 lightmode/allmode → 无后缀兜底，44/44 场次队标全中
- **手机端键盘遮挡**（用户反馈"输入框遮挡下面内容"）：移除 `virtualKeyboard.overlaysContent=true`（该设置让键盘直接盖住表单且页面不可滚），viewport 加 `interactive-widget=resizes-content`，恢复视口随键盘缩放 + focusin 滚动兜底
- **资源整合页移除全部添加按钮**（用户明确要求）：CS/足球页不再有"＋添加"入口，仅展示关注 chips；空态文字引导到 设置 → Sports 关注管理（选择器仍在设置页打开）

### Changed
- **CS 页重构为"赛事中心"**（用户要求列出正在进行的赛事、点进赛事看赛程阶段）：
  - 新增「🔴 正在直播」段（全局 live 场次）
  - 新增「🏆 进行中的赛事」卡片：按赛事聚合（阶段 chips / 场次数 / 下一场时间 / 直播数）→ 点进赛事详情页（页内层级 + 入历史栈，返回键回列表）：按阶段（Group A / Playoffs…）分组列出全部场次，顶部「在 Liquipedia 打开完整赛程/观看 ↗」外链
  - ticker 解析新增 `league_url`（赛事名自带 Liquipedia 页面链接，含阶段锚点）
  - **过去赛程弱化**：完赛场次不放星标/推荐语、卡片降透明度、「最近结果」缩至 3 场置底；赛事列表不再收录纯历史赛事
- **足球页新增联赛赛程 tab**（用户要求按五大联赛检索）：英超/西甲/德甲/意甲/法甲/欧冠/中超 chips，各自展示近期赛程 + 已完赛分组 + TheSportsDB 完整赛程外链；客户端 10 分钟缓存
  - 新接口 `/api/sports?type=leagueseason&id=`：eventsseason（当前赛季）+ eventsnextleague 去重合并
  - 已知限制：TheSportsDB 免费档每赛季仅返回少量场次（实测英超 6 场），非完整赛季——页面如实提示并外链

### Added
- **云同步 v1（WebDAV，§12 合规：不购买服务/不提交密钥）**：
  - 用户自己的免费 WebDAV 网盘（推荐坚果云，注册免费）；`functions/api/webdav.js` + server.py 镜像仅做转发代理，凭据只存用户本机 localStorage、随请求传入，服务端零存储
  - 设置页「云端同步 · WebDAV」：地址/账号/应用密码 + 测试连接 / 上传到云端 / 从云端恢复；快照存 `InnerOS/inneros-backup.json`
  - 合并策略：逐条按 updated_at 新者胜，不删除现有内容
  - IndexedDB 升级 v3：新增 `meta` 存储层（last_synced_at，为多设备同步打底）
- 设置页新增「导入备份」：本地 JSON 恢复，与云端恢复共用合并逻辑（新者胜，不覆盖较新）

### 实测（本地 server.py + 浏览器端到端）
- CS：赛事卡（BLAST Open Fall 2026 · Group A/B · 7 场）→ 点进详情分阶段列全部场次 → 返回键回列表 ✓；队徽 44/44 ✓
- 足球：英超 tab 出近期赛程（利物浦 vs 森林）+ 已完赛 5 场真队徽 ✓
- 设置页云同步 UI 渲染 ✓；`/api/webdav` 三操作（test/get/put）语法与路由 ✓（真实坚果云连接需用户配置自己的账号）

## [2026-08-29] 变更记录统一到 CHANGELOG.md

### Changed
- 变更记录从 README「更新记录」长章节迁移到本文件（单一事实来源），README 只留指引链接
- 移除临时的 `docs/dev-log/` 散文件方案，统一走 GitHub 官方 CHANGELOG 惯例
- 开发约定固化：每轮完成 → 更新本文件 + 提供 GitHub Desktop 提交文案

## [2026-08-28] V1.2 收尾：修复队标样式损坏 + CS2 真实赛程 + 返回层级栈

> 前置提交 `836af41 返回键修改` 引入三处损坏，本次全部修复；关联提交 `9aa3087`。

### Fixed
- **队标布局破坏**（用户反馈"插入的图标把网页搞坏了"）：`.team-logo` 缺 `position:relative` 导致队徽绝对定位逃逸到全页；徽标 `<img>` 无尺寸样式按原图渲染撑爆布局。补齐定位上下文 + `overflow:hidden` + `.team-logo-badge img` 等比缩放；图片失败回退彩色缩写圆
- **球队选择器组件无样式**：`ts-chip`/`ts-online-*`/`ts-manual-row`/`ts-done-btn` 等全部补齐 CSS；弹窗容器补 `.modal` 类恢复居中与移动端底部抽屉
- **返回键无效**：上次提交只有 `pushState` 没有 `popstate`。现补层级栈（详情 → 列表、选择器/记录弹窗 → 关闭、跨页回退）；`navigate` 同页刷新改 `replaceState` 防栈堆积；页面内返回按钮、Escape、浏览器返回键三条路径统一走 `history.back()`
- **书籍简介拿不到**：`book.douban.com` 详情页被反爬（302 → sec.douban.com），改走 `m.douban.com/rexxar/api/v2/book/{id}` 优先（HTML 解析留作兜底）；保存入库补 `rating/translator/publish_date`

### Added
- **CS2 真实赛程**（此前为 `nextDate()` 静态假数据，V1.2 §12 禁止项）：Liquipedia MediaWiki API（免密钥；gzip + 描述性 UA + 服务端缓存 5 分钟，合规 ≤2 req/s）。`/api/sports?type=cs2matches` 解析 `Liquipedia:Matches` ticker（约 50 场未来/进行中/刚完赛，真队标/赛事/Bo 赛制/比分）；客户端缓存 + last_synced_at + 失败重试横幅；关注按名称键双向匹配
- **足球按关注球队拉取**：`/api/sports?type=matches&ids=` 增加 `eventsnext/eventslast` 按队取下一场 + 最近结果（免费档联赛 fixtures 只有 1 场，覆盖不了主队）
- **CS2 搜索兜底**：TheSportsDB 搜 NAVI 无结果 → Liquipedia opensearch 兜底（队标取战队页 infobox 首图，重定向页自动跟随）
- 赛程同步失败横幅（显示上次成功时间 + 重试，§6.3）

### Removed
- 静态假赛程 `CS2_SCHEDULE` / `FOOTBALL_SCHEDULE` / `nextDate()` —— 无缓存时显示空态/失败态，不用 mock 冒充真实数据（§12）

### 实测（本地 server.py + 浏览器端到端）
- CS2：关注 NAVI/Virtus.pro → paiN vs NAVI **LIVE**、M80 **2:1** NAVI，真队标上墙
- 足球：关注阿森纳 → 下一场"维拉 vs 阿森纳 9/1 03:00"（UTC 自动转北京时间）+ 最近 3:0 + 焦点卡
- 电影：《奥本海默》保存后详情页含 导演/类型/豆瓣评分 ★8.8/片长 180 分钟/上映/完整中文简介
- 书籍：《百年孤独》简介/出版社（南海出版公司）/页数 360/译者/评分 9.3
- 返回键：详情→返回回列表 ✓；选择器→返回关闭并刷新 ✓，均不退出网页

### 已知限制
- TheSportsDB 免费档：中超可搜索/有真队徽，赛程覆盖以五大联赛+欧冠为主
- CS2 个别旧完赛场次 ticker 无比分 → 显示"已结束"而非编造数字
- Liquipedia ticker 保留约 50 场窗口，更早历史结果不展示

## [2026-08-28] 返回键修改（首次尝试，样式损坏由上一节修复）

### Changed
- `navigate`/`openDetail` 接入 `history.pushState`，详情页返回按钮改 `history.back()`
- 球队选择器 v2：页面内直开、热门网格真实队标（注册表补 `tsdb_id`+badge）、联赛 chips 筛选、TheSportsDB 在线搜索关注
- 电影/书籍选中后并行拉取豆瓣详情补全（简介/导演/评分/出版社/ISBN）
- 足球赛程接 TheSportsDB `eventsnextleague`（联赛 fixtures）；新增 `/api/sports` 代理
- ⚠️ 该提交遗漏 popstate 监听与配套 CSS，问题在 [2026-08-28] V1.2 收尾 小节修复

## [2026-08-28] 电影/书籍搜索改走豆瓣代理

### Changed
- 新增 `functions/api/douban.js`（CF Pages Function）代理豆瓣 `subject_suggest`，免 API Key、绕过浏览器 CORS 与 GFW
- 电影弃用 iTunes-US（中文片名搜不到）、书籍弃用 Google Books（大陆被墙），`server.py` 同步镜像 `/api/douban`
- 豆瓣图源走 `/img?url=` 代理避免防盗链；音乐 iTunes 加 `country=CN` 提升中文覆盖

### 已知缺口（后续已补）
- 豆瓣 suggest 无简介/导演/评分 → 后续经 rexxar 详情 API 补全（见上）

## [2026-08-28] V1.2 合规修正

### Added
- 事件/日记/地点详情页顶部注入「📍地点 · 🕒时间」徽标（§7）
- 球队手动关注输入框（`addManualTeam`，provider:'manual'）缓解静态列表"搜不到"（§6.1 过渡，后被真实 Provider 搜索替代）
- 全量 V1.2 条款中文注释（6 处）

## [2026-08-28] V1.1 智能记录与资源聚合

### Added
- 多次记录 `entries[]` 追加模型：一次保存可持续追加，历史不可覆盖，旧记录自动迁移
- 全类型多图上传（JPG/PNG/WebP，≤10MB，预览/删除/放大/失败重试，图片失败不丢正文）
- 删除手动填写作品字段（评分/标签/客观资料），用户只留感受 + 照片
- 电影墙 / 书籍墙（阅读状态筛选）/ 年度回顾（统计 + 月度图 + 类型分布）
- Sports 推荐理由（Match Score = 主队 + 重要度 + 赛事权重 + 临近度）+ 本地缓存 last_synced_at
- 两步式添加工作流（选类型 → 表单）、Bottom Sheet、移动端手势与键盘适配

## [2026-08-28] 项目初始（P0–P4 逐阶段）

### Added
- P0-P1：本地 IndexedDB 数据层、豆瓣电影搜索导入、图片代理、Cloudflare Pages 部署
- P2：电影墙/书籍墙/详情页「作品资料 vs 个人记录」分区、CS/足球资源页（当时为静态演示数据）
- P3-P4：CS 战队/足球俱乐部关注（注册表）、主队选择、数据适配器架构、首页"我的赛程"、Cloud Sync Adapter 接口预留
