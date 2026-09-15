// 桌宠入口（阶段 1-3）——对外唯一 API：window.InnerOSPet
// mount(selector) 挂载到指定容器；show/hide 记忆到 localStorage；
// 挂载失败一律降级（不抛错、不影响主流程）。
(function () {
  'use strict';

  const cfg = window.InnerOSPetConfig;
  const LS_KEY = 'inneros_pet_visible';

  let view = null;
  let pet = null;
  let adapter = null;
  let mounted = false;
  let scale = 1;

  function isMobile() { return window.matchMedia('(max-width: 768px)').matches; }

  function mount(selector) {
    if (mounted) return true;
    const root = typeof selector === 'string' ? document.querySelector(selector) : selector;
    if (!root || !cfg || !window.InnerOSPetAdapter || !window.InnerOSPetView || !window.InnerOSPetController) return false;
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

      // 事件接入（阶段 4）：业务事件 → 动作
      if (window.InnerOSPetEvents && window.InnerOSPetEvents.bindToPet) {
        window.InnerOSPetEvents.bindToPet(cfg, pet, view);
      }

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
      mounted = false;
      return false;
    }
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
  };

  window.InnerOSPet = API;
})();
