// 桌宠控制器（阶段 2）——动作状态机：播放、优先级、冷却、循环、暂停/恢复、页面隐藏自动暂停
// 与 DOM 细节解耦（只调用 view.render / view.say）与素材细节解耦（只调用 adapter）。
(function () {
  'use strict';

  function createController(config, adapter, view) {
    let current = config.fallback;
    let frame = 0;
    let passedLoops = 0;
    let timer = null;
    let paused = false;
    let lastPlayAt = 0;
    let queued = null;
    const API = {};

    function interval() {
      const def = config.actions[current] || { interval: 200 };
      const skip = window.matchMedia('(max-width: 768px)').matches ? config.mobile.frameSkip : 0;
      return def.interval * (1 + skip);
    }

    function tick() {
      const def = config.actions[current] || { frames: 1, loop: true };
      frame += 1;
      if (frame >= def.frames) {
        if (def.loop) {
          frame = 0;
          passedLoops += 1;
          if (def.loops && passedLoops >= def.loops) { API.play(config.fallback, { force: true }); return; }
        } else {
          API.play(config.fallback, { force: true });
          return;
        }
      }
      view.render(current, frame);
    }

    function startTimer() {
      stopTimer();
      timer = setInterval(() => {
        if (!paused && !document.hidden) tick();
      }, interval());
    }
    function stopTimer() { if (timer) { clearInterval(timer); timer = null; } }

    // 播放动作：优先级 + 冷却双重约束；被拒绝时可入队等待
    API.play = function (action, opts) {
      opts = opts || {};
      const def = config.actions[action];
      if (!def) return false;                 // 未知动作：忽略（兜底不影响主流程）
      const now = Date.now();
      const curPrio = (config.priority[current] || 0);
      const newPrio = (config.priority[action] || 0);
      if (!opts.force && current !== config.fallback && newPrio < curPrio) return false; // 低优先不打断
      if (!opts.force && now - lastPlayAt < config.cooldown) { queued = action; return false; } // 冷却中入队
      lastPlayAt = now;
      queued = null;
      current = action;
      frame = 0;
      passedLoops = 0;
      adapter.preloadAction(action).then(() => view.render(current, frame));
      view.render(current, frame); // 先用可能的缓存帧，避免空白
      startTimer();
      return true;
    };

    API.setState = function (state) {
      if (state === 'thinking') { API.play('idle', { force: true }); view.say('让我想想…'); return; }
      if (state === 'idle') { API.play('idle', { force: true }); return; }
      const mapped = config.eventActions['assistant:' + state];
      if (mapped) API.play(mapped, { force: true });
    };

    API.pause = function () { paused = true; };
    API.resume = function () { paused = false; startTimer(); };
    API.isPaused = function () { return paused; };
    API.currentAction = function () { return current; };
    API.destroy = function () { stopTimer(); };

    // 页面隐藏自动暂停（省电/省流量），返回后恢复
    if (config.pauseWhenHidden) {
      document.addEventListener('visibilitychange', () => {
        if (document.hidden) API.pause(); else API.resume();
      });
    }

    // 空闲后处理被冷却拦截的排队动作
    setInterval(() => {
      if (queued && Date.now() - lastPlayAt >= config.cooldown) { const a = queued; queued = null; API.play(a); }
    }, 300);

    view.render(current, 0);
    startTimer();
    return API;
  }

  window.InnerOSPetController = { createController };
})();
