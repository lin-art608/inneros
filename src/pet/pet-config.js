// 桌宠配置（阶段 1）——素材路径、动作参数、交互策略
// 参数来源：《桌宠网页化勘察报告》（v10 源程序 ACTION_COUNTS / ACTION_INTERVALS）
(function () {
  'use strict';

  window.InnerOSPetConfig = {
    // 素材根目录（相对站点根）
    basePath: 'assets/pet',

    // 展示尺寸（CSS 像素；移动端由 view 缩小）
    display: { width: 200, height: 250 },

    // 动作定义：帧数 / 帧间隔(ms) / 是否循环
    actions: {
      idle:  { frames: 8,  interval: 180, loop: true },
      wave:  { frames: 8,  interval: 160, loop: false },
      jump:  { frames: 8,  interval: 180, loop: false },
      dance: { frames: 64, interval: 42,  loop: true, loops: 2 },
      feed:  { frames: 8,  interval: 200, loop: false },
    },

    // 动作优先级（数字大者优先，防止低优先动作打断高优先动作）
    priority: { idle: 0, wave: 3, jump: 4, feed: 5, dance: 6 },

    // 全局最小冷却（ms）：避免连续点击导致动画混乱
    cooldown: 700,

    // 单次动作播放后回到的默认动作
    fallback: 'idle',

    // 气泡
    bubble: { duration: 3200, maxLength: 60 },

    // 页面隐藏时暂停（省电/省流量）
    pauseWhenHidden: true,

    // 移动端（视口宽度 < 768）展示尺寸与是否降帧
    mobile: { width: 140, height: 175, frameSkip: 1 },

    // 事件 → 动作映射（失败一律兜底 fallback）
    eventActions: {
      'pet:greeting': 'wave',
      'record:created': 'jump',
      'movie:imported': 'dance',
      'book:imported': 'dance',
      'photo:uploaded': 'jump',
      'assistant:thinking': 'idle',
      'assistant:answered': 'jump',
      'assistant:error': 'idle',
    },

    // 属性数值（阶段 5）——数值与桌面版 v10 一致，localStorage 相当于 pet_save.json
    state: {
      storageKey: 'inneros_pet_state',
      initial: { mood: 80, hunger: 30, energy: 90, intimacy: 50 },
      // 每分钟自然变化（正数=增加）；桌面版数值恒定，网页版加上缓慢流逝让"饿了"等状态真正会出现
      driftPerMinute: { mood: -0.15, hunger: 0.6, energy: -0.2, intimacy: 0 },
      // 待机（且页面可见未暂停）时每分钟回体力
      idleRegen: { energy: 0.9 },
      // 离开补偿上限（分钟）：久别归来的数值变化按此截断
      offlineCapMinutes: 240,
      // 动作奖励：feed 三项与桌面版 State.feed() 完全一致
      reward: {
        feed:  { hunger: -30, mood: +5,  intimacy: +2 },
        wave:  { mood: +1,  intimacy: +1 },
        jump:  { mood: +2,  energy: -2, intimacy: +1 },
        dance: { mood: +3,  energy: -4, intimacy: +2 },
      },
      // 结算与落盘周期（桌面版每 ≥10s 存一次）
      tickMs: 60000,
      saveIntervalMs: 10000,
    },

    // 自动说话（对齐桌面版 _bg_tick：25~45 秒随机，饿了优先）
    ambient: {
      enabled: true,
      minMs: 25000,
      maxMs: 45000,
      hungryAt: 70,
      lowEnergyAt: 25,
      lines: {
        hungry: '有点饿了…',
        tired: '想歇一会儿…',
        idle: ['嗯～', '好安静', '陪你待着', '…'],
      },
      talk: ['你好呀', '今天也辛苦了', '一直陪着你好吗', '要记得休息哦～'],
    },

    // 互动菜单（对齐桌面版右键菜单：喂食/挥手/跳一跳/跳个舞/说句话/查看属性）
    menu: [
      { id: 'feed',  label: '喂食' },
      { id: 'wave',  label: '挥手' },
      { id: 'jump',  label: '跳一跳' },
      { id: 'dance', label: '跳个舞' },
      { id: 'talk',  label: '说句话' },
      { id: 'stats', label: '查看属性' },
    ],

    // 拖拽：页面内自由拖动，位置记忆到 localStorage
    drag: {
      enabled: true,
      storageKey: 'inneros_pet_position',
    },

    // 待机微动作：叠加在 idle 帧之上的自然小动作（眨眼/伸展/环顾/整理衣服）
    microActions: {
      enabled: true,
      // 两次微动作之间的随机间隔（ms）
      minInterval: 4000,
      maxInterval: 9000,
      // 各微动作的权重（越高越常出现）
      weights: {
        blink: 55,       // 眨眼：最常见
        lookaround: 20,  // 环顾四周
        stretch: 15,     // 伸懒腰
        adjust: 10,      // 整理衣服/调整姿势
      },
      // 动画时长（ms），需与 CSS keyframes 时长一致
      durations: {
        blink: 360,
        lookaround: 2000,
        stretch: 1200,
        adjust: 1500,
      },
    },
  };
})();
