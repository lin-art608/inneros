// 桌宠入口（阶段 1-5）——对外唯一 API：window.InnerOSPet
// mount(selector) 挂载到指定容器；show/hide 记忆到 localStorage；
// 属性数值与交互（菜单/喂食/自动说话）由 pet-state.js + pet-interact.js 提供，
// 任一模块缺失或报错都降级（宠物的动画/静态形象仍然可用，不影响主流程）。
(function () {
  'use strict';

  const cfg = window.InnerOSPetConfig;
  const LS_KEY = 'inneros_pet_visible';

  let view = null;
  let pet = null;
  let adapter = null;
  let petState = null;
  let interact = null;
  let mounted = false;
  let scale = 1;

  function isMobile() { return window.matchMedia('(max-width: 768px)').matches; }

  function mount(selector) {
    const root = typeof selector === 'string' ? document.querySelector(selector) : selector;
    if (!root || !cfg || !window.InnerOSPetAdapter || !window.InnerOSPetView || !window.InnerOSPetController) return false;
    // 已挂载且节点仍在页面上 → 幂等返回；否则说明页面重渲染把旧容器换掉了，先拆干净再挂
    if (mounted && view && view.element && view.element.parentNode === root) return true;
    if (mounted) teardown();
    try {
      adapter = window.InnerOSPetAdapter.createFrameSequenceAdapter(cfg);
      view = window.InnerOSPetView.createView(cfg, adapter, root);
      pet = window.InnerOSPetController.createController(cfg, adapter, view);

      // 显隐：记忆用户选择（默认显示）
      const visible = localStorage.getItem(LS_KEY) !== '0';
      view.setVisible(visible);
      view.onControl((cmd) => {
        if (cmd === 'pause') {
          if (pet.isPaused()) { pet.resume(); view.say('继续活动～'); }
          else { pet.pause(); view.say('先休息一下'); }
        } else if (cmd === 'smaller') { scale = Math.max(0.6, scale - 0.15); view.setScale(scale); }
        else if (cmd === 'bigger') { scale = Math.min(1.6, scale + 0.15); view.setScale(scale); }
        else if (cmd === 'hide') { API.hide(); }
      });
      // 隐藏后唯一回归入口（网页端没有桌面版那种托盘图标）
      view.onWake(() => {
        API.show();
        view.say('我回来啦～');
      });

      // 事件接入（阶段 4）：业务事件 → 动作
      if (window.InnerOSPetEvents && window.InnerOSPetEvents.bindToPet) {
        window.InnerOSPetEvents.bindToPet(cfg, pet, view);
      }

      // 属性数值 + 交互（阶段 5）：菜单、喂食、自动说话、数值结算
      startInteraction();

      // 预热：idle 先加载，其余动作在网络空闲时后台预载
      adapter.warmup((rest) => {
        const idleCb = window.requestIdleCallback || ((cb) => setTimeout(cb, 1200));
        idleCb(() => rest.forEach(a => adapter.preloadAction(a)));
      });

      mounted = true;
      API.play('idle');
      view.say(isMobile() ? '你好～' : '你好～今天也陪你一起');
      window.InnerOSPetEvents && window.InnerOSPetEvents.emit('pet:greeting');
      return true;
    } catch (e) {
      console.warn('[pet] 挂载失败，已降级（不影响主流程）', e);
      teardown(); // 可能已经插入了半个 DOM，一并清掉，避免残留
      return false;
    }
  }

  // 数值/交互层单独启动：这一层坏了也只是少了菜单和数值，动画照常
  function startInteraction() {
    try {
      if (!window.InnerOSPetState || !window.InnerOSPetInteract) return false;
      petState = window.InnerOSPetState.createPetState(cfg);
      petState.load();
      interact = window.InnerOSPetInteract.createInteraction(cfg, { pet: pet, view: view, state: petState });
      // 首次使用直接看数值：让"饿了/没体力"这类档位从第一眼就有意义
      interact.flush(true);
      return true;
    } catch (e) {
      console.warn('[pet] 属性/交互层启动失败，已降级为纯动画', e);
      petState = null;
      interact = null;
      return false;
    }
  }

  // 卸载：清定时器/监听并摘掉旧节点，给下一次挂载留干净状态
  function teardown() {
    try { interact && interact.destroy(); } catch (e) { /* 忽略 */ }
    try { pet && pet.destroy && pet.destroy(); } catch (e) { /* 忽略 */ }
    try { view && view.element && view.element.parentNode && view.element.parentNode.removeChild(view.element); } catch (e) { /* 忽略 */ }
    interact = null;
    petState = null;
    pet = null;
    view = null;
    adapter = null;
    mounted = false;
    scale = 1;
  }

  const API = {
    mount,
    isMounted() { return mounted; },
    play(action, opts) { try { return pet ? pet.play(action, opts) : false; } catch (e) { return false; } },
    setState(state) { try { pet && pet.setState(state); } catch (e) { /* 忽略 */ } },
    pause() { try { pet && pet.pause(); } catch (e) {} },
    resume() { try { pet && pet.resume(); } catch (e) {} },
    isPaused() { try { return pet ? pet.isPaused() : false; } catch (e) { return false; } },
    say(text) { try { view && view.say(text); } catch (e) {} },
    show() { try { view && view.setVisible(true); localStorage.setItem(LS_KEY, '1'); } catch (e) {} },
    hide() { try { view && view.setVisible(false); localStorage.setItem(LS_KEY, '0'); } catch (e) {} },
    currentAction() { try { return pet ? pet.currentAction() : null; } catch (e) { return null; } },

    // ---- 阶段 5：属性与交互（对外可调，便于业务事件/控制台联动）----
    feed() { try { return interact ? (interact.feed(), true) : false; } catch (e) { return false; } },
    stats() { try { return petState ? petState.get() : null; } catch (e) { return null; } },
    openMenu() { try { return interact ? interact.openMenu() : false; } catch (e) { return false; } },
    hidePanels() { try { view && view.hidePanels(); } catch (e) {} },
    saveState() { try { return interact ? interact.flush(true) : false; } catch (e) { return false; } },
  };

  window.InnerOSPet = API;
})();
