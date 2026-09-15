// 桌宠适配器（阶段 1）——"帧提供者"接口，隔离渲染引擎细节
// 当前实现：序列帧（FrameSequenceAdapter）。未来换 Spine / Live2D / Rive 时，
// 只需新增一个同接口的 adapter（load/url），pet-view 与 pet-controller 不用改。
(function () {
  'use strict';

  // 帧 URL：{base}/{action}/{action}_{i}.png（素材已归一化命名）
  function frameUrl(basePath, action, index) {
    return basePath + '/' + action + '/' + action + '_' + index + '.png';
  }

  function createFrameSequenceAdapter(config) {
    const loaded = new Map(); // action → true（已尝试加载）
    const cache = new Map();  // url → Image（浏览器缓存之外的对象复用）

    function preloadAction(action) {
      if (loaded.has(action)) return Promise.resolve();
      const def = config.actions[action];
      if (!def) return Promise.resolve();
      const jobs = [];
      for (let i = 0; i < def.frames; i++) {
        const url = frameUrl(config.basePath, action, i);
        if (cache.has(url)) continue;
        jobs.push(new Promise(resolve => {
          const img = new Image();
          img.onload = () => { cache.set(url, img); resolve(); };
          img.onerror = () => resolve(); // 单帧失败不阻断（view 会保持上一帧）
          img.src = url;
        }));
      }
      loaded.set(action, true);
      return Promise.all(jobs);
    }

    return {
      kind: 'frame-sequence',
      frameCount(action) { return (config.actions[action] || { frames: 1 }).frames; },
      urlFor(action, index) { return frameUrl(config.basePath, action, index); },
      isLoaded(action) { return loaded.has(action); },
      preloadAction,
      // 预热：idle 立即加载；其余动作空闲时逐个后台预载
      warmup(whenIdle) {
        const idle = preloadAction('idle');
        const rest = ['wave', 'jump', 'feed', 'dance'];
        if (typeof whenIdle === 'function') whenIdle(rest);
        return idle;
      },
    };
  }

  window.InnerOSPetAdapter = {
    createFrameSequenceAdapter,
    frameUrl,
  };
})();
