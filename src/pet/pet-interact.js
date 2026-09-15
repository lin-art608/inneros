// 桌宠交互层（阶段 5）——把桌面版小程序的行为搬到网页：
//   单击角色 = 打开互动菜单（对应桌面版右键菜单）/ 双击角色 = 喂食
//   菜单项：喂食/挥手/跳一跳/跳个舞/说句话/查看属性（属性面板 = 桌面版"查看属性"）
//   自动说话：25~45 秒随机（饿了优先），对齐桌面版 _bg_tick
//   数值结算：每分钟按时长流逝；待机且页面可见时回体力；每 10 秒落盘（对齐桌面版存盘节奏）
// 约束：不碰素材、不发请求；任何异常都只降级（宠物挂了不影响 InnerOS 主流程）。
(function () {
  'use strict';

  function createInteraction(config, ctx) {
    const pet = ctx.pet;
    const view = ctx.view;
    const state = ctx.state;
    const sc = config.state || {};
    const AC = config.ambient || {};

    let clickTimer = null;
    let driftTimer = null;
    let ambientTimer = null;
    let saveTimer = null;
    let lastTickAt = Date.now();
    let dirty = false;
    let destroyed = false;

    function markDirty() { dirty = true; }

    function flush(force) {
      if (!dirty && !force) return false;
      try { state.save(); } catch (e) { /* 存盘失败不影响使用 */ }
      dirty = false;
      return true;
    }

    function idleNow() {
      try { return !pet || pet.currentAction() === config.fallback; } catch (e) { return true; }
    }

    function safePlay(action) {
      try { return pet.play(action, { force: true }); } catch (e) { return false; }
    }

    // ---- 交互动作 ----
    function doFeed() {
      try {
        view.hidePanels();
        state.feed();
        markDirty();
        safePlay('feed');
        view.say('好好吃～');
      } catch (e) { console.warn('[pet] 喂食失败', e); }
    }

    function pick(id) {
      try {
        if (id === 'feed') return doFeed();
        if (id === 'talk') { view.say(state.talkLine()); return; }
        if (id === 'stats') { view.showStats(state.rows()); return; }
        if (!config.actions[id]) return;
        view.hidePanels();
        state.award(id);
        markDirty();
        safePlay(id);
      } catch (e) { console.warn('[pet] 菜单动作失败', e); }
    }

    // 菜单在点击里才构建，属性面板打开时数值是最新的
    function openMenu() {
      if (typeof view.renderMenu === 'function') {
        view.renderMenu(config.menu || [], pick);
      }
      return view.toggleMenu();
    }

    function onSpriteClick() {
      clearTimeout(clickTimer);
      // 单击/双击区分：等 260ms 确认不是双击再开菜单（移动端点按同样走这里）
      clickTimer = setTimeout(() => { clickTimer = null; openMenu(); }, 260);
    }

    function onSpriteDblClick(e) {
      if (e && e.preventDefault) e.preventDefault();
      clearTimeout(clickTimer);
      clickTimer = null;
      doFeed();
    }

    function onDocClick(e) {
      if (view.element && e.target && view.element.contains(e.target)) return;
      view.hidePanels();
    }

    function onKeyDown(e) {
      if (e.key === 'Escape') view.hidePanels();
    }

    // ---- 数值结算 ----
    function tickState() {
      const now = Date.now();
      const minutes = Math.min((now - lastTickAt) / 60000, Number(sc.offlineCapMinutes) || 240);
      lastTickAt = now;
      if (!(minutes > 0)) return;
      // 待机（且页面可见、未暂停）才回体力：玩耍/后台挂机不回
      const extra = {};
      if (!document.hidden && !isPaused() && idleNow()) {
        Object.keys(sc.idleRegen || {}).forEach(k => { extra[k] = sc.idleRegen[k]; });
      }
      state.drift(minutes, extra);
      markDirty();
    }

    function isPaused() {
      try { return pet && pet.isPaused(); } catch (e) { return false; }
    }

    // ---- 自动说话（对齐桌面版 _bg_tick）----
    function scheduleAmbient() {
      if (!AC.enabled) return;
      const min = Number(AC.minMs) || 25000;
      const max = Math.max(min, Number(AC.maxMs) || 45000);
      const wait = min + Math.random() * (max - min);
      ambientTimer = setTimeout(() => {
        ambientTimer = null;
        try {
          // 页面在后台或用户暂停时不打扰，直接跳过这一轮
          if (!document.hidden && !isPaused()) {
            const line = state.ambientLine();
            if (line) view.say(line);
          }
        } catch (e) { /* 忽略 */ }
        if (!destroyed) scheduleAmbient();
      }, wait);
    }

    // ---- 绑定 ----
    const sprite = view.sprite;
    if (sprite) {
      sprite.style.pointerEvents = 'auto';
      sprite.addEventListener('click', onSpriteClick);
      sprite.addEventListener('dblclick', onSpriteDblClick);
    }
    document.addEventListener('click', onDocClick);
    document.addEventListener('keydown', onKeyDown);
    // 具名函数：重挂载时要能摘掉，否则旧实例会把过时数值写回存档
    function onBeforeUnload() { flush(true); }
    function onVisibilityChange() { if (document.hidden) flush(true); }
    window.addEventListener('beforeunload', onBeforeUnload);
    document.addEventListener('visibilitychange', onVisibilityChange);

    driftTimer = setInterval(tickState, Number(sc.tickMs) || 60000);
    saveTimer = setInterval(() => flush(false), Number(sc.saveIntervalMs) || 10000);
    scheduleAmbient();

    return {
      feed: doFeed,
      pick: pick,
      openMenu: openMenu,
      tick: tickState,
      flush: flush,
      isDirty() { return dirty; },
      destroy() {
        destroyed = true;
        clearTimeout(clickTimer);
        clearInterval(driftTimer);
        clearInterval(saveTimer);
        clearTimeout(ambientTimer);
        if (sprite) {
          sprite.removeEventListener('click', onSpriteClick);
          sprite.removeEventListener('dblclick', onSpriteDblClick);
        }
        document.removeEventListener('click', onDocClick);
        document.removeEventListener('keydown', onKeyDown);
        window.removeEventListener('beforeunload', onBeforeUnload);
        document.removeEventListener('visibilitychange', onVisibilityChange);
        flush(true);
      },
    };
  }

  window.InnerOSPetInteract = { createInteraction };
})();
