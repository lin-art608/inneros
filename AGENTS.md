# InnerOS — Agent 工作约定

> AI 编码助手进入本仓库自动读取。**动手前先读本文 + [项目.md](项目.md)**（产品、架构、数据契约、**项目开发守则**、已知限制）；本文只负责「改哪查哪」与硬性约束，不重复产品内容。
> 单一事实来源：产品/架构/数据/限制/守则 → `项目.md`；文件级结构与命令 → 本文；逐轮历史 → `CHANGELOG.md`；分层规范原文 → `docs/architecture/README.md`。

InnerOS：无框架纯静态 Web App + Cloudflare Pages Functions + D1 + Resend，另有 Windows Electron 桌面端。多账户云同步已上线（D1 + 操作日志），坚果云/WebDAV 已删除，勿重新引入。

## 架构红线（V2 / ARCH-001 生效中）

- 新增后端 API 一律 `/api/v1/**` + `functions/_infra/errors.js` 统一信封；旧 `/api/*` 保持原样勿迁移。
- 新增前端 API 调用一律走 `src/services/api-client.js` 的 `InnerOSApi.get/post`。
- 共享层用下划线前缀目录（`_infra/_domain/_repositories/_services/_adapters`）——CF Pages 不路由下划线文件。
- 前端渐进式拆分：新功能/页面放 `src/features/`（IIFE + `window.InnerOSXxx`）；`app.js` 只保留生命周期、事件协调与兼容入口。
- 禁止：UI 直接 fetch 第三方/D1、业务塞回 app.js、微服务/TS 大迁移/新框架。

## 结构地图（改哪查哪）

