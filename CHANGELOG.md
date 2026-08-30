# Changelog · 变更记录

本项目所有重要变更记录在此文件（GitHub 官方惯例，[Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/) 格式）。
开发约定：**每轮迭代完成后，Agent 直接在本文件新增/更新对应日期小节**，并在回复中附上 GitHub Desktop 的 Summary + Description 文案。

---

## [Unreleased]

### V1.18.0 足迹地图重做（高德矢量瓦片+添加地点+照片相册）+ AGENTS.md 拆分约定（2026-08-30）

- **Changed（架构约定）**：AGENTS.md 解除"app.js 有意单文件，勿建议拆分"的硬约束，改为**渐进式拆分**——新增功能/页面优先放入 `src/features/` 独立模块（IIFE + `window.InnerOSXxx` 命名空间），触碰既有大块逻辑时顺手迁出；app.js 保留生命周期/事件协调/兼容入口。结构地图同步更新。
- **feat: 足迹地图重做**：
  - **高德矢量瓦片**：从 OpenStreetMap 标准瓦片切换为高德矢量街道瓦片（`webrd0{s}.is.autonavi.com`，免 Key 公开瓦片），中文标注完整、样式美观，接近高德地图体验
  - **添加地点按钮**：足迹页工具栏新增「＋ 添加地点」，点击直接打开快速记录表单并预选地点类型
  - **地点照片相册**：点击地图标记弹出详情，内含该地点所有照片的缩略图网格（最多显示 4 张，超出显示 +N），点击缩略图全屏查看，「查看记录」跳转详情页
  - **标记样式优化**：圆点标记加大（radius 9）、白色描边加粗（weight 2.5），按年份颜色区分，popup 圆角+阴影
  - **模块化**：足迹地图全部逻辑从 app.js 迁至 `src/features/footprint.js`（`window.InnerOSFootprint`），app.js 仅保留 4 行薄委托；app.js 减少约 110 行
- **未改**：D1 schema / IndexedDB v4 / API 协议 / 同步逻辑 / 地理编码 API（沿用 v1.17.0 的 /api/v1/geocode）。

#### 实测
- `node --check` app.js / footprint.js / geocode.js：全部通过
- `git diff --check`：通过

### V1.17.0 足迹地图 + 速信去表情按钮（2026-08-30）

- **feat: 足迹地图（Footprint Map）**——侧边栏记忆组新增「足迹」入口，类似高德足迹：去过的地点在整体地图上高亮显示，点击标记弹出地点详情，支持全景缩放。
  - 数据源：`place` 类型记录 + `event` 类型带 `location` 的记录
  - 地图引擎：Leaflet 1.9.4 + OpenStreetMap 瓦片（完全免费免 Key，CDN 引入）
  - 地理编码：新增 `GET /api/v1/geocode?q=`（后端代理 Nominatim，免 Key，1 req/s 限频，内存缓存 + CF 边缘缓存），把地点名称转成经纬度
  - 经纬度持久化：地理编码结果存回记录的 `lat/lng` 字段（IndexedDB + 云同步），避免重复查询
  - 批量补全：地图页加载时自动对无经纬度的地点串行地理编码（间隔 1.1s），实时显示进度，每完成一个更新标记
- **feat: 速信界面移除表情按钮**——速信输入栏不再显示 😀 表情选择器（记录/追加表单的表情按钮保留）。其他设备输入的表情仍可正常显示（`escapeHtml` 不转义 Unicode + 字体栈含 Segoe UI Emoji/Apple Color Emoji/Noto Color Emoji）。
- **未改**：D1 schema / IndexedDB v4 / API 协议 / 同步逻辑 / 其他页面。

#### 实测
- `node --check app.js` 与 `functions/api/v1/geocode.js`：通过
- 逻辑验证：足迹页获取 place+event 地点 → 已定位直接渲染标记 → 待定位串行地理编码 → 经纬度存回记录 → 点击标记弹详情 → 全景缩放

### V1.16.3 今天页排序根因修复——UTC 与本地时间不一致（2026-08-30）

- **背景**：V1.16.2 只修了收藏页，用户反馈今天页仍错乱（22:55 的书籍排在 15:51 的电影后面）。
- **根因**：`sortEntries` 同日二级排序用 `created_at.slice(11,16)` 取的是 **UTC 时间**（如 14:55），但显示层 `renderEntryCard` 用 `localTimeOf(created_at)` 取的是**本地时间**（如 22:55）。电影有 `watch_time`（用户手选本地时间）不受影响；书籍/日记等无 `watch_time` 的条目排序时用 UTC、显示时用本地，差 8 小时导致顺序完全错乱。
- **Fixed**：`sortEntries` 同日二级排序从 `created_at.slice(11,16)` 改为 `localTimeOf(created_at)`，排序与显示统一用本地时间。今天页/时间线/收藏页三处同时受益。
- **Changed（收口）**：移除收藏页同年份内多余的显式排序（只比日期不比时间，反而不如全局 sortEntries 完整），`items` 已由 `sortEntries` 三级排序（日期→时间→created_at），分组后保持原序即可。
- **未改**：D1 schema / IndexedDB v4 / API 协议 / 同步逻辑。

#### 实测
- `node --check app.js`：通过
- 逻辑验证：今天页同日条目按本地时间倒序——22:55(活着) → 21:38(围城) → 17:36(阿甘) → 17:36(肖申克) → 15:51(钢铁侠) → 13:35(星际) → 13:25(奥德赛)

### V1.16.2 收藏页排序修复（书籍/电影按时间倒序，2026-08-30）

