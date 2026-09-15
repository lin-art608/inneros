# 桌宠网页化勘察报告（阶段 0 交付）

> 任务：把本地 2D 桌宠迁移为 InnerOS 网页内的私人助手角色
> 依据：《InnerOS 2D桌宠网页化_Azure可执行技术路线.docx》· 执行范围：阶段 0（勘察，不改业务代码）
> 勘察时间：桌面项目 `C:\Users\HONOR\Desktop\工作文件夹\Trae work\桌宠\v10`

## 1. 桌宠技术类型判定

| 判断项 | 结论 |
|---|---|
| 技术类型 | **Python（PySide6/Qt）桌面程序 + PNG 序列帧动画** |
| 迁移难度 | **最容易**（方案第三节"优先级"表格中的第一类：序列帧 PNG） |
| 是否依赖桌面窗口能力 | 是（无边框/置顶/鼠标穿透/系统托盘级交互）→ **这部分不可迁移**，网页版只重做"角色展示 + 网页内交互" |
| 是否需要 Spine/Live2D/Rive | 不需要 |

依据：`pet_v10.pyw` 使用 `QWidget + QTimer + QPixmap` 逐帧绘制；素材为逐帧 PNG。

## 2. 素材清单（可直接复用）

来源：`v10/assets/actions/` → 已复制并处理到 InnerOS `assets/pet/`

| 动作 | 帧数 | 单帧原始尺寸 | 循环 | 帧间隔(ms) | 用途建议 |
|---|---|---|---|---|---|
| idle | 8 | 400×500 RGBA | ✅ 循环 | 180 | 默认待机 |
| wave | 8 | 400×500 RGBA | 单次 | 160 | 问候 / 打开助手 |
| jump | 8 | 400×500 RGBA | 单次 | 180 | 高兴（保存成功） |
| dance | 64 | 400×500 RGBA | ✅ 循环 | 42 | 庆祝（导入作品） |
| feed | 8 | 400×500 RGBA | 单次 | 200 | 互动彩蛋 |

**复制时的处理**（为网页加载优化，原图未动）：
1. 尺寸 400×500 → **200×250**（LANCZOS，视觉一致，体积降 4 倍）
2. 调色板量化 128 色 + alpha 阈值清理（扁平插画风，肉眼无损）
3. 命名归一化为 `{action}_{i}.png`（原 idle 无补零 / dance 三位补零，混用不利于前端拼接）
4. 总体积：**13.1MB → 3.4MB**（96 帧）

未复制的素材（判断不需要）：`sheet_*.png` 精灵图（源程序用单帧，网页也用单帧）、`character.png`/聊天截图 jpg（非动画）、`dist/*.exe`、`qa/*`。

## 3. 与状态系统的关系

源程序有数值状态（mood/hunger/energy/intimacy，存 `pet_save.json`）。
**阶段 5（V1.22.0）已按桌面版契约整体迁移**：默认值 `{80, 30, 90, 50}`、`feed = 饥饿-30 / 心情+5 / 亲密+2`、每分钟自然流逝、离线按 240 分钟上限补算，逐项对齐 v10 `State` 类。
存档用**独立 localStorage 键** `inneros_pet_state`（相当于 `pet_save.json`），**不进 IndexedDB、不上云同步** —— 于是"与 InnerOS 数据模型冲突"这个顾虑自然消解（原阶段 1-3 的"不迁移"结论已被本轮取代）。
数值只影响桌宠自身的表现（档位文案/气泡/自动说话优先级），不参与任何业务逻辑。

## 4. 推荐渲染方案

**方案 A：序列帧 + DOM `<img>` 逐帧切换**（选定）
- 理由：素材就是序列帧；无需引入运行库；动作切换=换 URL，最稳
- 实现：`src/pet/pet-adapter.js` 封装"帧提供者"接口，未来换 Spine/Live2D 只替换 adapter，不动 view/controller
- 性能：**按需加载**（idle 先加载，其余动作首次播放时才拉取并缓存）；页面隐藏时暂停定时器；移动端可选降帧

## 5. 已落地文件（阶段 1-5）

