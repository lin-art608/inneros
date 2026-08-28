# InnerOS 更新记录

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
- 从豆瓣搜索换为 Google Books API (https://www.googleapis.com/books/v1)
- 自动导入：封面、书名、作者、出版社、出版时间、ISBN、分类、简介、页数
- 详情页展示完整作品资料

### feat: Sports 推荐理由
- 每张比赛卡片显示 ★ 星级评分
- 显示"为什么值得关注"理由，如："主队 + 强强对话 + 临近开赛"
- 推荐逻辑透明：主队权重 + 重要程度 + 赛事权重 + 临近度

### feat: Sports 数据缓存
- localStorage 存储 last_synced_at
- 30 分钟同步间隔，不每次打开都请求 API
- needsSportsRefresh() 判断是否需要刷新

---

## 2026-08-28 P3-P4 资源整合与架构预留

### feat: CS赛事俱乐部Logo (替换国旗)
- 用各战队品牌色+缩写圆形Logo (NAVI黄黑、G2黑白、FaZe红等12支战队)
- 不再用国家旗帜，改用俱乐部品牌色

### feat: 主队选择功能
- CS和足球页面都有"+ 添加主队"按钮
- 弹出选择弹窗，搜索/添加/移除主队
- 主队存储在 IndexedDB teams 表 (provider, provider_team_id, sport, color)
- 12支CS2战队 + 18支足球俱乐部可选

### feat: 数据适配器架构
- 统一比赛模型：{ sport, home_id, home_name, home_color, date, time, status, league, score, importance }
- 当前用静态赛程数据（未来替换为真实API只需改数据源，UI不变）

### feat: 推荐算法 (Match Score)
- Score = 主队权重(10) + 比赛重要度(1-5) + 赛事权重(1-5) + 临近度(0-5)
- 关注球队的比赛自动排序靠前

### feat: 首页"我的赛程"
- 首页自动展示关注球队的未来比赛
- 每条显示：时间、队名、Logo、联赛、轮次

### feat: P4 数据库架构预留
- SyncAdapter 接口预留 (init/login/syncAll 方法桩)
- 设置页面新增"云端同步"区块，展示未来 Supabase 架构

---

## 2026-08-28 P2 内容展示

### feat: 电影墙增强
- 搜索框（按片名/原名/导演/类型搜索）
- 评分筛选（全部/★5/★4+/★3+）
- 统计概览栏（总数、平均评分、今年看过）
- 按年份分组展示海报网格，带卡片进入动画

### feat: 书籍墙增强
- 阅读状态筛选标签（全部/想读/在读/已读）
- 已读书籍按年份分组
- 每张书卡显示状态标签

### feat: 详情页分区重构
- 作品资料 (Work Info)：导演、作者、艺人、类型、片长、上映年份
- 我的记录 (My Record)：观看日期、时间、心情、分类、重要程度

### feat: 年度回顾页面
- Hero统计卡片 + 四类型统计 + 月度柱状图 + 评分排行榜 + 类型分布

### feat: 资源整合视觉提升
- CS赛事：焦点hero卡 + 即将开始 + 最近结果
- 足球：今日焦点 + 热门联赛卡片（8联赛各自配色）
- 侧边栏：渐变背景、金色高亮

---

## 2026-08-28 P0-P1 界面与工作流

### feat: 页面切换动画
- 轻量淡入/位移动画 (pageEnter 0.35s)
- 卡片进入动画 (card-enter, 延迟递增)
- 加载状态样式

### feat: 两步式添加工作流
- 第一步：选择类型（电影/书籍/日记/事件/音乐/游戏）
- 第二步：进入对应类型的表单填写界面
- 类型选择卡片化，点击有即时反馈

### feat: 移动端适配
- Bottom Sheet 弹窗
- 触控滑动手势
- 响应式CSS布局
- 键盘适配

### feat: 豆瓣电影搜索导入
- 通过 /api/search 代理调用豆瓣 j/subject_suggest API
- 搜索结果实时显示
- 选择后自动填充片名、海报、年份
- 海报自动下载为base64缓存到IndexedDB

### feat: 图片代理
- Cloudflare Functions 代理豆瓣图片，设置Referer绕过防盗链
- CDN节点自动切换 (img1-img9)

### feat: GitHub + Cloudflare 部署
- 仓库：https://github.com/lin-art608/inneros
- 线上：https://inneros.pages.dev
- 自定义域名：https://inneros.asia
