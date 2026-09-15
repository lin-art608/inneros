// 桌宠控制器（阶段 2-5）——动作状态机：播放、优先级、冷却、循环、暂停/恢复、页面隐藏自动暂停、五种表现状态
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
    let visual = 'idle';   // 表现层状态（阶段 5）：idle / thinking / happy / error，叠加在动作之上
    const API = {};

    function setVisual(name) {
      visual = name || 'idle';
      try { view.setVisualState(visual); } catch (e) { /* 视图不支持则忽略 */ }
    }

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
      setVisual(action === config.fallback ? 'idle' : 'happy');
      startTimer();
      return true;
    };

    // 五种状态（阶段 5）：idle / happy / thinking / error 各自有独立表现，其余走事件映射表
    API.setState = function (state) {
      if (state === 'thinking') { API.play('idle', { force: true }); setVisual('thinking'); view.say('让我想想…'); return; }
      if (state === 'error') { API.play('idle', { force: true }); setVisual('error'); view.say('我有点转不过来…'); return; }
      if (state === 'happy') { API.play('jump', { force: true }); setVisual('happy'); return; }
      if (state === 'idle') { API.play('idle', { force: true }); setVisual('idle'); return; }
      const mapped = config.eventActions['assistant:' + state];
      if (mapped) API.play(mapped, { force: true });
    };

    API.pause = function () { paused = true; };
    API.resume = function () { paused = false; startTimer(); };
    API.isPaused = function () { return paused; };
    API.currentAction = function () { return current; };
    API.currentVisual = function () { return visual; };
    // 彻底销毁：页面重渲染后需要重新挂载，旧定时器与监听必须清干净（否则越切页面越卡）
    API.destroy = function () {
      stopTimer();
      clearInterval(queueTimer);
      document.removeEventListener('visibilitychange', onVisibility);
    };

    // 页面隐藏自动暂停（省电/省流量），返回后恢复
    function onVisibility() { if (document.hidden) API.pause(); else API.resume(); }
    if (config.pauseWhenHidden) {
      document.addEventListener('visibilitychange', onVisibility);
    }

    // 空闲后处理被冷却拦截的排队动作
    const queueTimer = setInterval(() => {
      if (queued && Date.now() - lastPlayAt >= config.cooldown) { const a = queued; queued = null; API.play(a); }
    }, 300);

    view.render(current, 0);
    startTimer();
    return API;
  }

  window.InnerOSPetController = { createController };
})();