| 文件 | 内容 |
|---|---|
| `index.html` | 单页外壳，全部 CSS 内联。主导航仅展示记忆模块与设置；resources / quickchat / knowledge / ai-assistant 旧路由保留但入口封存，勿删数据或擅自恢复入口 |
| `app.js` | 前端主逻辑（渐进拆分中）。分节：TYPE_META / 图片代理 / ContentProvider / IndexedDB v4 / 账户与同步引擎 / 速记对话 / 各页渲染 / History 返回栈（Sports 渲染已迁出，仅剩 2 个薄委托） |
| `src/features/navigation.js` | 页面父子关系、记忆/资源 Hub 与移动端抽屉手势纯逻辑（`window.InnerOSNavigation`）。`drawerProgress/settleDrawer` 驱动跟手与速度判定；返回目标必须查 `PAGE_PARENT` |
| `src/features/library.js` | 收藏页纯逻辑：可见页签固定电影/剧集/书籍/地点，保存当前页签供右下角＋直接打开表单（`window.InnerOSLibrary`） |
| `src/features/media.js` | 前端媒体数据层（电影/剧集/书籍/音乐 搜索+详情+字段映射，`window.InnerOSMedia`）；**唯一前端媒体入口**，第三方 URL 只在兼容 fallback 层 |
| `src/features/sports.js` | 紧凑赛程中心（足球+CS2，`window.InnerOSSports`）。固定「主队/今日/明日/最近」，直播与未开赛优先；同 URL 并发经 `rawInflight` 合并，内存缓存上限 40；赛程队徽禁止批量写 IndexedDB |
| `src/features/memory-detail.js` | 记忆详情 UI 纯逻辑：线性 SVG 类型图标、Unicode 字素安全截断、日记兜底标题、初记/续写篇章、相册循环索引（`window.InnerOSMemoryDetail`） |
| `src/features/account.js` | 密码显示/隐藏与邮件重置面板（`window.InnerOSAccount`）；只显示正在输入的密码，不保存明文 |
| `src/services/api-client.js` | 前端统一 API Client（`window.InnerOSApi`，兼容新旧信封）；新调用必经 |
| `src/pet/*` | 桌宠模块（config/adapter/view/controller/events/mount + state/interact + pet.css）：挂 AI 助手页 `#pet-container`，对外 `window.InnerOSPet`；属性存 localStorage `inneros_pet_state`（不进 IndexedDB/不上云）。**勿改 `assets/pet` 帧命名 `{action}_{i}.png`**；浮层 `[hidden]` 必须显式写样式规则 |
| `server.py` | 本地服务 :8765（`INNEROS_PORT` 可换）。代理 `/img`、`/api/douban`、`/api/sports`、`/api/v1/sports/cs2/matches`；`/api/v1/football/**`、`/api/auth`、`/api/sync`、`/api/v1/auth/**` 反代线上并透传浏览器 UA |
| `desktop/` | V1.30 Windows Electron 桌面端：独立运行时、`%APPDATA%/InnerOS` 数据目录、加载线上 pages.dev；`npm ci` / `npm run smoke` / `npm run dist`，产物 dist 不入库；禁止给远程网页开 Node 集成或原生桥 |
| `functions/_lib.js` | 旧共享库：D1 schema 自建（IF NOT EXISTS）/ PBKDF2 / Cookie 会话（逐步收敛） |
| `functions/api/auth/[action].js` | register / login / logout / me / send-code（Resend 验证码） |
| `functions/api/v1/auth/[action].js` | send-reset-code / reset-password，统一信封；PasswordService → PasswordRepository/EmailAdapter；验证码独立哈希，D1 batch 单次消费+改密+撤销旧会话 |
| `functions/api/sync/[action].js` | push（幂等批量）/ pull（游标增量）。**ARCH-008 后为薄路由**：只 auth/parse/service/response |
| `functions/api/douban.js` | 豆瓣 suggest + rexxar 详情（旧兼容路由，委托 adapter） |
| `functions/api/sports.js` | 旧兼容体育接口：足球=TheSportsDB（免费 key 123），CS2=Liquipedia；新功能禁止继续堆入，主链走 v1 |
| `functions/_domain/memory.js` | Memory 领域模型：normalizeMemory（有标准 `media` 块时以其为准）/validateMemory/canonicalType/validateOperation |
| `functions/_domain/media.js` | Media 领域模型：normalizeMedia/validateMedia/mediaToMemoryPatch（第三方原始 JSON 只进 providerMetadata） |
| `functions/_repositories/memory-repository.js` | memory/entry/attachment 的 D1 访问（upsertNewer/tombstone/appendEntry/updateEntryContent/upsertAttachment/listByUser）；写入方法支持 `collect` 供 `db.batch` |
| `functions/_repositories/operation-repository.js` | 操作日志：opExists（幂等判据）/record/listSince（游标+排除设备）/maxSeq；`prepend` 传入业务语句时用 batch 同事务 |
| `functions/_repositories/device-repository.js` | 设备：ensureDevice/getCursor/updateCursor（`last_seq` 由 Service 传入） |
| `functions/_services/memory-service.js` | 记忆编排：createMemory/list/append（空追加拒绝）/delete（墓碑）/NOT_FOUND |
| `functions/_services/media-service.js` | 媒体编排：Provider 选择（movie/series/book→douban，music→itunes）/query 校验/错误映射 |
| `functions/_services/sports-service.js` | 体育编排：CS2 优先 PandaScore，未配置/失败回退 Liquipedia；必须返回真实 provider/degraded，禁止把有限窗口标成完整数据 |
| `functions/_services/sync-service.js` | 同步编排：push（validate→幂等→apply→推进游标）/pull（增量+排除本机）；分页 `next_cursor` 有下一页时只能等于本页最后一条 seq；kind→repository 分发在此，勿搬回路由 |
| `functions/_adapters/douban-adapter.js` | 豆瓣适配器：标准结构 + 旧形状兼容（series 走 movie 上游路径但保留独立类型） |
| `functions/_adapters/itunes-adapter.js` | iTunes（music）：免 Key、country=CN；无评分/简介 → score=null、description='' |
| `functions/_adapters/liquipedia-adapter.js` | Liquipedia：官方 MediaWiki action=parse、最多 200 场、描述性 UA + gzip + 15 分钟缓存 |
| `functions/_adapters/pandascore-adapter.js` | PandaScore CS2：Secret 只从 `context.env.PANDASCORE_TOKEN` 读，`/csgo/` 前缀，最多两页/200 场 + 5 分钟缓存；前端禁止出现第三方 URL 或 Secret |
| `functions/_infra/errors.js` | 统一错误模型：ok/fail/errors.*/ServiceError + requestId |
| `functions/api/v1/` | 新版 API：me / memories / media/search / media/detail / sports/cs2/matches |
| `tests/unit/` | 零依赖单测（node 直接跑）：errors/domain-memory/media/navigation/memory-detail/sync/sports/pet 等 |
| `tests/integration/sync-route.test.mjs` | 真实 `onRequestPost/Get` + Cookie + 内存 D1 仿真（未知 SQL 抛错防漂移）。**改同步必跑** |
| `tests/integration/password-route.test.mjs` | Node 22.13+ 内置 SQLite 验证真实 SQL、并发单次消费、事务回滚、会话隔离、过期与限流 |
| `tests/e2e/media-sync-e2e.py` | 真实 D1 端到端（需先起 wrangler）：媒体全链路 + 跨设备 + 幂等 + 墓碑 + user isolation + 稳定错误码 |
| `tests/run-all.sh` / `tests/run-e2e.sh` | 快速测试（单测+集成，不含 E2E）/ 完整 E2E（自动起 wrangler） |

## 命令

