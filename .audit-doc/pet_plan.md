InnerOS 私人助手2D 桌宠网页化技术路线
Azure / Codex / Agent 可执行实施方案
适用项目：InnerOS 私人记忆空间目标：将现有本地 2D 桌宠的动作形象迁移到网页“私人助手”区域
一、项目结论：推荐采用的技术路线
本项目不建议一开始就把整个本地桌宠程序“原封不动搬进网页”。更稳妥的方式是：保留原有角色素材和动作设计，只把“角色渲染、动作播放、状态切换、与 InnerOS 的交互”拆成网页可运行的前端模块。
推荐路线
第一阶段：确认现有桌宠的技术类型和素材格式，先在独立网页 Demo 中成功显示角色。
第二阶段：把待机、眨眼、呼吸、挥手、开心、思考等动作封装为网页动画控制器。
第三阶段：将桌宠模块嵌入 InnerOS 的“私人助手”页面，保持独立目录和独立样式，避免污染现有 app.js。
第四阶段：让桌宠读取 InnerOS 的基础状态，例如当前时间、最近记录、今日完成度、页面切换等。
第五阶段：再考虑 Azure Functions / Azure OpenAI / 数据库等云端能力；动画本身不需要依赖 Azure 才能运行。
核心原则：先实现“网页里能动”，再实现“网页里聪明”，最后实现“网页里能调用云端 AI”。
二、先明确：Azure 在这个项目中负责什么
Azure 不是必须用来承载 2D 动画的。你的 InnerOS 当前更适合继续使用 GitHub + Cloudflare Pages 部署前端。Azure 更适合作为后续私人助手的云端能力层。
模块
推荐位置
原因
网页界面、动画、动作控制
InnerOS 前端 / Cloudflare Pages
加载快、部署简单、动画不需要服务器
角色素材文件
GitHub 仓库或对象存储
小体积素材可直接随网站部署
AI 对话、记忆检索、复杂任务
Azure Functions / Azure OpenAI（后续）
避免把密钥放进浏览器
长期数据、照片、事件记录
后续数据库 / 对象存储
支持跨设备同步和安全访问
开发与版本管理
GitHub + GitHub Desktop
可回滚、可分阶段提交
三、现有桌宠技术类型确认表
在让 Agent 修改代码前，必须先确认桌宠属于哪一类。不同类型的迁移难度差异很大。
类型
常见特征
网页迁移方式
优先级
序列帧 PNG / GIF
一组图片逐帧播放
CSS animation / Canvas / JS 定时器
最容易
Spine
骨骼动画、json/atlas/png
Spine Web Player 或兼容运行库
较推荐
Live2D
模型文件、参数、物理效果
Live2D Cubism Web SDK
效果好，接入较复杂
Rive
.riv 文件、状态机
Rive Web Runtime
适合交互角色
Electron / Python / Unity 桌宠
本地窗口、系统托盘、鼠标穿透
不能直接搬运；需提取素材和动画逻辑
需要重构
判断标准：如果原桌宠是一个本地窗口程序，网页通常不能直接调用它的窗口穿透、系统托盘、桌面置顶等能力。网页版本应重新实现“角色展示”和“网页内交互”，而不是复制桌面窗口能力。
四、目标产品形态
InnerOS 的“私人助手”区域建议采用以下结构：
角色展示区：角色位于页面中央或右侧，背景透明或使用 InnerOS 的柔和背景。
状态气泡：显示简短状态，例如“今天还没有记录”“正在整理你的记忆”“晚上好”。
动作反馈：用户打开页面、添加电影、完成阅读、上传照片、切换模块时，角色做不同动作。
轻量控制：静音/暂停动画、切换角色状态、隐藏气泡。
助手入口：点击角色或按钮进入文字对话，不要让动画本身承担所有交互。
性能保护：页面不可见时暂停高频动画；移动端降低粒子、物理和帧率。
五、推荐的目录结构
第一阶段不要继续把所有代码堆进 app.js。建议让 Agent 新建独立模块：
/inneros├─ index.html├─ app.js├─ styles.css├─ assets/│  └─ pet/│     ├─ images/│     ├─ animations/│     ├─ models/│     └─ sounds/             （可选，默认不启用）├─ src/│  └─ pet/│     ├─ pet-view.js         # 负责 DOM / Canvas 挂载│     ├─ pet-controller.js   # 负责动作和状态│     ├─ pet-config.js       # 角色配置│     ├─ pet-events.js       # 与 InnerOS 事件通信│     └─ pet-adapter.js      # 兼容不同动画引擎└─ docs/   ├─ AGENTS.md   └─ pet-web-migration.md
如果当前项目还没有 src 目录，可以先创建；不要在第一轮就重构整个项目。
六、分阶段执行计划
阶段 0：备份与勘察
1 个小任务
在 GitHub Desktop 创建备份分支，例如 pet-web-before-migration。
确认当前网页能正常运行并记录现有版本号。
找出本地桌宠的启动文件、素材目录、动画文件、依赖和运行方式。
确认桌宠是否依赖 Python、Electron、Unity、Live2D、Spine 或其他运行时。
输出《桌宠技术勘察报告》，此阶段不改动 InnerOS 主功能。
阶段 1：独立网页 Demo
1 个小任务
新建一个独立 pet-demo 页面或独立组件。
只实现角色显示，不接入 AI、不接入数据库、不改动原有记录功能。
确保角色在桌面端和手机端都能显示。
提供暂停、恢复、缩放三个最基本控制。
提交一次 Git commit，名称建议为 feat: add standalone pet web demo。
阶段 2：动作控制器
2～3 个小任务
建立统一动作名：idle、blink、happy、thinking、wave、sleep、error。
将动作播放封装为 playPetAction(actionName)。
提供状态优先级，避免多个动作同时抢占角色。
增加动作队列或最小冷却时间，避免用户连续点击导致动画混乱。
页面隐藏时暂停或降频，返回页面后恢复。
阶段 3：嵌入私人助手
1～2 个小任务
在 InnerOS 私人助手区域增加 pet-container。
将桌宠模块作为独立组件挂载，不复制大量代码到 app.js。
适配 InnerOS 当前的卡片、字体、圆角、颜色和响应式布局。
确保桌宠不遮挡按钮、不影响滚动、不造成横向溢出。
增加隐藏/显示开关，并保存用户选择。
阶段 4：连接 InnerOS 事件
2～3 个小任务
先使用本地事件总线，不要立即接入云端。
添加电影成功后播放 happy 或 celebrate。
添加书籍、日记、照片、事件成功后播放对应动作。
打开私人助手时播放 greeting。
AI 正在处理时播放 thinking；完成后播放 answer 或 happy。
所有事件都要有默认兜底动作，不能因为桌宠报错而阻断主流程。
阶段 5：Azure 云端助手（可选）
后续阶段
创建 Azure Functions API，负责安全地调用 AI 服务。
前端只请求自己的 API，不把 Azure OpenAI 密钥写进网页代码。
定义统一接口：/api/assistant/chat、/api/assistant/status。
先做只读问答，再做新增记录、整理记忆等写操作。
增加登录、权限、限流和错误提示后再投入日常使用。
七、网页动画实现方案选择
方案 A：序列帧图片（最适合快速落地）
将每个动作导出为 PNG 序列或精灵图。
使用 Canvas 或 CSS 播放帧动画。
优点：简单、稳定、无需复杂运行库。
缺点：图片体积可能较大，动作扩展成本高。
适合：先把已有桌宠放进网页，验证产品形态。
方案 B：Spine / Rive（适合骨骼动画）
如果现有角色本来就是骨骼动画，优先沿用原格式。
网页只负责加载模型、播放状态机和响应事件。
优点：体积小、动作切换自然、交互能力强。
缺点：需要确认运行库许可、版本和导出文件是否完整。
方案 C：Live2D（适合高质量陪伴角色）
适合有立绘、眨眼、呼吸、头部转动、物理摆动的角色。
需要模型文件、纹理、动作/表情配置和 Web SDK。
必须确认模型授权与 SDK 使用条件。
不建议把 Live2D 作为第一轮任务；先做可替换的 pet-adapter。
最终建议：如果你只是想尽快在 InnerOS 里看到原来的桌宠，优先序列帧或现有动画格式的网页播放器；如果你追求长期高质量私人助手，再升级到 Live2D/Spine/Rive。
八、与 InnerOS 的通信设计
不要让桌宠模块直接读取和修改所有业务数据。采用事件驱动更稳妥。
事件
桌宠动作
失败兜底
pet:greeting
wave / happy
idle
record:created
happy
idle
movie:imported
celebrate
happy
assistant:thinking
thinking
idle
assistant:answered
answer / happy
idle
assistant:error
error
idle
page:hidden
pause
保持静态
推荐接口示例（仅供 Agent 理解，不要求用户手写）：
window.InnerOSPet?.play("happy");window.InnerOSPet?.setState("thinking");window.InnerOSPet?.pause();window.InnerOSPet?.resume();
九、Azure 后端的安全路线
前端网页只保存 API 地址，不保存 Azure OpenAI Key、数据库密码或管理员凭证。
Azure Functions 负责接收用户请求、校验身份、调用 AI 服务。
初期可以只做一个 /api/assistant/chat 接口。
后续再增加 /api/memory/search、/api/memory/create、/api/photo/upload。
照片不要直接塞进 AI 请求；应先存对象存储，再把必要的描述或链接交给 AI。
所有写入操作必须有确认机制，避免 AI 误创建、误删除记录。
如果只是网页展示桌宠，不要为了动画强行引入 Azure，避免增加延迟和成本。
十、部署与版本管理流程
在 GitHub Desktop 创建分支：feature/web-pet。
每完成一个小目标就提交一次，不要一天改完全部再提交。
先在本地打开网页测试，再推送 GitHub。
Cloudflare Pages 自动部署后，检查桌面端、手机端、刷新、返回、隐藏/显示。
如果出现白屏或主功能异常，立即回滚到上一个 commit。
稳定后合并到 main，并在 CHANGELOG.md 记录本次变更。
建议提交记录：
chore: backup before web pet migration
feat: add standalone web pet renderer
feat: add pet action controller
feat: embed pet into private assistant
feat: connect pet with InnerOS events
fix: pause pet animation when page is hidden
十一、验收标准
□ 网页打开后，角色能在私人助手区域稳定显示。
□ 角色不会遮挡主要按钮、输入框和滚动区域。
□ 至少有 idle、happy、thinking、wave、error 五种状态。
□ 动作切换不会出现多个动画重叠、闪烁或卡死。
□ 刷新网页后不会破坏 InnerOS 原有数据。
□ 桌面端和手机端均能正常显示。
□ 页面切到后台后动画会暂停或降频。
□ 桌宠报错时，电影、书籍、日记、照片等主功能仍可用。
□ Azure 密钥不出现在前端源代码中。
□ 每个阶段都有独立 Git commit，可回滚。
十二、常见风险与处理方式
风险
表现
处理
本地桌宠依赖桌面窗口
网页无法置顶、穿透桌面
只迁移动画和交互，不迁移桌面窗口能力
素材缺失或格式不兼容
角色显示空白
先做素材清单和格式转换，不急着改业务代码
app.js 继续膨胀
修改容易影响全站
建立 src/pet 独立模块和适配层
动画卡顿
手机发热、滚动掉帧
降低帧率、暂停后台动画、减少粒子
Azure 延迟
助手回复慢
动画本地运行，AI 请求异步处理
密钥泄露
前端源码可看到 Key
所有密钥只放 Azure 服务端环境变量
版本回滚困难
改坏后无法恢复
小步提交、分支开发、保留稳定版本
十三、给 Azure / Codex / Agent 的执行指令
下面这段可以直接交给 Agent 作为任务总说明。
你正在维护 InnerOS 私人记忆空间项目。现在要把现有本地 2D 桌宠迁移为网页内的私人助手角色。严格要求：1. 先检查现有项目结构、桌宠文件和动画格式，再决定实现方式。2. 不要一次性重写 app.js，不要破坏现有电影、书籍、音乐、照片、地点、事件功能。3. 第一轮只做独立网页 Demo：能显示角色、播放 idle、暂停和恢复。4. 采用独立目录 src/pet，至少拆分 view、controller、config、events、adapter。5. 不要把 Azure 密钥放进前端。6. 动画本身必须在浏览器本地运行，不能依赖 AI API 才能显示。7. 每完成一个阶段就提交 Git commit，并说明修改文件、测试结果和回滚方式。8. 如果发现素材格式不兼容，先输出问题清单和可选方案，不要擅自替换角色。9. 所有错误必须降级为静态角色或隐藏角色，不能阻断 InnerOS 主流程。10. 每次只执行一个小阶段，完成后等待下一步确认。
十四、你现在应该怎么做
找到你之前那个本地 2D 桌宠项目的文件夹。
把桌宠项目的目录截图，或把主要文件名发给 Agent。
确认它是 PNG 序列帧、Live2D、Spine、Rive，还是 Electron/Python/Unity 程序。
先不要急着买 Azure 服务或配置数据库。
让 Agent 只执行“阶段 0：备份与勘察”。
拿到勘察报告后，再执行“阶段 1：独立网页 Demo”。
最重要的一句话：先把角色安全地放进网页，再让它和 InnerOS 产生联系，最后才让它成为真正的私人 AI 助手。这样最稳，也最适合你现在的项目状态。
附录：建议的第一条任务
请 Agent 执行：
“只做桌宠网页化前置勘察。不要修改任何业务代码。请检查当前 InnerOS 目录、现有本地桌宠项目、素材格式、动画依赖和运行方式，输出一份清单：哪些文件可直接复用、哪些需要转换、推荐采用哪种网页渲染方案、第一阶段需要新增哪些文件，以及如何回滚。完成后停止，等待确认。”