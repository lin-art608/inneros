# Changelog · 变更记录

本项目所有重要变更记录在此文件（GitHub 官方惯例，[Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/) 格式）。
开发约定：**每轮迭代完成后，Agent 直接在本文件新增/更新对应日期小节**，并在回复中附上 GitHub Desktop 的 Summary + Description 文案。

---

## [Unreleased]

（暂无）

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