- **根因①**：`getEntryDate` 不认识书籍的 `start_date`——在读的书没有 `finish_date`，返回空字符串 → 时间线里被 `if (!d) return` 直接跳过不显示；收藏页排序时被丢到最后，与按 `start_date` 分年份的逻辑错位，导致同一年内顺序混乱。
- **Fixed ①**：`getEntryDate` 对 `type==='book'` 改为 `finish_date || start_date || ''`——已读用读完日期、在读用开始日期、想读留空（在想读 tab 按添加时间排）。时间线/今天页/收藏页三处同时受益。
- **根因②**：年份分组用 `Object.keys(byYear).sort().reverse()`，中文字符串"未开始"/"未知"的 Unicode 大于数字，reverse 后反而排在 2026 年最上面。
- **Fixed ②**：书籍墙/电影墙年份排序改为自定义比较——年份倒序，"未开始"/"未知"固定放最后。
- **Fixed ③（健壮性）**：同年份组内显式按 `getEntryDate` 降序（无日期回退 `created_at`），不再依赖全局 sortEntries 的顺序传递，避免未来过滤/筛选引入顺序漂移。
- **未改**：D1 schema / IndexedDB v4 / API 协议 / 同步逻辑 / 其他页面排序规则。

#### 实测
- `node --check app.js`：通过
- 逻辑验证：已读(2026-08) > 在读(2026-06) > 已读(2026-01) > 已读(2025-12) 分组与组内顺序均正确；想读无日期归入"未开始"且在最末；电影同年份内按 watch_date 降序

### V1.16.1 架构收口 + 测试护栏修正（一次性收尾，2026-08-30）

- **根因**：深度审查（以实际源码为准）发现 ARCH-012 抽出的 `InnerOSMedia` 与 app.js 旧 Provider 曾并存；且 media.js 的 fallback（/api/douban、iTunes）散落在 4 个函数里，未集中到兼容层。
- **Fixed（P0 主流程收口）**：app.js 已无任何直接 fetch /api/douban / iTunes；`ContentProvider.searchMovie/Book/Music` 与 `enrichWorkDetail` 均为薄委托 → `InnerOSMedia.*`（唯一前端媒体入口）。
- **Changed（P1 fallback 集中化）**：media.js 把散落的第三方 URL 收拢到「兼容 fallback 层」（`legacyDoubanSearch`/`legacyDoubanDetail`/`legacyItunesSearch`），feature 主链始终走 v1，第三方 URL 只存在于 fallback 层 + Adapter。
- **Changed（P1 E2E 断言补全）**：电影补「删除→B pull + 旧 snapshot 走冲突不复活」跨设备完整断言；书籍补「删除→B pull + 旧快照不复活」；音乐保持 A→B pull。
- **Added（P1 fallback 回归测试）**：新增 `tests/unit/media-feature.test.mjs`（7 组）——v1 电影/书籍/音乐成功时**绝不触发 fallback fetch**、v1 失败才走 fallback、fallback URL 指向正确。
- **Changed（P2 工程收口）**：更新 `media-service.js` 顶部陈旧注释（music 已支持，非"拒绝"）；新增 `tests/run-e2e.sh` 明确区分「零依赖测试」与「完整 E2E」两个入口。
- **未改**：D1 schema / IndexedDB v4 / API 协议 / 用户操作流程 / SyncService 逻辑。

#### 实测
- `node --check app.js` 与 `src/features/media.js`：通过
- `bash tests/run-all.sh`：10 套零依赖测试全绿（新增 media-feature 7 组）
- `python tests/e2e/media-sync-e2e.py`（wrangler 真实 D1）：电影/书籍/音乐三条链路 + 跨设备同步 + 幂等 + 墓碑 + user isolation + 稳定错误码全部通过
- `git diff --check`：通过

### V1.16.0 架构升级 ARCH-013（测试护栏，2026-08-30）

- **目标**：让未来维护者/Codex 有足够证据阻止回归，覆盖最易坏、最重要的数据链路，不追求测试数量
- **新增 `tests/e2e/media-sync-e2e.py`**：真实 D1 端到端（零第三方依赖，Python 直接跑），固化此前沙箱一次性脚本，覆盖文档 7.1 全部最优先链路——电影/书籍/音乐 搜索→详情→保存→刷新→pull→删除→pull + 跨设备同步（同账号 devA→devB）+ op_id 幂等 + 删除墓碑（旧快照不复活）+ user isolation（账号间互不可见）+ 第三方故障稳定错误码（不支持类型 VALIDATION_ERROR / 非法 id PROVIDER_ERROR）
- **新增 `tests/run-all.sh`**：统一测试入口，一条命令跑全部 9 套零依赖测试（8 单测 + 1 集成）
- **AGENTS.md**：补 tests/e2e 与 run-all.sh 结构地图 + 命令说明

#### 实测
- `bash tests/run-all.sh`：9 套测试全绿
- `python tests/e2e/media-sync-e2e.py`（wrangler 真实 D1）：电影/书籍/音乐三条链路 + 跨设备同步 + 幂等 + 墓碑 + user isolation + 稳定错误码全部通过
- 踩坑记录（脚本级，非产品 bug）：① `operations.op_id` 是全局唯一约束，E2E 的 op_id 必须每次随机，否则撞 UNIQUE；② 跨设备同步须在同一账号下（devA push → devB pull），用不同账号 pull 会触发 user isolation 而拿不到数据
- **三条跨设备回归对齐文档精确定义（补充完善）**：① 电影补「删除→B pull」（验证删除操作同步到 B）；② 书籍补「修改→B pull」（B 拉到新标题）；③ 音乐补「B pull」（B 拉到音乐含标准 media）。并修正「旧快照复活」用例改用同账号 push（此前误用账号B，因 user isolation 未真正测到墓碑优先语义）

### V1.15.0 架构升级 ARCH-012（前端模块化，2026-08-30）