快速测试需要 Node 22.13+（密码重置集成测试使用内置 SQLite；当前开发环境 Node 24）。

```
python server.py                                   # 本地服务 localhost:8765
node --check app.js                                # 语法检查（每次改完必跑）
python -m py_compile server.py                     # 改 server.py 必跑
bash tests/run-all.sh                              # 全部单测 + 集成（不含 E2E）
bash tests/run-e2e.sh                              # 完整 E2E（先 npm i --no-save wrangler）
python tests/e2e/media-sync-e2e.py                 # 手动跑 E2E（需先起 wrangler）
git diff --check                                   # 收尾必跑
```

## 硬性约束与踩坑清单（违反必返工）

1. **内联 onclick 里的 id 必须加引号**：`openDetail('${e.id}')`。UUID 含连字符，不加引号 = 点击即 JS 语法错误（已回归过一次）。
2. **双端代理**：同逻辑存在于 `functions/api/*.js` 与 `server.py`，改任何 API 两端必须同步；反代必须透传浏览器 User-Agent（CF Bot Fight Mode 对 python-urllib 返回 1010）。
3. **合规红线**：不引入付费服务；密钥只进 CF 环境变量；禁止 mock 冒充真实数据；不接 Supabase；不改 DNS。
4. **Service 抛错必须 `new ServiceError(...)`**，禁止裸 `Error + .code`——v1 路由用 `instanceof ServiceError` 判定，否则所有业务/第三方错误退化成 500 INTERNAL。
5. **D1 无交互式事务**：要原子就 `db.batch([stmt...])`；先读后写的逻辑靠「写入幂等 + op_id 未记录可重试」。
6. **`operations.seq` 全局 AUTOINCREMENT**：禁止用条数推算 seq；`next_cursor` 有下一页时只能等于本页最后一条 seq，读完才推 `last_seq`。
7. **`operations.op_id` 全局唯一、`memories.id` 全局主键**（非 user_id 复合）：测试数据必须随机 UUID，否则撞 UNIQUE。
8. **D1 绑定参数 ≤1MB**：附件压缩到 ≤1280px/JPEG0.8 后仍超 900KB 则跳过云端。
9. **IndexedDB 变更必须递增 `DB_VERSION` 并写迁移**（v4 做过数字 id→UUID，勿回退）。
10. **UI 约定**：右下角＋只在记忆页；收藏页＋按当前页签直接开表单；详情页＋= 追加到当前记录；只有日记标题可原位编辑；首页摘要固定初记；速记不计入统计；皮肤存 `inneros_skin`。
11. **Resend**：`EMAIL_API_KEY` 未配置时注册不强制验证码；域名已验证（inneros.asia），发件人默认 `noreply@inneros.asia`。
12. **Liquipedia**：只走官方 MediaWiki API，禁止抓网页 HTML；gzip + 描述性 UA；通用 API ≤1 次/2 秒、`action=parse` ≤1 次/30 秒；缓存 ≥15 分钟；UI 标注 CC BY-SA。**坚果云**已弃用（风控拦数据中心 IP），勿再排查。
13. **PandaScore**：Secret 固定 `PANDASCORE_TOKEN`，只能由 Function `context.env` 读取；CS2 路径 `/csgo/`；无 Secret 时如实显示 Liquipedia 有限回退，不抓 5E/HLTV。
14. **D1 测试账号残留**（e2e@/curltest@/notarget@inneros.dev），勿当用户数据。
15. **集成测试 query 与 `params.action` 必须分离**：CF Pages 路径参数不含 `?xxx`，拼进去会 404。
16. **长期约定**：改数据链路前后各跑一次 `tests/run-all.sh`；改同步必跑 sync-route 集成；E2E 断言要覆盖异常分支，不能只测 happy path。

## 交付流程（默认不代推）

1. 改完代码 → `node --check` / 相关测试 / `git diff --check` 全过。
2. 四件套：`APP_VERSION` 递增 + `index.html?v=` 破缓存 + `CHANGELOG.md` + `项目.md`（功能/限制变化时）。
3. **把改动留在工作区，不 commit、不 push**；在回复里给出 GitHub Desktop 的 Summary + Description，由用户提交推送。
4. 用户明确要求时，才代为 `git add / commit / push`；推送后按线上版本号确认部署成功。

commit 规范：`feat:` / `fix:` / `docs:` / `chore:` + 中文一句话（写明根因）。
纯文档改动不递增 APP_VERSION，CHANGELOG 记 `docs:`。

## 省 token 约定

- 全程中文；解释从简；不输出整文件，只给改动片段。
- 先按本文结构地图定位文件/分节，再精读那一段；不做全仓库搜索。
- 纯问答不改代码，不触发 CHANGELOG 流程。
