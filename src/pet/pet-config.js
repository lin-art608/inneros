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
  };
})();