- **目标**：渐进式把高耦合区域移出 app.js，不是重写前端。用已验证的电影/书籍/音乐新 API，把**纯数据逻辑**抽离，app.js 保留生命周期/事件协调/兼容入口
- **新增 `src/features/media.js`**（IIFE + `window.InnerOSMedia`，无打包器，与 `InnerOSApi` 同模式）：迁入 `mediaToWorkFields`（标准 Media→本地字段映射）、`searchMovie`/`searchBook`/`searchMusic`（v1 搜索 + 旧接口回退）、`enrichWorkDetail`（v1 详情 + 回退，含 music 不误入豆瓣兜底）
- **app.js 减负**：`mediaToWorkFields` 定义删除；`ContentProvider.searchMovie/Book/Music` 改为薄委托 `InnerOSMedia.*`；`enrichWorkDetail` 改为薄委托。**3596 → 3461 行（-135 行纯数据逻辑）**
- **边界遵守**：media.js 不碰 DOM、不碰 app.js 内部变量，只依赖 `window.InnerOSApi` + 原生 fetch；返回字段形状不变；游戏（FreeToGame）未迁；DOM 渲染（renderWorkResults/selectWorkResult/saveCapture 等）与状态协调仍留 app.js
- **加载顺序**：index.html 在 `api-client.js` 之后、`app.js` 之前加载 `media.js`（经典脚本全局命名空间，无循环依赖）

#### 实测
- `node --check` app.js 与 media.js 均通过；node 模拟浏览器执行 media.js，确认 `InnerOSMedia` 正确挂载、movie/book/music 三种 `mediaToWorkFields` 字段映射与迁移前完全一致（含 media 块保留、providerMetadata 隔离）
- 后端 9 套测试全绿（前端模块化不触及 functions/ 与 tests/，无回归）；`git diff --check` 通过

### V1.14.0 架构升级 ARCH-011（音乐最小可用垂直切片，2026-08-30）

- **目标**：验证 Provider 架构可继续扩展到音乐，音乐链路走统一 Media/Memory/Sync，无 MusicSyncService/专用数据库
- **Provider**：新增 `_adapters/itunes-adapter.js`（iTunes Search/Lookup API，**免 Key、CORS 友好、country=CN 覆盖中文歌**）——`mapTrack()` 纯函数把 track 映射为标准 Media（music），`searchMedia`/`getMediaDetail`/`itunesProvider` 与 douban 同形
- **Service**：`media-service.js` `SUPPORTED` 加 `music: 'itunes'`；信封级 `source` 字段修正为反映真实 provider（music→itunes，book 保留 douban-book 特例）
- **Domain**：`media.js` `mediaToMemoryPatch` 加 music 分支（artist/album/preview_url/track_price 落库到业务字段）
- **路由**：`/api/v1/media/search|detail` providers 补 `itunes`（路由本身 type-agnostic，零逻辑改动）
- **前端（app.js）**：`searchMusic` / 音乐详情改走 `InnerOSApi → /api/v1/media/search|detail?type=music`（v1 失败回退旧直连 iTunes）；`mediaToWorkFields(m,'music')` 映射 artist/album/preview_url/track_price；`enrichWorkDetail` 加 music 分支（iTunes lookup，幂等）；music 不再误入豆瓣详情兜底
- **未改**：D1 schema / IndexedDB v4 / 旧 `/api/*` 协议 / UI 布局 / 未重写 app.js；iTunes 无评分/简介 → `score=null`、`description=''`（标准模型语义保留）

#### 实测
- 单元：新增 `itunes-adapter.test.mjs`（字段映射/artwork 升 600/原始字段隔离/缺省兜底）；`media-domain.test.mjs` 补音乐 mediaToMemoryPatch + 往返（7→9 组）；`media-service.test.mjs` 补 music→itunes provider 选择（并修正"music 未接入"旧断言改用 anime）；9 套测试全绿（单测 8 + 集成 1）
- 集成（wrangler 本地 D1）：搜"稻香"返回 8 条标准 Media（source=itunes）→ 详情拿到艺人周杰伦/专辑魔杰座/曲风国语流行 → v1 保存后 `type=media` 且 `media.creators=['周杰伦']`、`providerMetadata.album='魔杰座'` → 刷新读取仍在 → 设备 A push → 设备 B pull 到（含标准 media 块）→ 删除不被旧快照复活 → 电影/书籍搜索不回归 → 不支持类型返回稳定 `VALIDATION_ERROR`

### V1.13.0 架构升级 ARCH-010（书籍完整垂直切片，2026-08-30）

- **目标**：证明 ARCH-009 建立的 Media/Provider/Memory/Sync 模式可复用，书籍链路全走新架构，无第二套同步/专用数据库
- **审计（3.1）**：书籍此前搜索走旧 `/api/douban`、详情走旧 detail、保存只落 legacy 字段。发现 3 处缺口——① 书籍 suggest 丢作者（`mapSuggestItem` 未收 `author_name`）② rexxar 书籍详情**实测不返回 ISBN**（`isbn13=None`）③ 保存路径不带标准 `media` 块
- **Adapter（`_adapters/douban-adapter.js`）**：`mapSuggestItem` 把 `author_name` 收入 `creators`；`searchMedia` 输出补 `mediaType`（标准模型要求）；新增 `mergeBookDetail()` 纯函数——rexxar 缺 ISBN/出版社/页数时回退书籍详情页 HTML 解析补齐（已有一律不覆盖）；`getMediaDetail` book 分支接入合并
- **前端（app.js）**：`mediaToWorkFields(m, type)` 增加书籍扩展字段（cover/authors/publisher/isbn/categories/pageCount/publishedDate/book_description）；`searchBook` / 书籍详情改走 `InnerOSApi → /api/v1/media/search|detail`（v1 失败回退旧接口）；书籍保存（新条目 + 追加）均带标准 `media` 块
- **复用验证**：`MediaService` 的 `SUPPORTED` 本就含 book，`memoryToMemoryPatch` 已有书籍分支，`SyncService` 未动——书籍**零新增** Service/Repository/同步
- **未改**：D1 schema / IndexedDB v4 / 旧 `/api/*` 协议 / UI 布局 / 未重写 app.js