```
assets/pet/{idle,wave,jump,dance,feed}/*.png    # 96 帧素材
src/pet/pet-config.js        # 动作/帧数/间隔/尺寸/策略配置 + 属性数值 + 自动说话 + 互动菜单
src/pet/pet-adapter.js       # 帧适配器（序列帧实现，预留 Spine/Live2D 接口）
src/pet/pet-view.js          # DOM 挂载与渲染（容器/角色/气泡/控制条/互动菜单/属性面板/唤醒按钮）
src/pet/pet-controller.js    # 动作状态机：优先级/冷却/队列/暂停恢复/页面隐藏/五种状态表现
src/pet/pet-events.js        # 本地事件总线（与 InnerOS 解耦）
src/pet/pet-mount.js         # 挂载编排（幂等挂载 + 属性/交互层降级 + teardown）
src/pet/pet-state.js         # 阶段 5：属性数值（对齐桌面版 State 类，localStorage 存档）
src/pet/pet-interact.js      # 阶段 5：单击开菜单/双击喂食/自动说话/定时落盘
src/pet/pet.css              # 独立样式
pet-demo.html                # 独立 Demo 页（不影响主站）
tests/unit/pet-state.test.mjs # 数值层单测（node vm 直跑 Core）
docs/pet-web-migration.md    # 本报告
```
挂载点：**AI 助手页**（`renderAIAssistant` 内新增 `#pet-container`，由 `window.InnerOSPet.mount()` 挂载；app.js 只负责调用，逻辑全在 src/pet）。
属性/交互层启动失败会单独 try/catch 降级为纯动画（`console.warn` 提示），**不影响动画与主站**。

## 6. 对外接口（方案第八节约定的 API）

```js
window.InnerOSPet.play('dance')    // 播放动作（受优先级/冷却约束）
window.InnerOSPet.setState('thinking')  // idle / thinking / happy / error（阶段 5 起四种）
window.InnerOSPet.pause() / resume()
window.InnerOSPet.show() / hide()  // 显隐并记忆到 localStorage；隐藏后由「唤醒桌宠」按钮回归
window.InnerOSPet.say('晚上好')     // 气泡文字
window.InnerOSPet.feed()           // 阶段 5：喂食（饥饿-30/心情+5/亲密+2）
window.InnerOSPet.stats()          // 阶段 5：切换属性面板
window.InnerOSPet.openMenu()       // 阶段 5：打开互动菜单
window.InnerOSPetEvents.emit('record:created', { type: 'movie' })
```

网页版的桌面菜单等价物（无右键菜单，改**单击角色**）：喂食 / 挥手 / 跳一跳 / 跳个舞 / 说句话 / 查看属性。
**双击角色 = 直接喂食**；Escape 或点空白处收面板。

事件映射（含失败兜底，宠物报错绝不阻断主流程）：

| 事件 | 动作 | 兜底 |
|---|---|---|
| pet:greeting（打开助手页） | wave | idle |
| record:created（保存记录） | jump | idle |
| movie:imported / 导入作品 | dance | jump |
| assistant:thinking | idle（降速 + 气泡"让我想想…"） | idle |
| assistant:error | idle（气泡"我有点转不过来…"） | 静态角色 |
| page:hidden | pause | 保持静态 |

## 7. 回滚方式

- 每阶段独立 commit；本阶段仅新增文件（`assets/pet/**`、`src/pet/**`、`pet-demo.html`、本报告）
- 主站唯一改动是 AI 助手页 3 行挂载代码，回滚只需还原该 commit 或移除 3 行
- 不改动 IndexedDB / D1 / 同步协议 / 现有页面行为；桌面版程序完全未动

## 8. 遗留与后续（不在本阶段）

- **点击角色进入文字对话**：仍待做。当前单击开的是**互动菜单**（喂食/动作/属性），不是对话；要做对话需先有 AI 后端（见下一条）
- 若需要"思考中/回答完成"更贴切的表现，需新增对应动作素材（当前用 idle 降速 / jump 近似）
- Azure/云端 AI 接入为独立后续阶段，与动画无关；**密钥一律不进前端**（本仓库红线：不引付费服务、密钥只进 CF 环境变量）
- 属性数值目前只存本机、不参与同步（有意为之：桌宠是本地陪伴，没有跨设备一致的语义）；若将来要同步，走标准同步协议而非另开接口
