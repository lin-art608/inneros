# InnerOS — Agent 工作约定

> 本文件供 AI 编码助手（ZCode / Codex 等）在此仓库工作时自动读取。项目结构或流程变更后请同步更新本文件。

个人数字空间（InnerOS）：移动端优先的纯静态 Web App，部署于 Cloudflare Pages（inneros.pages.dev / inneros.asia）。记录存浏览器 IndexedDB（离线可用）；多账户云同步 v2 施工中：Cloudflare D1 + 操作日志协议（见 functions/api/auth、functions/api/sync 与《多账户云同步 v2 方案》）。

## 结构与技术栈
无框架、无打包、无 lint/测试框架；`package.json` 零依赖，部署即仓库根目录原样发布。

- `index.html` — 单页外壳，全部 CSS 内联（明暗主题用 CSS 变量）；页面：today / timeline / library / search / onthisday / random / year-review / settings + 资源组（res-cs、res-football、res-ai、res-links）
- `app.js` — 全部前端逻辑，有意保持单文件，不要建议拆分。按分节注释组织：Type Metadata / Provider 适配器（豆瓣、Google Books）/ IndexedDB（entries/teams/meta 三表，DB_VERSION=3）/ Cloud Sync v1 WebDAV（已降级为手动导出备份）+ v2 D1 同步 / Sports 真实数据源（足球=TheSportsDB、CS2=Liquipedia，经 /api/sports） / 各页渲染
- `server.py` — 本地开发服务器（端口 8765），镜像线上 Functions 的代理行为
- `functions/` — Cloudflare Pages Functions：`api/douban.js`（豆瓣搜索/详情）、`api/sports.js`（TheSportsDB + Liquipedia CS2）、`api/webdav.js`（WebDAV 转发，凭据不落服务端）、`api/auth/[action].js`（D1 注册/登录/会话）、`api/sync/[action].js`（操作日志增量同步）、`_lib.js`（schema 自建/PBKDF2/Cookie）、`img.js`（豆瓣图片代理）
- `.audit-doc/` — 审计文档、`mock_webdav.py`（本地 WebDAV 模拟器）、真实接口抓包样本
- `_headers` — CF 缓存规则：/img/* 缓存 1 天，/api/* 不缓存

## 常用命令
```
python server.py                     # 本地服务 → http://localhost:8765
node --check app.js                  # 语法检查（目前唯一的"测试"手段）
python .audit-doc/mock_webdav.py     # 本地 WebDAV 模拟器（同步联调用）
```
WebDAV 测试连接用假凭据即可（返回 401 属正常，不会产生真实请求风险）。

## 硬性约束（历史上踩过的坑）
1. **双端同步**：代理逻辑同时存在于 `functions/api/*.js`（线上）与 `server.py`（本地）。改任何代理/API 行为必须两端一起改，漏改一端必返工。
2. **合规红线**：不引入付费服务；不提交任何 API 密钥；禁止用 mock 数据冒充真实搜索结果；Liquipedia 限流 ≤2 req/s 且必须带 UA。
3. **已知限制不是 bug**：坚果云风控拦截云服务器 IP，线上版同步报 520 属已知限制（已有针对性提示），不要反复排查修复。
4. IndexedDB 结构变更必须递增 `DB_VERSION` 并兼容旧数据迁移。
5. 缓存策略改动需同步 `_headers`。

## 风格与流程
- 代码注释、UI 文案、错误提示一律中文。
- commit 格式：`feat:` / `fix:` / `docs:` / `chore:` 前缀 + 中文一句话说明（写明根因）。
- 每轮迭代完成后：更新 `CHANGELOG.md`（Keep a Changelog 格式：日期 + 根因分析 / Fixed / Changed），并在回复末尾附 GitHub Desktop 可用的 Summary + Description 文案。

## 与 Agent 的协作约定（省 token）
- 全程中文回复，解释从简；不输出整文件代码，只给改动片段。
- 严格限制在任务范围内的最小改动；`app.js` 单文件结构是既有决策，不主动重构。
- 定位问题优先读本文件提到的具体文件/分节，避免大范围搜索。
- 纯问答（不改代码）不触发 CHANGELOG 流程。