#### 实测
- 单元：`douban-adapter.test.mjs` 新增书籍 suggest 作者 + `mergeBookDetail` 合并（补齐/不覆盖）断言；8 套测试全绿（单测 7 + 集成 1）
- 集成（wrangler 本地 D1）：搜"百年孤独"返回带作者候选 → 详情拿到作者/评分 9.3/**ISBN 9787544253994**/出版社/页数/简介 → 设备 A 保存 → 设备 B pull 到（含 ISBN + 标准 media 块）→ 修改 → 设备 B 可拉到新版本 → 删除 → 不被旧快照复活
- ARCH-009 回归：电影「A 修改 → B 更新」同步验证通过（rating 8.1 → 9.0）

#### 已知问题（本轮未改，记录）
- `memories.id` 为全局主键（非 `(user_id, id)` 复合）：若某客户端复用他账号已存在的 id，`upsertNewer` 首次插入会撞 `UNIQUE` 报错而非干净跳过。生产用 UUID 全局唯一故不触发；根治需改表结构（明确禁止），仅记录。

### V1.12.2 架构升级 ARCH-009 复核补充（追加记录保留标准 media 块，2026-08-30）

- **背景**：按精确开发指导 2.1 对电影链路做全量审计（searchMovie / media/search / media/detail / selectedMovie / douban 原始字段泄漏）。结论：链路完整、豆瓣原始字段**零泄漏**（grep 实证只在 Adapter）；发现 1 个小缺口——"追加记录"路径重建 `selectedMovie` 时丢失标准 `media` 块，再次保存会用旧字段覆盖、`providerMetadata` 丢失
- **Fixed**：编辑重建 `selectedMovie`/`selectedBook` 时保留 `e.media`；追加路径仅在携带时回写 `merged.media`。书籍侧同款修复随 ARCH-010 提交

### V1.12.1 架构升级 ARCH-008.2（Sync Route 接线核验 + 真实集成测试护栏，2026-08-30）

- **背景**：审核报告基于旧 main 快照，认为 `sync/[action].js` 仍残留旧同步编排（applyOp / repo.opExists 等）。**以实际代码核验（文档自己也要求）**：接线早在 ARCH-008（f6c07eb）已完成——路由仅 auth/parse/`buildSyncService(db).push|pull`/响应，**0 处旧编排**；opExists/record/listSince/maxSeq/updateCursor 只存在于 Repository 与 SyncService 层（用 grep 实证）
- **因此本任务的实际缺口是**：此前 Route→Service→D1 的验证只在沙箱里跑过一次性脚本，仓库内没有可重复运行的集成测试（审核报告第八节明确要求"不要只新增 sync-service 的 fake repository 测试"）
- **新增 `tests/integration/sync-route.test.mjs`**：直接调用真实 `onRequestPost/onRequestGet`（真实 Request + Cookie 会话 + 内存 D1 仿真层）。仿真层按 SQL 模式逐条处理、**遇到未知 SQL 立即抛错**（D1 schema/查询漂移会让测试大声失败）。7 组覆盖：Route push（记忆/条目/附件真实落库+operation 记录）、Route pull（排除来源设备）、op_id 幂等、cursor/seq 增量、conflict（新者胜+败方保留）、tombstone（删除不复活）、错误信封（401/400/404 + 单条错误稳定 code + 坏 JSON）
- **测试基建踩坑**：集成测试里 query 必须与 `params.action` 分离——CF Pages 的 path 参数不含 `?xxx`，拼进去会 404

#### 未改
D1 schema / IndexedDB v4 / 旧 `/api/sync` 协议 / UI / SyncService 与 Repository 逻辑零改动（纯测试护栏 + 文档）

#### 实测
- 8 套测试全绿：单测 7 套（errors/domain-memory/douban-adapter/media-domain/media-service/memory-service/sync-service 12 组）+ 集成 1 套（sync-route 7 组）
- `node --check app.js`、`git diff --check` 通过

### V1.12.0 架构升级 ARCH-009（电影完整垂直切片，2026-08-30）

- **目标**：搜索 → 详情 → 标准化 → 保存 → 读取 → 编辑/删除 → 同步 全链路走新架构；UI 不读第三方原始 JSON
- **新增 `functions/_domain/media.js`**：`normalizeMedia` / `validateMedia` / `mediaToMemoryPatch`。标准 Media（externalId/title/originalTitle/poster/releaseDate/creators/genres/score/description/source/providerMetadata）↔ Memory 的纯函数映射；**第三方原始 JSON 只进 providerMetadata**
- **新增 `GET /api/v1/media/detail?type=&id=`**：Route → MediaService → DoubanAdapter → 标准 Media（补上此前缺失的"详情"环节，搜索/详情链路才完整）
- **`POST /api/v1/memories` 支持 `media`**：传标准 Media 时经 Domain 转成记录补丁落库；同时保留旧字段（既有 UI/IndexedDB 零迁移）+ 标准 `media` 块
- **`normalizeMemory` 增强**：记录里已有标准 `media` 块时以它为准，否则仍从旧字段推导（老数据行为不变）
- **前端电影链路接 v1**：`searchMovie` / 电影详情补全改走 `InnerOSApi` → `/api/v1/media/search|detail`，新增 `mediaToWorkFields()` 做标准结构→本地字段映射；**v1 失败自动回退旧 `/api/douban`**（第三方故障不导致页面无结果）
- **修复（E2E 发现）**：`media-service` / `memory-service` 此前用本地 `businessError()` 造**裸 Error**，路由 `e instanceof ServiceError` 判定失败 → 所有第三方故障被退化成 **500 INTERNAL**。现统一抛 `ServiceError` + `ErrorCode`（单一错误类）。实测修复后：非法 id → **502 PROVIDER_ERROR(retryable)**，不支持类型/空词 → **400 VALIDATION_ERROR**

