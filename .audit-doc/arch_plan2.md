InnerOS v1.9
下一阶段架构开发与 Codex 执行方案
ARCH-007 ～ ARCH-015：从“架构骨架”进入“业务分层与同步收口”
基于当前 main 分支 v1.9.x 实际代码状态
一、结论：v1.9 可以继续，方向没有走偏
我重新检查了当前公开仓库 main 分支。当前已经出现 docs/architecture、functions/_domain、functions/_repositories、functions/_adapters、src/services、tests/unit 和 functions/api/v1 等 V2 架构骨架；CHANGELOG 已记录 ARCH-004～006，并有单元测试和本地 D1 集成验证。
检查项
当前状态
判断
ARCH-001～003
架构文档、错误信封、API Client 已落地
通过
ARCH-004
Memory 归一化、校验、同步操作校验
通过，后续继续收紧
ARCH-005
D1 访问集中；sync applyOp 已切到 Repository
基本通过，但同步职责仍混在 Repository
ARCH-006
DoubanAdapter 已隔离第三方字段
通过；目前覆盖 movie/book
Application Service
_services 尚未真正落地
下一阶段最高优先级
Sync Engine
现有 sync route 仍直接编排同步
下一阶段最高优先级
app.js
仍约 3900 行级别的大单体
不要重写，按垂直切片迁移
测试
errors/domain/adapter 单测已有
补 Service/Sync/集成测试
二、必须现在纠正的两个架构问题
1）Repository 正在承担同步职责
当前 memory-repository.js 除 Memory CRUD 外，还包含 opExists、recordOperation、listOperationsSince、maxSeq、updateDeviceCursor。v1.9 作为过渡可以接受，但继续扩展会让 Repository 再次变成万能层。
Route  ↓SyncService / SyncEngine  ├─ 校验 Operation  ├─ 幂等判断  ├─ apply operation  ├─ 记录 operation  ├─ 推进 cursor  └─ 返回 sync result       ↓Repositories  ├─ MemoryRepository  ├─ OperationRepository  └─ DeviceRepository
2）Application Service 还没有真正出现
当前 /api/v1/memories 是 route→repository→normalizeMemory；/api/v1/media/search 是 route→adapter。目标架构要求有价值的业务编排进入 Service。下一阶段以“媒体”和“同步”建立真正的 Service，而不是创建空壳。
重要：不要为了形式主义把每个 route 都包一层 Service。Service 必须承载真实的业务编排、校验、provider 选择、权限或事务边界。
三、本阶段目标
Route  ↓Application Service / Use Case  ↓Domain  ↙        ↘Repository  Adapter  ↓           ↓D1/IDB      豆瓣/未来 WeFlow/ChatLab所有同步：Route → SyncService → Operation/Device/Memory Repository
先建立 _services。
把同步协议收口到 SyncService + OperationRepository + DeviceRepository。
用电影完成第一个完整垂直切片：搜索→详情→标准化→保存→查询→同步→UI。
电影稳定后迁移书籍，再迁移音乐。
本轮不要接 WeFlow、ChatLab、AI；先把 InnerOS 自己的边界做稳。
四、目标目录（本轮只增加必要结构）
functions/├─ api/v1/...├─ _domain/memory.js├─ _repositories/│  ├─ memory-repository.js│  ├─ operation-repository.js       # ARCH-008│  └─ device-repository.js          # ARCH-008├─ _services/│  ├─ memory-service.js              # ARCH-007│  ├─ media-service.js               # ARCH-007│  └─ sync-service.js                # ARCH-008├─ _adapters/douban-adapter.js└─ _infra/errors.jssrc/services/api-client.jstests/unit/├─ errors.test.mjs├─ domain-memory.test.mjs├─ douban-adapter.test.mjs├─ memory-service.test.mjs├─ media-service.test.mjs└─ sync-service.test.mjs
五、ARCH-007：建立 Application Service 层
项目
要求
文件
functions/_services/memory-service.js、media-service.js
依赖
Domain + Repository + Adapter；通过参数注入
禁止
DOM、Cookie、Cloudflare Request、SQL、直接 fetch 第三方
Memory Service
标准 Memory 的读取、创建、校验、业务编排
Media Service
search/detail/provider 选择与错误映射
测试
可注入 fake repository/adapter 的单测
createMemoryService({ repository, domain })createMediaService({ providers, domain })Route 只负责：parse → auth → service → ok/fail
不要把 repository 方法机械包一层。
保持现有 API 返回结构和 UI 行为。
旧 /api/* 不迁移。
不改 IndexedDB v4。
完成后停止，等待下一任务。
六、ARCH-008：同步系统正式收口
模块
职责
OperationRepository
opExists、record、listSince、maxSeq
DeviceRepository
ensureDevice、getCursor、updateCursor
MemoryRepository
只处理 memory/entry/attachment
SyncService
push/pull 编排、校验、幂等、applyOperation
sync/[action].js
鉴权、解析请求、调用 Service、响应
必须保持不变
op_id 幂等。
server seq 单调递增。
cursor 增量 pull。
pull 排除本机 device_id。
upsert_memory：新者胜，败方进入 _conflicts。
删除墓碑优先，旧快照不能复活。
append_entry 幂等。
现有 /api/sync/push 与 /api/sync/pull 保持兼容。
syncService.push({userId, deviceId, deviceName, operations})→ {applied, skipped, errors, lastSeq}syncService.pull({userId, cursor, deviceId, deviceName})→ {ops, lastSeq, hasMore}
七、ARCH-009：电影完整垂直切片
用户 ↓InnerOSApi ↓/api/v1/media/search ↓media-service ↓DoubanAdapter ↓标准 Media ↓详情 ↓Memory Service ↓Memory Repository ↓D1 + 现有 Sync 协议
搜索标准字段：externalId/title/originalTitle/poster/year/creators/genres/score/source。
详情补齐 creator/director、genres、score、releaseDate、description。
保存只使用 InnerOS 标准字段；原始第三方数据进入 providerMetadata。
未来换 TMDB 时，电影 UI 不改字段读取方式。
搜索/详情错误走统一错误模型。
保存后可通过 /api/v1/memories 读取。
保存必须继续进入现有同步协议，不新增第二套同步。
八、ARCH-010：书籍迁移
复用 Media Domain、Media Service、Provider 接口。
继续使用 DoubanAdapter 的 book search/detail。
author/translator/publisher/isbn/pageCount/price 作为标准扩展字段或 metadata。
UI 不读取豆瓣原始 JSON。
以电影垂直切片的测试和结构作为模板，但不要复制粘贴后分叉。
九、ARCH-011：音乐只预留 Provider，不急着接 API
MediaProvider├─ search({type, query})└─ getDetail({type, id})DoubanProvider → movie/bookFuture → TMDB/OpenLibrary/MusicBrainz/...
重要：音乐真实 Provider 等 API 选择、稳定性和请求限制确认后再做；不要为了“架构完整”接临时 API。
十、ARCH-012：前端第一刀只迁电影
app.js 暂不拆。只把电影网络调用和数据转换逐步迁到 src/services / src/modules/media。
src/├─ services/│  ├─ api-client.js│  └─ media-api.js└─ modules/media/   ├─ movie.js   └─ media-model.jsapp.js → 只调用模块，不再直接拼第三方 API
不改电影 UI。
不改变用户数据字段。
触碰电影模块时顺手迁移旧 fetch。
diff 明显膨胀时立即停止并缩小范围。
十一、ARCH-013：测试护栏
测试层
最低覆盖
Domain
normalizeMemory/canonicalType/validateMemory/validateOperation
Adapter
movie/book 搜索与详情映射、异常
Memory Service
创建、查询、校验、权限边界
Media Service
provider 选择、标准化、错误映射
Sync Service
幂等、cursor、冲突、墓碑、append 幂等
Integration
wrangler D1：注册→保存电影→读取→push/pull
node tests/unit/errors.test.mjsnode tests/unit/domain-memory.test.mjsnode tests/unit/douban-adapter.test.mjsnode tests/unit/memory-service.test.mjsnode tests/unit/media-service.test.mjsnode tests/unit/sync-service.test.mjsnpx wrangler pages dev . --d1 DB --port 8788
十二、ARCH-014：更新 AGENTS.md / CHANGELOG
更新 AGENTS.md 的结构地图：当前 app.js 已接近 3900 行，不再写旧的 ~3100。
加入 _services、operation-repository、device-repository。
更新实际测试命令。
CHANGELOG 每轮记录根因、Changed/Fixed、实测。
项目.md 仅在用户可见功能或数据契约变化时更新。
十三、ARCH-015：发布与提交规范
APP_VERSION 与 index.html 的 app.js?v= 同步。
每个独立 ARCH 任务尽量单独 commit，保持可回滚。
commit：feat:/fix:/docs:/chore: + 中文一句话 + 根因。
最终报告必须给出 GitHub Desktop Summary + Description。
不要把多个 ARCH 任务压成一个大 commit。
十四、严格禁止 Codex 本阶段做的事
禁止重写 app.js。
禁止引入 React/Vue/Next/Vite 等新框架。
禁止一次性 TypeScript 大迁移。
禁止一次性迁移所有旧 /api/*。
禁止未经批准修改 D1 表结构或 IndexedDB v4。
禁止重写同步协议。
禁止现在接 WeFlow、ChatLab、AI、向量数据库/RAG。
禁止为了测试用 mock 冒充真实豆瓣数据。
禁止顺手做 UI 重设计。
十五、直接复制给 Codex：ARCH-007
继续执行 InnerOS V2 架构升级。当前基线：main / v1.9.x。ARCH-001～006 已完成。先阅读 AGENTS.md、docs/architecture/README.md、CHANGELOG.md 以及当前 _domain/_repositories/_adapters/API 代码。本轮只执行 ARCH-007，不执行后续任务。目标：建立真正有业务价值的 Application Service 层。新增：functions/_services/memory-service.jsfunctions/_services/media-service.js要求：1. 通过依赖注入使用 repository/domain/adapter。2. Service 不直接访问 D1、DOM、Cookie、Cloudflare Request 或第三方 fetch。3. memory-service 负责标准 Memory 的业务编排、校验、读取/创建等用例。4. media-service 负责 search/detail/provider 选择和统一错误映射。5. 不创建“机械包装 repository 方法”的空 Service。6. 保持现有 /api/* 和 /api/v1/* 行为兼容。7. 不改 IndexedDB v4。8. 不拆 app.js。9. 不接 WeFlow/ChatLab/AI。10. 增加对应 unit tests。11. 运行现有测试 + 新测试。12. git diff --check 必须通过。完成后立即停止，不要执行 ARCH-008。最终报告必须包含：- 修改文件- 每个文件职责- 架构边界说明- 测试命令与结果- 是否改变用户行为- 风险- GitHub Desktop Summary- GitHub Desktop Description
十六、ARCH-008 预备指令（ARCH-007 完成并审核后再给 Codex）
执行 ARCH-008：Sync Engine 收口。新建：functions/_repositories/operation-repository.jsfunctions/_repositories/device-repository.jsfunctions/_services/sync-service.js保持：/api/sync/push/api/sync/pull行为完全兼容。要求：- op_id 幂等- seq/cursor 不变- conflict 规则不变- tombstone 规则不变- append_entry 幂等不变- D1 表结构不变- route 只做 auth/parse/service/response- repository 只做数据访问- SyncService 负责同步编排- SyncService 可单测- wrangler 本地 D1 完整回归完成后停止，不执行 ARCH-009。
十七、本轮完成后的目标架构
UI / app.js    ↓InnerOSApi    ↓API Route    ↓Application Service    ↓Domain  ↙     ↘Repo   Adapter  ↓       ↓ D1    ProviderSync:Route → SyncService → Operation/Device/Memory Repository未来：WeFlow → Ingestion → MemoryChatLab → AI Gateway → Context
完成 ARCH-007～008 后，InnerOS 才真正从“有架构目录”进入“架构边界约束真实业务代码”的阶段。随后用电影做垂直切片，验证这套架构是否真的能降低维护成本。
十八、最终判断
v1.9 不需要返工。ARCH-001～006 的方向正确，已有实际代码和测试证据。现在最重要的是收口，而不是继续堆功能：Service → Sync Engine → 电影垂直切片 → 书籍 → 音乐 Provider → 再考虑 WeFlow/ChatLab/AI。
重要：这份文档是上一份架构方案的续作：上一份定义“应该长什么样”，本份定义“从 v1.9 当前代码开始具体怎么施工”。
InnerOS v1.9 · Architecture Continuation Plan