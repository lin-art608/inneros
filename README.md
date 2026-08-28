# InnerOS · 个人数字空间

Personal digital space for memory, resources, sports and life.

线上地址：[inneros.pages.dev](https://inneros.pages.dev) · [inneros.asia](https://inneros.asia)

---

# 更新记录

## 2026-08-28 V1.2 收尾：修复队标样式损坏 + CS2 真实赛程 + 返回层级栈完善

> 前一提交（返回键修改）遗留三类问题本次全部修复，并补齐 CS2 真实数据源缺口。所有接口经本地实测。

### fix: 队标/选择器样式损坏（用户反馈"插入的图标把网页搞坏了"）
- `.team-logo` 缺 `position:relative` → 徽标绝对定位逃逸到全页；补齐定位上下文 + `overflow:hidden`
- 徽标 `<img>` 无尺寸样式 → 原尺寸撑爆布局；新增 `.team-logo-badge img` 等比缩放规则（透明 PNG 回退彩色缩写圆）
- 选择器 v2 的全部组件类（`ts-chips`/`ts-online-*`/`ts-manual-row`/`ts-done-btn` 等）无样式 → 按既有设计语言补齐
- 选择器弹窗容器补 `.modal` 类：居中/内边距/移动端底部抽屉行为恢复
- 新增 `.sync-fail-banner`（赛程同步失败横幅）

### feat: CS2 真实赛程（此前为静态假数据，§6.1/§12 GAP）
- 数据源 = Liquipedia MediaWiki API（免密钥；合规：gzip + 描述性 UA + 服务端缓存 5 分钟，≤2 req/s）
- `/api/sports?type=cs2matches` 解析 `Liquipedia:Matches` ticker：约 50 场未来+进行中+刚完赛场次，
  含时间戳/队名/真队标/赛事/Bo 赛制；比分按 winner 标记解析（M80 2:1 NAVI 实测）
- `ensureCS2Matches()` 客户端缓存 + last_synced_at + 失败重试；关注匹配按名称键（LP 页面标题/短名 ↔ 注册表/tsdb/在线搜索名）
- 静态 `CS2_SCHEDULE`/`FOOTBALL_SCHEDULE`/`nextDate()` 删除——无缓存时显示空态/失败态，不用 mock 冒充真实数据

### feat: 足球按关注球队拉取赛程（联赛 fixtures 只有 1 场，覆盖不了主队）
- `/api/sports?type=matches&ids=` 增加 `eventsnext/eventslast` 按队拉取（下一场 + 最近结果，去重合并）
- 实测：阿森纳下一场（维拉 vs 阿森纳，UTC→北京时间自动转换）+ 最近 3:0 全部上墙

### feat: CS2 搜索兜底（TheSportsDB 电竞覆盖差）
- 搜 NAVI 在 TheSportsDB 无结果 → Liquipedia opensearch 兜底（`provider:'liquipedia'`，id 前缀 `lp:`）
- 队标取战队页 infobox 首图，重定向页（NAVI→Natus_Vincere）自动跟随；每队结果缓存

### fix: 书籍简介/出版社改走 rexxar（HTML 详情页被反爬）
- `book.douban.com/subject/{id}` 对数据中心 IP 302 到 sec.douban.com → 详情解析拿不到数据
- 改 `m.douban.com/rexxar/api/v2/book/{id}` 优先（实测：百年孤独 简介/出版社/页数/译者/评分 9.3 全通），HTML 解析留作兜底
- 书籍保存入库补齐 `rating`/`translator`/`publish_date`（评分来自 Provider，禁止手填）

### fix: 返回键层级栈真正生效（前一提交只有 pushState 没有 popstate）
- 补 `popstate` 监听：详情层回列表、跨页回退、选择器/记录弹窗层随栈关闭
- `navigate` 同页刷新改 `replaceState`（保存/删除后不堆积重复层）；`openTeamSelector`/`openCapture` 入栈
- 页面内返回按钮、Escape、浏览器返回键三条路径统一走 `history.back()` → popstate 收尾（含关注后页面刷新）
- 实测：详情→返回回列表、选择器→返回关闭并刷新，均不退出网页

### 实测记录（本地 server.py + 浏览器端到端）
- CS2：NAVI/Virtus.pro 关注 → paiN vs NAVI **LIVE** + M80 2:1 真实队标上墙
- 足球：阿森纳关注 → 下一场/最近结果/焦点卡，真队徽，时间本地化
- 电影：奥本海默 搜索→选片→保存 → 详情页 导演/类型/豆瓣评分 8.8/片长/上映/完整中文简介

## 2026-08-28 V1.2 Agent 执行计划合规修正

> 依据 `InnerOS_V1.2_Agent_执行计划.docx`（P0→P6）审计后修正。原则：先审计再迭代，不重写。

### feat: 事件详情突出地点+时间 (§7)
- 事件/日记/地点详情页顶部注入「📍地点 · 🕒时间」徽标（heroMeta 双向分支）
- 缓解"详情找不到在哪、什么时候"的查看成本

### feat: 球队支持手动关注任意战队 (§6.1 过渡)
- 球队选择器新增"手动关注"输入框（`addManualTeam`），存 `provider:'manual'`
- 缓解硬编码列表导致的"搜不到球队"问题；待真实 Provider Adapter 接入后替换

### docs: 全量 V1.2 § 中文注释
- 6 处注释标注对应条款，便于后续对照规范管理：
  Provider 层真实源(§5) / Sports 静态注册表 GAP(§6.1·§12) / Seed 演示数据(§12) /
  toggleTeam 临时 provider(§6.1) / addManualTeam 过渡(§6.1) / 事件详情顶部(§7)

### 已知阻塞（未动，待决策）
- Sports 真实 Provider 需密钥，§12 禁止购买/提交密钥 → 真实赛程聚合暂未接
- 视觉重构(P5)、全量回归(P6) 未做

## 2026-08-28 数据源更换：电影/书籍改豆瓣代理

> 依据 V1.2 审计结论实施（先审计、再迭代）。解决"中文搜不到 + 中国大陆不可达"两类根因。

### refactor: 电影/书籍搜索改走豆瓣（/api/douban）
- 新增 `functions/api/douban.js`（Cloudflare Pages Function）：代理豆瓣 `subject_suggest`，
  电影/书籍统一归一化为既有字段名；**免 API Key**，绕过浏览器 CORS 与 GFW。
- `app.js`：`searchMovie` / `searchBook` 改调 `/api/douban`（弃用 iTunes-US、Google Books）。
  - 电影：此前 iTunes(US 商店) 中文片名/中文电影搜不到 → 现豆瓣中文覆盖完整。
  - 书籍：此前 Google Books 在大陆 `googleapis.com` 常被墙/超时 → 现豆瓣中国大陆可达。
- `app.js`：`searchMusic` 加 `country=CN`，提升中文歌曲/歌手覆盖（音乐数据源保留 iTunes）。
- `app.js`：`downloadImageAsDataURL` 对 `doubanio.com` 图源改走 `/img?url=` 代理，避免防盗链丢图。
- `server.py`：新增 `/api/douban` 路由，与线上 Function 行为一致，本地 `python server.py` 预览同效。

### 实测（本地 server.py）
- 电影：星际穿越 / Interstellar → 正确返回（中文名 + 原名 + 海报 + 年份）
- 书籍：百年孤独 / 三体 → 作者、封面、年份齐全

### 已知缺口（暂缓，待补全）
- 导演 / 简介 / ISBN / 出版社 暂为空：豆瓣详情接口（`/j/subject/`）已被限流/改版，仅 `subject_suggest` 稳定可用。
  后续可用豆瓣详情页 HTML 解析或换 TMDB/Open Library（需评估大陆可达性）补全。

## 2026-08-28 V1.1 智能记录与资源聚合

### feat: 多次记录数据模型 (entries[] 追加模式)
- 每条记录改为 entries[] 数组，支持多次追加，历史不可覆盖
- 数据结构: { base_info, entries: [{ id, created_at, content, photos[] }] }
- 详情页按时间顺序展示所有记忆条目，每条带独立时间戳
- 向后兼容：旧记录自动迁移到 entries[] 格式
- 详情页"编辑"按钮改为"＋ 追加记录"，追加时不预填旧内容

### feat: 图片上传 (所有笔记类型)
- 电影/书籍/日记/事件/音乐/游戏/地点 全部支持多图照片上传
- 支持 JPG/PNG/WebP，单张最大 10MB
- 预览缩略图 + 删除按钮 + 点击放大
- 照片与每条记录绑定，base64 存储在 IndexedDB

### fix: 删除手动填写作品字段
- 电影：删除评分星星、标签输入。片名只读（搜索自动填充）
- 书籍：删除评分星星、标签。书名/作者只读（搜索自动填充）
- 音乐/游戏/地点：删除评分星星、标签
- 用户只保留：感受/笔记 + 照片

### feat: 书籍数据源更换为 Google Books API
- 从豆瓣搜索换为 Google Books API
- 自动导入：封面、书名、作者、出版社、出版时间、ISBN、分类、简介、页数

### feat: Sports 推荐理由 + 数据缓存
- 每张比赛卡片显示 ★ 星级 + "为什么值得关注"理由
- localStorage 缓存 + last_synced_at，30分钟同步间隔

---

## 2026-08-28 P3-P4 资源整合与架构预留

### feat: CS赛事俱乐部Logo (替换国旗)
- 用各战队品牌色+缩写圆形Logo (NAVI/G2/FaZe/Vitality等12支战队)

### feat: 主队选择功能
- CS和足球页面都有"+ 添加主队"按钮
- 主队存储在 IndexedDB teams 表
- 12支CS2战队 + 18支足球俱乐部可选

### feat: 数据适配器架构 + 推荐算法
- 统一比赛模型，当前静态数据，未来替换API只需改数据源
- Match Score = 主队权重 + 重要程度 + 赛事权重 + 临近度

### feat: 首页"我的赛程" + P4架构预留
- 首页自动展示关注球队的未来比赛
- SyncAdapter 接口预留，设置页展示未来 Supabase 架构

---

## 2026-08-28 P2 内容展示

### feat: 电影墙 / 书籍墙 / 年度回顾
- 电影墙：搜索筛选 + 评分筛选 + 按年份分组 + 统计概览
- 书籍墙：阅读状态筛选 + 按年份分组 + 状态标签
- 年度回顾：统计卡片 + 月度柱状图 + 评分排行榜 + 类型分布

### feat: 详情页分区 + 资源视觉
- 作品资料 vs 个人记录 明确分区
- CS焦点hero卡 + 足球联赛卡片（8联赛各自配色）

---

## 2026-08-28 P0-P1 界面与工作流

### feat: 两步式添加工作流 + 动画 + 移动适配
- 第一步选类型卡片，第二步进对应表单
- 页面切换淡入动画 + 卡片进入动画
- 移动端 Bottom Sheet + 触控滑动 + 响应式布局

### feat: 豆瓣电影搜索 + 图片代理 + GitHub部署
- /api/search 代理豆瓣 API，搜索后自动导入片名/海报/年份
- Cloudflare Functions 代理豆瓣图片，CDN节点自动切换
- 仓库：github.com/lin-art608/inneros