#### 未改
D1 schema / IndexedDB v4 / 旧 `/api/*` 协议 / app.js 未重写（仅新增一个映射函数）/ 未新增第二套同步（仍走既有 Sync Engine）

#### 实测
- 单元：新增 `media-domain.test.mjs` 7 组（标准结构归一与 providerMetadata 隔离、校验、电影/书籍补丁、标准↔Memory 往返、老数据零迁移推导）；7 套单测全绿
- 集成（wrangler 本地 D1）：搜"星际穿越"返回正确候选 → 详情拿到导演/类型/评分 9.4/上映日期/简介/片长 169 → v1 保存后 `type=media` 且带标准 media 块 → 刷新读取仍在 → 另一设备 pull 到电影记录（含标准 media）→ 删除后旧快照不复活 → 异常场景返回稳定 code

### V1.11.1 架构升级 ARCH-008.1（Attachment Sync 修复 + 同步错误模型/一致性边界，2026-08-30）

- **根因①**：`MemoryRepository` 缺 `upsertAttachment`，`upsert_attachment` 操作在 `applyOperation` 里抛 `is not a function` 被吞成单条 error → **附件同步实际一直是失效的**（照片只留本地，其他设备永远拉不到）
- **Fixed ①**：实现 `upsertAttachment`。字段契约严格按 `_lib.js` 的 `attachments` 表与 `app.js enqueueAttachments()` 的 payload（`memory_id/bytes/hash/mime/data/created_at`，`data` 为不带 `data:` 前缀的 base64，未猜字段）。幂等用 `ON CONFLICT(id) DO UPDATE`（保留原 `created_at`），越权用 `WHERE attachments.user_id = excluded.user_id` 隔离
- **根因②**：SyncService 抛裸 `Error`，客户端只能靠中文 message 判断错误
- **Fixed ②**：请求级错误统一 `ServiceError` + `ErrorCode`（复用 `_infra/errors.js`，未建第二套 Error 类）；单条操作错误新增稳定 `code` 字段（`VALIDATION_ERROR` / `OPERATION_FAILED`）。`ErrorCode` 新增 `OPERATION_FAILED`
- **根因③**：`applyOperation` 与 `recordOperation` 之间无一致性边界
- **Fixed ③**：可纯语句化的 5 种 kind（`append_entry/update_entry/delete_entry/delete_memory/upsert_attachment`）走**语句收集 + `db.batch()` 与 operation 记录同事务提交**（D1 batch 具备原子性，未引入 Redis/MQ）；`upsert_memory` 需先读后写无法语句化，走"先 apply 后 record + 写入语义幂等 + op_id 未记录即可安全重试"路径。`ensureShell` 改为 `INSERT OR IGNORE`（单语句、天然幂等）
- **未改**：D1 schema / IndexedDB v4 / 旧 `/api/sync` 协议（路由把 ServiceError 映射回 `{error}` 旧形状）/ UI

#### 实测
- 单元：`sync-service.test.mjs` 扩到 12 组（新增附件落库与字段、附件幂等与 created_at 保留、附件越权隔离、非法操作 code、缺 memory_id 校验、**事务失败回滚后无残留且可安全重试**）；6 套单测全绿
- 集成（wrangler 本地 D1）：push 记忆+附件 `applied=2` → 重放 `skipped=2` → 同附件 id 新 op_id 覆盖 `applied=1`（ON CONFLICT 生效不撞 UNIQUE）→ 缺 memory_id 返回 `OPERATION_FAILED` → 设备 B pull 到 3 条 → 记忆读回正常（既有链路无回归）

### V1.11.0 架构升级 ARCH-008（同步系统收口，2026-08-30）

- **根因**：同步职责混在 `MemoryRepository`（opExists/recordOperation/listOperationsSince/maxSeq/updateDeviceCursor），且 `sync/[action].js` 路由里直接编排同步流程 + 内联 `applyOp`，业务编排泄漏到路由层（v1.9 方案第二节两个问题之一）
- **新增 `_repositories/operation-repository.js`**：opExists（幂等判据）/ record / listSince（游标增量 + 排除来源设备）/ maxSeq；操作日志的 D1 访问集中
- **新增 `_repositories/device-repository.js`**：ensureDevice / getCursor / updateCursor。游标值由 Service 传入（不再在 repo 里写子查询），使 SyncService 可脱离 D1 单测
- **新增 `_services/sync-service.js`**（依赖注入 4 个依赖）：push（domain.validateOperation 校验 → op_id 幂等 → applyOperation 分发 → 推进游标）、pull（增量回放 + 排除本机）；原路由里的 `applyOp` 下沉为 Service 的 `applyOperation`
- **`sync/[action].js` 瘦身为薄路由**：只做 auth / parse / service / response，响应形状与旧协议完全一致

#### 保持不变（回归判据）
op_id 幂等 · seq 单调递增 · cursor 增量 · pull 排除本机 · upsert 新者胜（败方进 `_conflicts`）
· 删除墓碑优先（旧快照不复活）· append_entry 幂等 · D1 表结构未改 · IndexedDB v4 未改 · 前端行为未改

