// 桌宠事件层（阶段 4 前置）——本地事件总线 + InnerOS 业务事件接入
// 事件 → 动作映射在 pet-config.eventActions；本文件只负责订阅与分发。
// 原则：宠物出任何问题都不得阻断主流程（全部 try/catch + 兜底动作）。
(function () {
  'use strict';

  function createEventBus() {
    const handlers = new Map();
    return {
      on(event, fn) {
        if (!handlers.has(event)) handlers.set(event, new Set());
        handlers.get(event).add(fn);
        return () => handlers.get(event).delete(fn);
      },
      emit(event, payload) {
        const set = handlers.get(event);
        if (set) set.forEach(fn => { try { fn(payload); } catch (e) { console.warn('[pet-events]', event, e); } });
        window.dispatchEvent(new CustomEvent('inneros:' + event, { detail: payload }));
      },
    };
  }

  const bus = createEventBus();

  // 把事件总线接到桌宠控制器（动作映射 + 兜底）
  function bindToPet(config, pet, view) {
    Object.keys(config.eventActions).forEach(event => {
      bus.on(event, (payload) => {
        try {
          const action = config.eventActions[event];
          if (event === 'pet:greeting') pet.play('wave', { force: true });
          else pet.play(action);
          if (payload && payload.bubble) view.say(payload.bubble);
        } catch (e) {
          console.warn('[pet-events] 动作播放失败，降级为待机', e);
          try { pet.play(config.fallback, { force: true }); } catch (e2) { /* 彻底失败则保持静态 */ }
        }
      });
    });
  }

  window.InnerOSPetEvents = bus;
  window.InnerOSPetEvents.bindToPet = bindToPet;
})();
