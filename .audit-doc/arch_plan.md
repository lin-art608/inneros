InnerOS
架构升级与 Codex 开发执行方案
面向长期维护、持续迭代与 AI / WeFlow / ChatLab 扩展的 V2 架构
目标：不推翻现有产品，不停摆开发；通过渐进式重构，把 InnerOS 从“功能型个人网站”升级为“个人数字记忆操作系统”。
一、执行结论：这次升级到底要解决什么
本方案不是让 Codex 把 InnerOS 全部重写，而是建立一套可长期维护的模块化架构，然后把现有 v1.x 功能逐步迁移进去。当前仓库已经具备较完整的产品能力：前端应用、Cloudflare Pages Functions、D1 云端存储、账户/会话、增量同步、媒体记录、时间线、收藏、体育、备份等。真正限制后续发展的不是“缺少功能”，而是随着功能继续增加，业务逻辑容易继续集中到少数大文件，数据模型和 UI/服务/API 耦合会越来越强。
问题
当前风险
升级方向
业务代码集中
修改一个功能容易影响其他功能
按领域拆分 modules/services/repositories
数据模型分散
电影、书籍、音乐、事件各自扩展
建立统一 Memory / Media / Event 核心模型
API 逻辑与业务逻辑混合
第三方 API 更换成本高
Adapter + Service + Repository 分层
同步是核心能力但缺少边界
未来接更多设备/数据源困难
Sync Engine + Operation Log + Version/Conflict 策略
AI 尚未成为独立层
以后接 ChatLab/LLM 容易污染业务代码
AI Gateway + Tool/Context 层
缺少测试护栏
Codex 改代码后回归风险高
单元测试 + API 集成测试 + E2E 烟雾测试
单体前端难维护
文件越来越大
渐进式模块化，不一次性重写
二、架构升级后的目标形态
建议最终采用“模块化单体 + 清晰边界”，而不是现在就拆微服务。对于 InnerOS 这种个人产品，微服务会带来不必要的部署、调试和数据一致性成本。
┌─────────────────────────────────────────────────────────────┐│                         InnerOS UI                          ││  Pages / Components / ViewModels / Client State            │└──────────────────────────────┬──────────────────────────────┘                               │┌──────────────────────────────▼──────────────────────────────┐│                    Application / Use Cases                   ││  createMemory / searchMedia / sync / import / export / AI  │└──────────────────────────────┬──────────────────────────────┘                               │┌──────────────────────────────▼──────────────────────────────┐│                         Domain Layer                         ││ Memory │ Media │ Event │ Diary │ Person │ Place │ Tag │ ... ││ 纯业务规则、类型、校验、状态机；不依赖 Cloudflare / DOM      │└───────────────┬─────────────────────┬──────────────────────┘                │                     │        ┌───────▼───────┐     ┌───────▼────────┐        │ Repositories  │     │    Adapters     │        │ IndexedDB/D1  │     │ Douban/WeFlow/  │        │ Sync/Backup   │     │ ChatLab/LLM/API │        └───────┬───────┘     └───────┬────────┘                │                     │        ┌───────▼─────────────────────▼─────────┐        │ Infrastructure                         │        │ Cloudflare Pages / Functions / D1     │        │ Fetch / Auth / Crypto / Logging       │        └────────────────────────────────────────┘
三、最重要的架构原则
不做一次性大重构：任何迁移必须允许旧代码和新模块短期共存。
领域优先：新增功能先定义数据模型和业务用例，再做 UI。
UI 不直接调用 D1、第三方 API 或 fetch：必须经过 Application Service。
第三方服务全部通过 Adapter 隔离，未来换豆瓣、TMDB、Open Library、音乐 API 或 LLM 时不改业务层。
数据库访问集中到 Repository；页面不得出现 SQL。
同步系统视为基础设施，不允许各业务模块自行发明同步规则。
所有跨模块调用通过明确接口完成，不通过全局变量互相调用。
先保持 Cloudflare + D1 架构，不为了“专业”而引入微服务、Docker、Redis、消息队列。
每完成一个迁移阶段必须可运行、可回滚、可验证。
Codex 每次只处理一个明确任务，禁止顺手重构整个项目。
四、当前仓库基线与升级判断
根据当前公开仓库页面可见结构，项目根目录已经出现 .audit-doc、.workbuddy/memory、functions、AGENTS.md、CHANGELOG.md、README.md、_headers、app.js、index.html 等文件/目录。提交记录也显示近期正在快速迭代 v1.7.x，并已经包含搜索、详情页、后端同步、操作日志等工作。
注意：本方案以你当前 main 分支为基线，不要求先把产品恢复到某个“理想状态”。如果实际源码与文档描述有差异，以运行中的代码和测试结果为准。
五、推荐的新目录结构
/├─ index.html├─ app.js                         # 过渡期入口，逐步变薄├─ functions/│  ├─ api/│  │  ├─ auth.js│  │  ├─ memories.js│  │  ├─ media.js│  │  ├─ sync.js│  │  ├─ search.js│  │  └─ ai.js│  ├─ domain/│  │  ├─ memory/│  │  ├─ media/│  │  ├─ event/│  │  └─ user/│  ├─ services/│  │  ├─ memory-service.js│  │  ├─ media-service.js│  │  ├─ sync-service.js│  │  ├─ search-service.js│  │  └─ ai-service.js│  ├─ repositories/│  │  ├─ memory-repository.js│  │  ├─ media-repository.js│  │  ├─ sync-repository.js│  │  └─ user-repository.js│  ├─ adapters/│  │  ├─ douban-adapter.js│  │  ├─ weflow-adapter.js│  │  ├─ chatlab-adapter.js│  │  └─ llm-adapter.js│  ├─ infra/│  │  ├─ db.js│  │  ├─ auth.js│  │  ├─ crypto.js│  │  ├─ logger.js│  │  └─ http.js│  └─ index.js├─ src/                           # 前端逐步迁移目标│  ├─ app/│  ├─ components/│  ├─ pages/│  ├─ modules/│  │  ├─ memory/│  │  ├─ media/│  │  ├─ timeline/│  │  ├─ diary/│  │  ├─ sports/│  │  ├─ favorites/│  │  ├─ sync/│  │  └─ settings/│  ├─ services/│  ├─ repositories/│  ├─ store/│  ├─ utils/│  └─ types/├─ tests/│  ├─ unit/│  ├─ integration/│  └─ e2e/├─ docs/│  ├─ architecture/│  ├─ api/│  ├─ data-model/│  ├─ decisions/│  └─ operations/├─ scripts/├─ migrations/└─ AGENTS.md
说明：不要立即把所有文件移动到上述目录。先建立边界，再逐模块迁移。现有 app.js 可以作为兼容入口，在迁移完成前继续工作。
六、核心数据架构：把 InnerOS 真正变成“记忆系统”
这是本次升级最重要的部分。未来电影、书、音乐、旅行、日记、人生事件、微信聊天、照片、收藏等，都应该能落到统一的 Memory 语义上。
Memory├─ id├─ userId├─ type                # media | event | diary | note | conversation | place ...├─ title├─ occurredAt          # 事情发生时间├─ createdAt            # 写入时间├─ updatedAt├─ content              # 用户正文/笔记├─ summary              # AI/系统摘要，可为空├─ rating               # 用户评分，可为空├─ tags[]├─ people[]├─ places[]├─ mediaRefs[]├─ source               # manual | weflow | import | api | ai├─ sourceRef            # 外部 ID├─ metadata              # 类型扩展字段├─ version└─ deletedAt            # tombstone
6.1 Media 不要继续与 Memory 完全割裂
建议 Media 作为 Memory 的一种结构化类型，而不是另建一套完全独立的数据世界。
Media├─ memoryId├─ mediaType             # movie | book | music | game | series├─ externalProvider      # douban | tmdb | openlibrary | ...├─ externalId├─ title├─ originalTitle├─ poster├─ releaseDate├─ creators[]             # director / author / artist├─ genres[]├─ score├─ description└─ providerMetadata
6.2 Event / Diary / Conversation
Event：某一天发生了什么，可有地点、人物、图片、正文。
Diary：以文字为主的私人记录，本质上仍然是 Memory。
Conversation：WeFlow 导入的聊天片段或会话摘要，可以关联人物、时间、主题。
Collection/Favorite：尽量作为关系/状态，不复制完整 Memory 数据。
AI Insight：AI 产生的摘要、标签、关联建议必须保留来源和置信度，不能覆盖用户原始内容。
七、后端分层规范
层
允许做什么
禁止做什么
API/Route
解析请求、鉴权、参数校验、调用 Use Case、格式化响应
写 SQL、直接调用第三方 API、堆业务规则
Application Service
编排业务流程、事务边界、权限检查
操作 DOM、依赖具体第三方 SDK
Domain
业务规则、状态、数据类型、纯函数
fetch、D1、Cookie、Cloudflare API
Repository
CRUD、查询、持久化、分页
决定产品业务规则
Adapter
把外部 API 转换成 InnerOS 标准模型
把外部 API 字段直接泄漏到 UI
Infrastructure
数据库、网络、日志、加密、运行时
定义产品业务概念
八、第三方 API 架构：彻底解决“换 API 就要改全站”
所有媒体搜索都统一成内部接口。比如：
searchMedia({  type: "movie",  query: "星际穿越",  page: 1,  pageSize: 20})=> {  items: [{    externalId,    title,    originalTitle,    poster,    year,    creators,    genres,    score,    source  }],  page,  hasMore}
DoubanAdapter 负责把豆瓣响应转换成这个标准结构。未来加入 TMDBAdapter、OpenLibraryAdapter、MusicBrainzAdapter，只需要增加 Adapter 和 Provider 配置，不修改电影页面。
注意：外部 API 的原始 JSON 可以保留在 providerMetadata，但业务层不能直接依赖它。
九、同步系统升级：把它当作 InnerOS 的基础设施
你现在已经有操作日志和增量同步能力，这部分不要推翻。下一步要做的是把它抽象成统一 Sync Engine。
Local Change   ↓Operation Log   ↓Sync Queue   ↓POST /api/sync/push   ↓Server validates version   ↓D1 transaction   ↓Pull changes since cursor   ↓Local apply   ↓Advance cursor
9.1 同步对象必须统一
每个实体拥有稳定 id，而不是依赖数组下标。
每次变更拥有 operationId，保证重试幂等。
每个实体拥有 version 或 updatedAt，用于并发判断。
删除使用 tombstone，不直接物理删除，以便其他设备收到删除。
同步接口返回 cursor/nextCursor，避免每次全量拉取。
客户端同步必须可重复执行；同一个 operation 重放不能造成重复数据。
未来 WeFlow 导入也走同一个 ingestion/sync pipeline，而不是直接修改本地数据库。
十、API 规范
GET    /api/v1/meGET    /api/v1/memoriesPOST   /api/v1/memoriesGET    /api/v1/memories/:idPATCH  /api/v1/memories/:idDELETE /api/v1/memories/:idGET    /api/v1/media/searchGET    /api/v1/media/:idPOST   /api/v1/mediaPOST   /api/v1/sync/pushGET    /api/v1/sync/pull?cursor=...POST   /api/v1/import/weflowPOST   /api/v1/ai/askPOST   /api/v1/ai/ingest
版本化建议：以后所有新公共 API 使用 /api/v1；不要突然修改已有接口字段。破坏性修改进入 v2。
十一、统一错误处理
{  "success": false,  "error": {    "code": "MEDIA_PROVIDER_TIMEOUT",    "message": "媒体服务暂时不可用",    "requestId": "req_xxx",    "retryable": true  }}
UI 不解析第三方原始错误。
用户可见 message 与内部 debug 信息分离。
每个请求生成 requestId，便于日志追踪。
可重试错误必须明确 retryable。
认证、权限、校验、资源不存在、第三方故障、内部错误使用稳定 error code。
十二、前端架构升级
你现在的 app.js 可以继续存在，但必须把它从“业务实现文件”逐步降级为应用入口/兼容层。
src/├─ app/│  ├─ bootstrap.js│  ├─ router.js│  └─ app-context.js├─ modules/│  ├─ memory/│  │  ├─ memory.api.js│  │  ├─ memory.service.js│  │  ├─ memory.store.js│  │  ├─ memory.view.js│  │  └─ memory.types.js│  ├─ media/│  ├─ timeline/│  ├─ diary/│  ├─ sports/│  ├─ favorites/│  └─ settings/├─ components/├─ services/│  ├─ api-client.js│  ├─ sync-client.js│  └─ notification.js└─ utils/
页面事件只负责 UI 行为，不直接写数据库。
模块 Service 负责业务用例。
API Client 负责 HTTP。
Store 负责客户端状态。
Repository 负责本地 IndexedDB。
组件尽量无业务逻辑。
禁止新增全局 window.xxx 作为跨模块通信手段；若已有，迁移时逐步替换。
十三、为 WeFlow + ChatLab + AI 预留正确的扩展点
未来不要把 ChatLab 直接写进某个页面。正确方式是建立 AI Gateway 和外部数据源 Adapter。
WeFlow  ↓WeFlowAdapter  ↓Ingestion Service  ↓Memory / Conversation  ↓Context Builder  ↓AI Gateway  ├─ ChatLabAdapter  ├─ OpenAIAdapter  ├─ DeepSeekAdapter  └─ LocalModelAdapter
WeFlow 负责数据来源，不负责 InnerOS 的业务模型。
ChatLab 负责 AI/聊天能力，不成为 InnerOS 的数据库。
InnerOS 是长期数据的 Source of Truth。
AI 生成内容默认是 derived data，必须能追溯来源并允许删除/重新生成。
AI 不直接修改用户核心数据；涉及写入时先生成结构化提案，再由 Application Service 执行。
十四、安全与隐私
用户原始聊天、日记、记忆数据默认按私密数据处理。
第三方 API Key 必须放在 Cloudflare Secrets/环境变量，不进入前端 bundle。
AI 请求只发送必要上下文，默认最小化数据外发。
导入 WeFlow/聊天数据时记录 source 与 import batch id，支持撤销/删除。
管理接口必须进行服务端鉴权，不能只靠前端隐藏按钮。
日志禁止写入密码、session token、完整聊天正文和 API Key。
所有用户资源查询必须带 userId/权限条件，防止越权读取。
十五、测试体系：这是让 Codex 可以长期工作的关键
测试层
必须覆盖
目标
Unit
Domain、数据转换、冲突算法、校验
快、稳定
Integration
D1 Repository、API Route、Auth、Sync
验证真实边界
Provider Contract
Douban/WeFlow/ChatLab Adapter
防止第三方字段变化导致全站坏掉
E2E Smoke
登录→记录→编辑→同步→刷新
防止主流程回归
Migration
旧数据→新模型
保证升级不丢数据
每次 Codex 任务完成后至少执行：1. git diff --check2. 语法/类型检查（按项目现有工具）3. Unit tests4. API integration tests（涉及后端时）5. E2E smoke（涉及 UI/同步时）6. 手工验证本任务核心路径7. 输出变更文件、风险、测试结果
十六、实际迁移计划：按这个顺序开工
阶段
目标
规模
P0 基线冻结与体检
建立架构文档、测试入口、模块边界；不改产品行为。
1~2 个 Codex 任务
P1 前后端 API Client / Service 分层
把 fetch、数据库调用、业务流程从页面中抽离。
3~5 个任务
P2 Domain + Repository
建立 Memory/Media/Event 基础模型和 Repository。
4~6 个任务
P3 Media Provider Adapter
统一电影/书籍/音乐搜索与详情，隔离第三方 API。
3~5 个任务
P4 Sync Engine
统一 operation log、push/pull、cursor、冲突、tombstone。
4~6 个任务
P5 UI 模块化
将 app.js 中高耦合模块逐步迁移。
持续迁移
P6 WeFlow Ingestion
将聊天数据转换成 Memory/Conversation。
3~5 个任务
P7 AI Gateway + ChatLab
建立 AI Adapter、Context Builder、AI 写入提案。
3~5 个任务
P8 测试与发布
补齐 E2E、迁移脚本、备份、回滚和发布检查。
持续
十七、Codex 第一阶段任务清单（严格按顺序）
ID
任务
做什么
完成标准
ARCH-001
建立 docs/architecture/README.md
记录目标架构、边界、依赖规则、迁移原则。
只新增文档，不改业务。
ARCH-002
建立统一错误模型与 requestId
后端所有新 API 使用统一 success/error 结构。
旧 API 不破坏。
ARCH-003
建立 API Client
前端所有新增 API 调用经过统一 client。
暂不迁移全部旧代码。
ARCH-004
建立 Domain Types
Memory/Media/Event/User/SyncOperation 类型与校验。
先兼容现有字段。
ARCH-005
建立 Repository 接口
IndexedDB/D1 访问集中管理。
业务模块不直接碰数据库。
ARCH-006
建立 Media Provider Adapter
把 Douban 搜索/详情转换成内部标准结构。
电影页面行为保持不变。
ARCH-007
建立 Sync Engine 外壳
统一 push/pull/cursor/operationId/tombstone。
先包住现有同步逻辑，不重写。
ARCH-008
迁移一个完整垂直切片
优先选择电影模块，从 UI→Service→Domain→Repository→Adapter 全链路迁移。
作为后续迁移模板。
ARCH-009
补测试
为电影搜索、保存、同步建立单元/集成/E2E。
形成 Codex 改动护栏。
ARCH-010
冻结架构规则
更新 AGENTS.md，禁止继续把业务塞回 app.js。
所有后续 Codex 任务遵守。
十八、直接交给 Codex 的总任务书
下面这段可以直接作为 Codex/Agent 的第一份架构升级指令。
你现在负责 InnerOS 的架构升级。目标：在不推翻现有产品、不破坏已有用户数据、不进行一次性大重构的前提下，把 InnerOS 从当前功能型单体应用渐进式升级为“模块化单体 + 清晰领域边界”的长期可维护架构，为未来新增 Memory、Media、Diary、Event、WeFlow、ChatLab、AI、语义搜索、多设备同步等能力做准备。必须遵守：1. 先阅读 README.md、AGENTS.md、CHANGELOG.md、现有架构/项目文档和相关源码。2. 不要凭空重写；先识别现有实现并复用。3. 不允许一次性重写 app.js 或整个前端。4. 不允许引入微服务、Redis、消息队列等与当前规模不匹配的基础设施。5. 新增代码必须有明确模块归属。6. UI 不得直接访问 D1、SQL、第三方 API。7. 第三方 API 必须通过 Adapter 隔离。8. 数据库访问必须通过 Repository。9. 业务流程必须通过 Application Service / Use Case。10. 同步必须统一进入 Sync Engine，不允许业务模块自己实现同步。11. 保持现有 Cloudflare Pages + Functions + D1 部署方式。12. 每次只完成一个垂直切片，确保随时可以运行和回滚。13. 不得为了“架构漂亮”改变用户已经习惯的 UI 和行为。14. 涉及数据迁移时必须先提供兼容策略和回滚方案。15. 每次修改后运行适用的检查和测试，并在最终报告中列出：    - 修改文件    - 为什么改    - 测试命令    - 测试结果    - 已知风险    - 下一步建议第一阶段只做 ARCH-001 ~ ARCH-003：建立架构文档、统一错误模型/requestId、统一 API Client。禁止同时做 UI 重设计、数据库大迁移、AI 接入或 WeFlow 接入。完成后停止，等待下一条任务。
十九、每个架构任务的 Definition of Done
现有核心功能仍可运行。
没有新增重复 API/重复工具函数。
新增代码位于正确的模块边界。
没有把第三方响应结构泄漏到 Domain/UI。
没有新增未解释的全局变量。
数据迁移有备份/回滚策略。
至少有对应的自动化测试或明确说明为什么暂时无法测试。
git diff --check 通过。
README/CHANGELOG/架构文档在行为发生变化时同步更新。
Codex 输出明确的修改文件和验证结果。
二十、明确禁止的“看起来很专业但实际上不该做”的事情
不要现在把项目改成微服务。
不要为了 TypeScript 而一次性把所有 JS 改成 TS。
不要为了组件化一次性引入大型前端框架并重写 UI。
不要为了 AI 先上向量数据库；在数据模型和检索接口稳定前，先做好结构化搜索。
不要把 ChatLab 当作 InnerOS 数据库。
不要让 WeFlow 直接修改 D1；必须走 Import/Ingestion Service。
不要把 AI 生成内容直接覆盖用户原始记录。
不要在 app.js 里继续堆新的 500 行功能。
不要因为一次 Codex 修改方便而改变十几个无关模块。
不要删除旧字段直到迁移和回滚策略经过验证。
二十一、最终愿景：InnerOS V2/V3 应该长什么样
┌──────────────┐                    │    用户 UI    │                    └──────┬───────┘                           │                 ┌─────────▼─────────┐                 │ Application Layer │                 └─────────┬─────────┘                           │     ┌─────────────────────▼─────────────────────┐     │                InnerOS Domain              │     │                                            │     │ Memory  Media  Event  Diary  Person Place │     │                                            │     └───────┬───────────────┬────────────────────┘             │               │      ┌──────▼─────┐   ┌─────▼────────┐      │ Data Layer │   │ Integration   │      │ D1/IDB     │   │ WeFlow        │      │ Sync       │   │ ChatLab       │      │ Backup     │   │ Douban/TMDB   │      └──────┬─────┘   │ LLM           │             │         └─────┬─────────┘             └───────────────▼───────────                       AI / Search                            │                  ┌─────────▼─────────┐                  │ Personal Memory   │                  │ & Life Graph      │                  └───────────────────┘
最终目标不是“拥有很多页面”，而是让所有数据都可以围绕时间、人物、地点、内容和事件互相连接。当用户问“2024 年夏天我在做什么”“我最喜欢什么类型的电影”“某段时间发生了哪些重要事情”时，系统能够从统一 Memory 层检索并组合答案。
二十二、给你的最终执行建议
现在不要让 Codex 直接开始“架构重写”。正确动作是：
先把本文件交给 Codex，要求它只执行 ARCH-001 ~ ARCH-003。
让 Codex 完成后停下，把 diff 和测试结果给你。
第二轮执行 ARCH-004 ~ ARCH-006，优先把“电影”作为第一个完整垂直切片。
电影切片跑通后，把它当作模板迁移书籍、音乐和其他媒体。
之后再升级 Sync Engine，而不是在同步系统不稳定时接 WeFlow。
最后接 WeFlow，再接 ChatLab/AI。
每个阶段都保留一个可运行版本；任何阶段出现问题都可以回滚。
注意：这套路线的核心思想是“先建立可维护的骨架，再增加能力”。InnerOS 未来最宝贵的不是页面数量，而是稳定的数据模型、同步系统和扩展边界。
InnerOS Architecture Upgrade Plan · Prepared for Codex-driven development