#### 实测
- 单元：`node tests/unit/sync-service.test.mjs` 7 组（fake repository）全通过——幂等/未知 kind 单条失败不中断整批/新者胜+败方保留/墓碑不复活/append 幂等/pull 排除本机/cursor 增量/请求级校验
- 回归：errors 5/5、domain-memory、douban-adapter、memory-service、media-service 全绿；`node --check app.js`、`git diff --check` 通过
- 集成（wrangler 本地 D1，`pages dev . --d1 DB --port 8788`）：注册 → push 2 条（applied=2）→ 重放（applied=0/skipped=2）→ pull 本机 0 条 → 设备 B 拿到 2 条 → cursor 增量只剩最后一条 → `/api/v1/memories` 读回已归一化（type=media）
- 环境：wrangler 用 `npm i --no-save` 装进 node_modules（**package.json 未改动**，node_modules 已 gitignore）

#### 已知问题（本轮未改，建议下轮处理）
- `memory-repository` 缺 `upsertAttachment` 方法，导致 `upsert_attachment` 操作在 `applyOperation` 中会抛 `repo.upsertAttachment is not a function`，被 catch 成单条 error。属既有缺陷（非本轮引入），修它需要新增方法 + 决定 attachments 写入语义，已停下等你确认

### V1.10.0 架构升级 ARCH-007（Application Service 层，2026-08-30）

- **memory-service**（依赖注入 repository+domain）：createMemory（先领域校验，updated_at 服务端生成）、list/get（normalizeMemory 归一化 + NOT_FOUND 语义）、appendEntry（空追加 400 拒绝）、deleteMemory（墓碑）、updateEntryContent（空白拒绝）
- **media-service**：Provider 选择（movie/book→douban，未知类型 400）、query 校验、第三方原始错误不泄漏（只进服务端日志 + retryable）
- **v1 路由接线**：/api/v1/memories GET+POST、/api/v1/media/search 改为 parse→auth→service→ok/fail
- **_infra/errors.js 补强**：新增 ServiceError（code/status/retryable），路由统一捕获转 fail()
- 实测：memory-service 9 组断言（fake repository）、media-service 6 组（fake provider，验证不泄漏）全通过；既有 3 套单测回归全绿

## [Unreleased] 之前
### V1.9.0 架构升级 ARCH-004~006（第二轮，2026-08-30）

- **ARCH-004 functions/_domain/memory.js**——Memory 领域模型：canonicalType（movie/book/music/game→media）、normalizeMemory（旧字段 watch_date/event_date/location→occurredAt/places 等标准映射 + metadata 兜底）、validateMemory、validateOperation/SYNC_OP_KINDS
- **ARCH-005 functions/_repositories/memory-repository.js**——D1 访问集中：upsertNewer（新者胜+冲突保留）/appendEntry（幂等+空壳兜底）/tombstone/updateEntryContent/deleteEntry/upsertAttachment/opExists/recordOperation/maxSeq/updateDeviceCursor/listByUser/countByUser；**sync/[action].js 的 applyOp 已切到 repository 分发（行为不变）**
- **ARCH-006 functions/_adapters/douban-adapter.js**——豆瓣适配器：searchMedia/getMediaDetail 标准结构（suggest+rexxar）+ 旧形状兼容输出（suggestLegacy/movieDetailLegacy/bookDetail*）；`functions/api/douban.js` 重构为薄路由（委托 adapter，响应形状不变）
- **新端点**：GET /api/v1/memories（limit/offset，走 repository + normalizeMemory）；GET /api/v1/media/search?type=movie|book&query=（走 adapter）

