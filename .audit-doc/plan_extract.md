InnerOS V1.2数据源、实时聚合与视觉重构 Agent 执行计划
基于 V1.1 开发执行文档的分阶段实施方案｜先数据、后架构、再体验
0. 文档目的
本文件是给 Agent 的施工计划，不是单纯产品建议。必须按 P0→P1→P2→P3→P4→P5→P6 顺序推进。每阶段完成后测试、commit，并在规定停点等待确认。不得为了省事推翻现有项目。
1. 核心判断：为什么现在会“搜索不到”
当前反馈说明问题首先应从数据链路查起，而不是继续增加页面字段。电影、书籍、音乐、足球、CS2 的公共资料不应依赖一个很小的本地 JSON 数据库。正确思路是外部 Provider/API 按需搜索，返回稳定 ID，再获取详情；InnerOS 本地只保存用户真正使用过的对象、个人记忆和必要缓存。
禁止用 mock 数据冒充真实搜索结果。
必须查清 Provider、endpoint、认证、CORS、HTTP 状态、query 参数、语言/market、限流、详情接口和字段映射。
客观资料与个人记忆分离；评分、导演、演员、作者、出版社、简介等由数据源自动补全。
Provider 必须可替换；UI 不直接依赖第三方字段。
Sports 是数据聚合，不是第三方链接导航。
2. 总路线图与优先级
阶段
优先级
做什么
停点
Commit
P0
最高
审计+定位所有数据失败原因
审计报告→用户确认
原则上不改代码
P1
最高
电影/书籍/音乐真实搜索与导入
三类 Provider 实测通过
分别 commit
P2
高
Domain/Service/Repository/Cache/错误层
架构测试通过
refactor commit
P3
高
Football/CS2 真实聚合、关注、同步
Sports 实测通过
sports commits
P4
高
Memory、追加、时间戳、图片、时间线
记录链路通过
memory commits
P5
中
全新私人数字收藏馆视觉
桌面+移动通过
UI commits
P6
最高
全量回归、密钥检查、回滚演练
最终验收
release/final commit
3. P0：项目审计——现在只查，不改
这是第一优先级。Agent 不允许凭感觉换 API。必须从现有代码找到真实失败点。
确认前端框架、构建工具、启动/构建/测试命令和目录结构。
确认 Git 分支、工作区是否有未提交修改、最近 commit；保护用户现有版本。
定位电影、书籍、音乐搜索入口以及实际请求函数。
定位搜索→结果→选择→详情→导入的完整链路。
定位 Football、CS2 数据来源以及球队/战队和赛程的数据结构。
搜索项目内所有 mock、JSON、硬编码球队/赛事/作品数组。
检查环境变量读取方式；只报告变量名和缺失/存在状态，绝不输出密钥。
检查 Network/console 对 401、403、404、429、CORS、超时、JSON 解析错误的处理。
用真实测试词验证：星际穿越、百年孤独、晴天、Manchester City、NAVI。
检查当前字段映射：评分、导演、演员、海报、作者、出版社、ISBN、歌曲/专辑/艺人等。
检查当前 Sports 是否有缓存、last_synced_at、刷新机制和失败重试。
输出当前架构图、问题根因、具体文件、改造顺序和风险；不要修改代码。
P0 完成标准：必须能回答“为什么搜不到”，并指出具体代码/配置链路，而不是笼统说“API 不稳定”。
4. P1：真实数据优先——电影/书籍/音乐
4.1 电影
搜索必须调用真实电影 Provider；选择结果后使用 provider_id 获取完整详情。
结果卡至少显示海报、片名、原名、年份、类型、评分、简介摘要。
导入自动保存 title、original_title、release_date/year、poster、backdrop、overview、vote_average、genres、director、cast、runtime、provider、provider_id、external_id（以实际 Provider 为准）。
评分必须来自 Provider，用户不能手填评分。
导演、演员、年份、类型、简介、海报不能让用户重复填写。
搜索成功而详情失败时，必须有明确错误和重试。
图片 URL 必须统一处理，不能出现相对路径导致海报失效。
4.2 书籍
必须使用真正图书数据源，不以抓网页作为核心。
支持书名、ISBN，必要时支持作者关键词。
自动补全 title、subtitle、authors、description、publisher、publishedDate、ISBN10、ISBN13、categories、subjects、language、pageCount、cover、previewUrl（数据源允许时）。
禁止手填作者、出版社、简介、ISBN、出版日期、分类等客观资料。
覆盖不足时通过 Adapter 增加/替换 Provider，而不是堆静态 JSON。
4.3 音乐
真实支持歌曲、专辑、艺人搜索。
结果显示封面、名称、艺人/专辑、发行信息。
自动保存 track、artist、album、album_cover、release_date、genres、duration、provider、provider_id、external_url（以 Provider 为准）。
若需要 OAuth、market 或开发者权限，必须验证真实认证流程；不得伪造成功。
不得用少量歌曲 JSON 作为正式音乐数据库。
5. P2：统一数据层
目标是解决“换一个 API 就要改整个页面”的问题。建议形成：UI→Domain Model→Service→Provider Adapter→External API；UI→Repository→Local Storage/Cache。实际文件名必须以 P0 审计结果为准。
Provider Adapter：第三方字段映射为 InnerOS 标准字段。
Service：负责搜索、详情、导入、业务规则。
Repository：保存用户对象、个人记录和缓存。
统一错误类型：网络、认证、限流、未找到、Provider、解析错误。
统一 SearchResult / DetailsResult 结构。
所有外部请求从页面组件中移出。
建立缓存和 last_synced_at，避免页面每次打开都无条件请求。
公共数据按需获取；本地不建立所谓“全世界作品数据库”。
建议接口（具体类型按项目技术栈调整）：
interface SearchProvider<T> {  search(query: string): Promise<SearchResult<T>[]>  getDetails(id: string): Promise<T>}
6. P3：Sports——真正实时、真正可扩展
用户指出“赛程源拉不到”和“数据库太小”，本阶段必须解决根因。公共球队/赛事资料来自 Provider；InnerOS 只保存关注关系和缓存。
6.1 Football
真实搜索球队并选择。
保存 provider、provider_team_id、sport、team_name，不只保存文本名称。
Sports 首页直接提供“＋添加关注/设为主队”，不能强迫用户进入通用设置。
设置页保留集中管理，但不是唯一入口。
显示下一场、最近 3～5 场、未来 7 天赛程。
显示赛事、对手、主客场、时间、状态、比分。
只展示用户关注球队。
显示 last_synced_at；失败保留上次成功数据并提供重试。
6.2 CS2
真实搜索战队并关注。
保存 provider_team_id。
显示下一场、最近比赛、赛事、对手、时间、状态、结果。
只显示用户关注战队。
6.3 同步
普通比赛使用合理缓存间隔。
临近比赛提高刷新频率；LIVE 时进一步提高，但必须遵守 Provider 限流。
打开页面不等于无条件请求。
显示“数据已更新·X分钟前”。
失败显示“数据更新失败+上次成功同步时间+重试”。
6.4 推荐
第一版使用透明规则：主队、临近比赛、赛事重要程度、对手强度、淘汰赛/决赛等，生成 Match Score，并给出简短理由，例如“主队 + 强强对话 + 临近开赛”。
7. P4：Memory 个人记忆链路
统一 Memory：基础作品/事件信息 + event_date + created_at + Entries[]。
Entry：entry_id、created_at、content、attachments[]。
所有电影、书籍、音乐、日记、事件、游戏记录支持照片。
一次保存后可持续追加，历史不可覆盖。
事件详情顶部突出地点与时间。
图片支持多图、预览、排序、删除、失败重试。
图片失败不能导致正文丢失。
时间线统一展示电影、书籍、音乐、日记、事件等记忆。
8. P5：全新视觉——私人数字收藏馆
不要继续在旧 SaaS Dashboard 上微调颜色。目标是“私人数字收藏馆 / Memory OS / Digital Archive / Editorial / Cinematic”。高级、安静、沉浸、视觉优先，但不堆无意义特效。
首页：像个人档案馆入口，而不是后台仪表盘。
电影墙：海报优先，按年份/月组织。
书籍墙：私人书架感，按状态/年份组织。
音乐：专辑/歌曲视觉优先。
时间线：作为核心 Memory Timeline。
详情页：客观资料与 MY MEMORY 明确分区。
添加：＋→选择类型→进入对应工作流。
搜索：输入→loading→结果→选择→详情→导入；无结果和错误有明确状态。
Sports：用户关注内容优先，不做全量赛事堆砌。
移动端：Bottom Sheet、单手操作、键盘遮挡、上传、动画全部测试。
9. P6：测试矩阵
模块
正常
异常
通过条件
电影
中文/英文搜索→详情→导入
空结果、401、429、网络、详情失败
真实资料完整
书籍
书名/ISBN→导入
无结果、Provider 失败
作者/出版社/ISBN自动补全
音乐
歌曲/专辑/艺人
认证/market/限流/无结果
真实目录结果
Football
球队→关注→主队→赛程
同步失败
只显示关注球队+同步时间
CS2
战队→关注→比赛
Provider 错误
只显示关注战队
Memory
保存→追加→图片
图片失败
正文不丢、历史不覆盖
UI
桌面+移动操作
小屏、键盘、网络失败
无白屏、无溢出
10. Git、分支和回滚
P0 开始前确认工作区状态，不覆盖用户未提交工作。
重大阶段使用独立分支。
每个可验证功能独立 commit。
建议：feat: rebuild movie provider；feat: rebuild book provider；feat: rebuild music provider；refactor: introduce provider adapters；feat: rebuild sports data layer；feat: add sports following；feat: add match sync；feat: redesign memory archive UI。
出现回归时优先回滚对应阶段 commit，不要把整个项目推倒重来。
最终必须能从稳定 commit 恢复。
11. Agent 的阶段停点
P0：审计报告完成→停止→用户确认。
P1：电影、书籍、音乐真实搜索/导入全部通过→停止→用户确认。
P2：统一数据层、缓存、错误处理通过→停止。
P3：足球/CS2 关注、赛程、同步通过→停止。
P4：记录、追加、时间戳、图片、时间线通过→停止。
P5：视觉重构桌面/移动通过→停止。
P6：最终回归、密钥扫描、Git 回滚检查→最终验收。
12. 绝对禁止
禁止用 mock 数据伪装真实数据。
禁止为了“数据库变大”硬编码大量作品、球队、赛程。
禁止提交 API Key、Token、Secret、密码。
禁止购买 API 或付费服务。
禁止接入 Supabase。
禁止修改 Cloudflare DNS。
禁止无理由重写现有项目。
禁止把第三方链接列表当成 Sports 聚合。
禁止让用户手填电影评分、导演、演员、年份等客观资料。
禁止图片上传失败导致正文丢失。
13. 可直接复制给 Agent 的第一条指令
请严格执行《InnerOS V1.2 数据源、实时聚合与视觉重构 Agent 执行计划》。执行顺序固定为：P0 审计 → P1 电影/书籍/音乐真实数据 → P2 统一数据层 → P3 Sports → P4 Memory → P5 视觉 → P6 测试。现在只执行 P0，禁止修改代码。请审计当前项目真实技术栈、目录、Git 状态、电影/书籍/音乐/Sports Provider、API 请求、认证、环境变量、CORS、HTTP 状态、query 参数、语言/market、字段映射、搜索→详情→导入链路、缓存、同步和当前 UI。实际验证：电影：星际穿越书籍：百年孤独音乐：晴天足球：Manchester CityCS2：NAVI必须查清“搜索不到内容”的具体根因。不要猜测，不要制造假数据。如果缺 API Key，只报告变量名和缺失状态，不输出密钥。如果需要 OAuth、market 或特殊权限，明确指出。如果 CORS、401、403、404、429、超时、JSON 解析或字段映射有问题，明确指出。如果搜索成功但详情失败，明确指出。P0 输出：A 当前架构B 五类数据真实请求链路C 每个 Provider 的故障根因D 需要修改的具体文件E Provider Adapter 改造方案F P1-P6 施工顺序G 测试方案H Git 分支/commit/回滚方案P0 完成后停止，等待用户确认。全程禁止：提交密钥；制造假数据；购买 API；接入 Supabase；修改 Cloudflare DNS；无理由重写项目。
14. 最终验收清单
☐ 电影真实搜索、详情、评分、导演、演员、类型、简介、海报自动导入
☐ 书籍真实搜索、ISBN、作者、出版社、简介、分类自动补全
☐ 音乐真实搜索歌曲/专辑/艺人
☐ 无 mock 数据冒充真实数据
☐ Provider Adapter + Service + Repository
☐ 公共数据按需获取，个人数据本地保存
☐ Football/CS2 真实数据
☐ Sports 首页直接管理关注球队/主队
☐ 赛程缓存、同步、last_synced_at、失败重试
☐ 推荐具有可解释逻辑
☐ Memory 支持多次追加和独立时间戳
☐ 所有记录支持多图
☐ 图片失败不丢正文
☐ 电影墙、书籍墙、音乐、时间线采用收藏馆视觉
☐ 移动端流畅
☐ 每阶段有 Git commit 且可回滚
☐ 无密钥泄漏
15. 与 V1.1 的关系
V1.1 已明确提出：统一“＋添加”工作流、电影/书籍/音乐搜索后导入、客观资料自动补全、多次追加、图片、Sports 数据聚合、Provider Adapter、缓存同步、Git 可回滚，并要求在确认审计方案前不要修改代码。V1.2 将这些要求进一步拆成明确的 Agent 施工顺序。