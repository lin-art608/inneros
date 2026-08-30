# InnerOS 架构文档（ARCH-001）

> 状态：**生效中** · 建立者：V2 架构升级 ARCH-001 · 依据：《InnerOS_架构升级与_Codex_开发执行方案》
> 本文回答三个问题：代码应该放在哪、依赖方向是谁指向谁、迁移怎么走。**所有后续任务（人类或 Agent）必须遵守。**

## 1. 目标形态

**模块化单体 + 清晰边界**。不拆微服务、不引入 Redis/消息队列/Docker/TypeScript 大迁移/前端框架重写。

```
UI（index.html + app.js 过渡期入口 + src/ 逐步迁移）
        │  只调用 Application Service / API Client
Application / Use Cases（createMemory / searchMedia / sync / import / AI）
        │  编排业务流程与事务边界
Domain（Memory / Media / Event / Diary / Person / Place / Tag）
        │  纯业务规则与类型，不依赖 Cloudflare / DOM / fetch
Repositories（IndexedDB / D1 持久化）   Adapters（豆瓣 / WeFlow / ChatLab / LLM）
        │                                     │
Infrastructure（Pages / Functions / D1 / Fetch / Auth / Crypto / Logger）
```

## 2. 分层规则（每层允许/禁止）

| 层 | 允许 | 禁止 |
|---|---|---|
| API/Route | 解析请求、鉴权、参数校验、调用 Use Case、格式化响应 | 写 SQL、直接调第三方 API、堆业务规则 |
| Application Service | 编排流程、事务边界、权限检查 | 操作 DOM、依赖第三方 SDK |
| Domain | 业务规则、状态、类型、纯函数 | fetch、D1、Cookie、Cloudflare API |
| Repository | CRUD、查询、分页 | 决定产品业务规则 |
| Adapter | 外部 API → InnerOS 标准模型 | 外部字段泄漏到 UI/Domain |
| Infrastructure | DB、网络、日志、加密 | 定义产品业务概念 |

## 3. 当前落地与 Cloudflare 路由约束

方案第五节的目标目录按此落地，**唯一偏差**：Cloudflare Pages 会把 `functions/` 下所有非下划线开头的文件注册为路由，因此共享层一律使用**下划线前缀目录**（不产生路由）：

```
functions/
├─ api/            # 路由层（现有 api/* 不动；新 API 用 /api/v1/**）
│  └─ v1/          # 新版 API（统一信封，见下）
├─ _lib.js         # 既有共享库（schema/PBKDF2/Cookie）——旧代码继续用
├─ _infra/         # 基础设施：errors.js（统一错误模型）、后续 db/auth/crypto/logger
├─ _domain/        # 领域类型与纯函数（ARCH-004 起填充）
├─ _repositories/  # D1/IndexedDB 访问集中（ARCH-005 起填充）
├─ _services/      # Application Service（ARCH-P1 起填充）
└─ _adapters/      # 第三方适配器（豆瓣已有 douban.js 路由，V2 迁移至 _adapters）
src/
└─ services/
   └─ api-client.js  # 前端统一 API Client（经典脚本，无打包器约束）
tests/               # unit / integration / e2e（P8 补齐，先手工+语法检查）
docs/architecture/   # 本文件
```

## 4. 统一响应信封与错误模型（ARCH-002）

**新 API（/api/v1/**）一律使用；既有 /api/* 旧接口保持原样不破坏。**

成功：`{ "success": true, "data": { ... } }`
失败：
```json
{
  "success": false,
  "error": {
    "code": "MEDIA_PROVIDER_TIMEOUT",
    "message": "媒体服务暂时不可用",
    "requestId": "req_xxxxxxxx",
    "retryable": true
  }
}
```
- `requestId`：每请求生成 `req_` + 16 位随机，用于日志追踪
- 稳定错误码：`AUTH_REQUIRED` / `VALIDATION_ERROR` / `NOT_FOUND` / `CONFLICT` / `PROVIDER_ERROR` / `MEDIA_PROVIDER_TIMEOUT` / `RATE_LIMITED` / `INTERNAL`
- UI 只展示 `error.message`，不解析第三方原始错误；`retryable` 决定是否展示重试按钮
- 实现位置：`functions/_infra/errors.js`（`ok()` / `fail()` / `withRequest()`）

## 5. 前端 API Client（ARCH-003）

`src/services/api-client.js` → 全局命名空间 `InnerOSApi`（get/post/request）。
- **新增**的前后端调用一律走它；既有散落的 `fetch('/api/...')` 在触碰到对应模块时顺手迁移，不做专项迁移
- 兼容解析两种响应：新信封（success/data|error）与旧接口裸 JSON
- 失败抛 `ApiError`（code/message/retryable/requestId），调用方 catch 后走统一 toast

## 6. 依赖规则（谁指向谁）

- UI → Application Service → Domain ← Repositories/Adapters
- **禁止**：UI 直接 fetch 第三方/D1；页面写 SQL；业务模块自带同步逻辑；新增 `window.xxx` 跨模块通信（既有全局逐步收敛到 `InnerOSApi` 等命名空间）
- 同步是基础设施：一切变更走 Sync Engine（操作日志/游标/墓碑/幂等），业务模块不得自行发明

## 7. 迁移原则（每次任务的自查清单）

1. 渐进式：新旧模块允许短期共存；app.js 过渡期作为入口逐步变薄
2. 一次一个垂直切片（模板：电影模块），随时可运行、可回滚
3. 不改用户习惯的 UI 与行为；不删旧字段（回滚策略验证前）
4. 数据迁移必须先给兼容策略与回滚方案
5. 每任务完成标准（DoD）：核心功能可运行 / 无重复实现 / 代码在正确边界 / 无第三方结构泄漏 / 有测试或说明原因 / `git diff --check` 通过 / CHANGELOG 与本文档同步
6. 外部原始 JSON 只可存 `providerMetadata`，业务层不得依赖

## 8. 阶段路线（详见方案十六节）

P0 基线（本文档）→ P1 Service/Client 分层 → P2 Domain+Repository → P3 Media Adapter → P4 Sync Engine 收口 → P5 UI 模块化 → P6 WeFlow Ingestion → P7 AI Gateway+ChatLab → P8 测试与发布。
当前进度：**ARCH-001 ~ ARCH-003 完成，等待下一阶段指令。**