#### 实测
- 单元（node tests/unit/*）：errors 5/5、domain-memory 全通过、douban-adapter 全通过
- 集成（wrangler 本地 D1）：注册→push 2 操作→GET /api/v1/memories 返回标准归一化条目（type=media/score 8.8）→GET /api/v1/media/search 奥本海默（豆瓣实时）✓
- 环境注意：本机 Node 运行时 Array.prototype.concat 被裁（宿主行为），新代码统一用 spread；浏览器不受影响

## [Unreleased] 之前
### V1.8.0 架构升级 ARCH-001~003（依据《架构升级与 Codex 开发执行方案》，2026-08-30）

- **ARCH-001 docs/architecture/README.md**——目标架构（模块化单体+清晰边界）、分层规则表、目录落地（CF 路由约束→下划线前缀共享层）、统一信封规范、依赖规则、迁移原则与 DoD
- **ARCH-002 functions/_infra/errors.js**——统一错误模型：ok()/fail()/errors.*（AUTH_REQUIRED/VALIDATION_ERROR/NOT_FOUND/CONFLICT/PROVIDER_ERROR/RATE_LIMITED/INTERNAL）+ requestId（req_+16hex）；示范端点 `/api/v1/me`（复用既有会话）
- **ARCH-003 src/services/api-client.js**——前端统一客户端 `InnerOSApi`（get/post/request + ApiError），兼容新信封与旧接口响应；checkAuth 已迁移接入
- 既有 /api/* 全部保持原样（方案要求：旧 API 不破坏）；app.js 未拆分（仅接入 client）

#### 实测
- 单元：tests/unit/errors.test.mjs 5/5（信封结构/requestId 格式/快捷失败/可重试标记）
- 集成（wrangler 本地 D1）：/api/v1/me 未登录→401 AUTH_REQUIRED 信封；注册→200；带 Cookie→200 {success,data.user} ✓
- 浏览器：登录态探测走 InnerOSApi 正常（登录/离线分支）
- 测试命令：`node tests/unit/errors.test.mjs`；`npx wrangler pages dev . --d1 DB --port 8788`

## [Unreleased] 之前
### V1.7.0 详情页改版与记录增强（用户反馈 4 条，2026-08-30）

- **feat: 详情页改版（1）**——移除顶部返回键与追加/删除行（返回走系统返回/手势）；右下角＋在详情页时变为「追加记录到当前内容」；新增右上角 ⤴分享（手机原生分享面板，桌面降级复制剪贴板）与 🗑删除小按钮
- **fix: 表情显示（3）**——字体栈补齐 Segoe UI Emoji/Apple Color Emoji/Noto Color Emoji：手机输入的表情在电脑端正常彩色显示（此前被字体回吞成文本）；保留表情选择器作为输入辅助
- **feat: 收藏分类筛选（4）**——电影页：全部/★高分(豆瓣≥8.5)/按类型（自动从数据收集）chips；书籍页：按标签+高分筛选；与搜索/阅读状态叠加
- **fix: 赛事页崩溃（上轮回归）**——关注条✕引用了不存在的 sport 变量导致足球页报"页面加载失败"；改用记录自身 sport；实测 CS/足球页全渲染

### V1.6.2 体验增强（用户反馈 4 条，2026-08-30）
### V1.6.2 体验增强（用户反馈 4 条，2026-08-30）

- **feat: 子条目可编辑/删除（1）**——详情页每条记忆条目悬停出现 ✎/✕；编辑行内保存、删除走墓碑同步（新增 update_entry 操作类型）；内容显示加转义防注入
- **feat: 表情选择器（2）**——速信输入框与记录/追加正文标签旁 😀 按钮，弹出 60+ 常用表情面板，光标处插入
- **feat: 赛事体验对齐 5E（3）**——中文别名搜索（法尔孔→Falcons、阿森纳→Arsenal 等 25 组，两端同步）；赛事卡中文名（BLAST 公开赛/IEM 英特尔极限大师/电竞世界杯…）+ A 级标；赛事推荐仅 A 级白名单或关注队相关；CS2 队标提升至 128px 高清
- **fix: 关注条 ✕ 悬停删除（3）**——球队 chip 悬停显示 ✕（触屏常显），取消关注走墓碑同步
- **feat: 图片查看器（4）**——照片点击全屏居中查看，缩放淡入动画，点击任意处/Esc 关闭
- **fix: 本地开发服务禁用缓存**——server.py 全局 no-cache（此前改代码后浏览器拿旧 JS，造成"手机端没更新"类反馈）
- emoji 图标保留（用户反馈衬线字符不如 emoji，已回退）

### V1.6.1 彻底移除演示数据（用户反馈：新账号里还有置身事内/奥本海默等）
### V1.6.1 彻底移除演示数据（用户反馈：新账号里还有置身事内/奥本海默等）

- **根因**：历史版本内置 17 条演示记录；旧设备上的记录无 seed 标记，被首次引导上传进新账号
- **fix: 演示数据机制彻底移除**——删除 SEED_ENTRIES 与播种逻辑，新设备/新账号从零开始
- **feat: removeLegacySeeds()**——按（类型+标题+内容特征）指纹识别并清理各设备/账号中的历史演示残留；用户自建的同名记录（如自己写了读后感的奥本海默）不受影响
- **feat: 管理面板新增「清空数据（保留账户）」**——reset-user 操作：清空某账户全部云端数据但保留注册信息，配合指纹清理实现"从零开始"

### V1.6 账户隔离与管理员后台（用户反馈 6 条，2026-08-30）
### V1.6 账户隔离与管理员后台（用户反馈 6 条，2026-08-30）

- **fix: 新注册账号出现别人的数据（隐私，1）**——根因：退出登录不清本机缓存，同一设备上他人注册新账号时，首次引导会把上一账号留在本机的记录上传进新账号。修复：**按账号隔离**——切换账号自动清空本机缓存并从云端拉取新账号数据（上一账号数据在云端不受影响）；引导标记改为按账号
- **fix: 书籍无法追加记录（4）**——追加模式被"必须先选作品"的标题校验拦截；修复：追加模式不再要求标题/选书，只留正文+图片；顺带修复追加时阅读状态/心情/分类被误改
- **fix: 时间错乱（2/3）**——多设备汇总后时间显示的是 UTC（差 8 小时）；全部改为本地时区显示（卡片/时间线/速记/排序二级键）
- **feat: 管理员后台（5）**——设置→管理员：输入 ADMIN_KEY（CF 环境变量）查看全部账户（邮箱/注册时间/记录数/照片数）并删除账户及其云端数据；未配置 ADMIN_KEY 时功能关闭
- **docs: 数据与安全章节（6）**——项目.md 新增各数据的位置与保护方式说明

### V1.5.2（2026-08-30）
### V1.5.2（2026-08-30）
- **fix: 验证码发件人切换为已验证域名**——用户已在 Resend 完成 inneros.asia 域名验证（DKIM/SPF 全 Verified）；发件人默认从 onboarding@resend.dev（测试模式）改为 noreply@inneros.asia，任意邮箱可注册收码；EMAIL_FROM 环境变量仍可覆盖
- 实测：见下轮部署后线上验证

## [Unreleased] 之前
### V1.5.1（用户反馈 3 条，2026-08-30）

- **revert: 字符印记回退为 emoji 图标**（用户反馈衬线单字不如以前）；时间线折叠/单处时间等其余改进保留
- **fix: 排序确认**——今天页与时间线实测均为最新在上（用户所见"搞反"为旧版部署/缓存所致，推送后即正）
- **fix: 验证码 403 排查结论与修复**——线上实测仍为 Resend 测试模式限制（域名未完成验证）；新增 `EMAIL_FROM` 环境变量支持（域名验证后设为 InnerOS <noreply@inneros.asia> 即可给任意邮箱发信，此前发件人写死 onboarding@resend.dev 即使验证域名也无效）；403 报错升级为完整中文步骤

### V1.5 体验与修复（用户反馈 7 条，2026-08-30 晚）
### V1.5 体验与修复（用户反馈 7 条，2026-08-30 晚）

- **fix: 删除按钮失效（致命回归）**——详情页删除按钮 `confirmDelete(${id})` 未加引号（UUID 连字符=JS语法错误），点击无反应；加引号修复并实测删除+墓碑同步
- **fix: 游客模式点登录卡回首页**——「去登录」原为 location.reload()（guest 标记仍在，刷新后回首页）；改为 `goLogin()` 清标记直接弹登录层
- **fix: 今天页最新在上**——同日记录按时间倒序确认生效（配合 V1.4.2 排序修复）
- **feat: 时间线月/年折叠**——组头点击收起/展开（默认仅最近月展开，其余 ▸ + 条数），快速检索
- **feat: 美术迭代**——emoji 小图标全部替换为衬线字符印记（影/书/乐/游/地/事/记/速，serif + 类型色淡底）；时间线单条不再重复显示时间（tl-when 行统一承担）
- **feat: 追加记录极简化**——对事件等已有记录点「追加」只留 正文+图片，不再重复填写标题/分类等；阅读状态/心情在追加时不被误改

### V1.4.2（用户反馈 4 条，2026-08-30）
### V1.4.2（用户反馈 4 条，2026-08-30）

- **fix: 今天页同日记录不按时间排序**——根因：UUID 迁移后 id 随机化，旧排序只比日期、同日顺序=随机；sortEntries 增加"时间倒序 + created_at"二级排序
- **feat: 版本号系统**——`APP_VERSION` 显示于侧边栏页脚/设置页/控制台；`index.html` 的 `app.js?v=` 随版本递增（**强制各端刷新缓存**，解决"手机端没更新"）；版本号=部署成功判据
- **docs: AGENTS.md 写入四步迭代约定**（版本递增/CHANGELOG/项目.md 定期更新/提交文案）

### 体验修复包（用户反馈 7 条中的 3/4/5 + 回归修复，2026-08-30）
### docs（2026-08-30）
- 重写 `AGENTS.md`（Agent 操作手册：结构地图/命令/数据契约/API 一览/踩坑清单/省 token 约定，修正 6 处过时描述）
- 新增 `项目.md`（产品与架构全貌：功能矩阵/同步协议/部署配置/已知限制/里程碑），与 AGENTS.md 互补不重复
### V1.4.1 追加反馈（用户 7 条，2026-08-30）

- **fix: 验证码"发送失败"根因定位**——Resend 测试模式只能发给账号本人邮箱（403 已转中文指引：用 Resend 账号邮箱注册，或验证 inneros.asia 域名后任意邮箱可用；域名 DNS 需用户自行添加）
- **fix: 今天页更新不及时**——自动同步间隔 5 分钟 → 60 秒；回放后所在页面即时重渲染（原有）
- **feat: 今天页条目打上精确时间**——无既有时段的记录显示 created_at 精确到分
- **chore: 移除「最近添加」区块**（用户否决上一版方案）
- **chore: 速记不计入设置数据统计**
- **feat: 速记移出记忆组 → 独立「速信 · Express」导航（用户改名）**
- **fix: 侧边栏可上下滚动**（新增导航项后设置被挤出视口）
- **fix: 非记忆页面隐藏右下角＋按钮**（速信/资源/设置/知识库/AI助手不显示）
- **feat: 日记极简化**——只留正文 + 图片；标题自动取正文前 18 字，去除标题/心情输入

### V1.4 体验迭代（用户反馈 7 条，2026-08-30）

- **fix: 时间线点不进详情（4）**——UUID 迁移回归：11+1 处内联 onclick 未加引号；修复并改版为朋友圈样式（每条直接显示 M月D日 HH:mm + 类型）
- **feat: 速记对话（6）**——新「速记」页代替微信传输助手：文字/照片随手发给自己，气泡流 + 按天分组 + 照片预览；照片压缩后走操作日志全设备同步
- **feat: 注册邮箱验证码（7）**——Resend 发信（API Key 存 CF 环境变量 `EMAIL_API_KEY`，不进代码）；配置后注册强制 6 位验证码（10 分钟有效、60 秒冷却）；未配置时注册不受影响（引导提示）
- **chore: 移除坚果云/WebDAV 方案（1）**——设置区、前端函数、后端转发全删（用户确认弃用）；`mergeSnapshot` 保留给「导入备份」；JSON 导出/导入保留
- **fix: 首页赛程改收藏制（2）**——移除自动"我的赛程"；资源页比赛卡加 ★ 收藏，仅收藏比赛出现在今天首页
- **feat: 今天页「最近添加」（3）**——创建时间倒序最近 5 条（跨日期），解决"新加的记录不在今天"
- **feat: 设置统计可跳转（5）**——数据统计行点击 → 收藏对应页签（其余类型跳时间线过滤）
- **fix: 同步离线优先**——操作无条件入队（此前登录态未就绪时会静默丢操作），推送时才校验登录

### 体验修复包（用户反馈 7 条中的 3/4/5 + 回归修复，2026-08-30）
- **fix: 时间线点击进不了详情（UUID 迁移回归）**——11 处内联 `openDetail(${id})` 未加引号，UUID 带连字符导致点击时 JS 语法错误；全部加引号修复（含详情页追加按钮）
- 时间线改版（用户要求"类似朋友圈"）：每条记录上方直接显示 `M月D日 HH:mm + 类型`，点击整行进详情
- 今天页新增「最近添加」：按创建时间倒序展示最近 5 条（跨日期），解决"我添加的记录为什么不在今天"
- 首页赛程改为**收藏制**：移除自动"我的赛程"；资源页比赛卡新增 ★ 收藏按钮，仅收藏的比赛出现在今天首页（V1.3 用户要求）
- 设置数据统计行可点击 → 跳转收藏对应页签（电影/书籍/音乐/游戏/地点；其余类型跳时间线并过滤）

### S1（已完成并部署）：多账户云同步 v2 —— D1 + 操作日志协议

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
