# InnerOS · 个人数字空间

Personal digital space for memory, resources, sports and life.

线上地址：[inneros.pages.dev](https://inneros.pages.dev) · [inneros.asia](https://inneros.asia)

---

# 更新记录

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
