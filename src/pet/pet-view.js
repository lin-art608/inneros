// 桌宠视图（阶段 1-5）——DOM 挂载、帧渲染、气泡、互动菜单、属性面板、轻量控制
// 不认识业务数据、不发网络请求；只暴露 render(action, frameIndex)/say/菜单与属性面板/显隐尺寸控制。
(function () {
  'use strict';

  function createView(config, adapter, root) {
    const isMobile = () => window.matchMedia('(max-width: 768px)').matches;
    const size = () => (isMobile() ? config.mobile : config.display);

    let lastAction = null;
    let lastIndex = -1;

    // 结构：容器 > 气泡 + 角色图 + 互动菜单 + 属性面板 + 控制条 + 唤醒按钮
    // 唤醒按钮常驻 DOM（隐藏角色后仍要能点回来，桌面版靠托盘图标，网页没有等价物）
    const wrap = document.createElement('div');
    wrap.className = 'pet-stage';
    wrap.innerHTML =
      '<div class="pet-bubble" hidden></div>' +
      '<img class="pet-sprite" alt="私人助手" draggable="false">' +
      '<div class="pet-menu" hidden></div>' +
      '<div class="pet-stats" hidden></div>' +
      '<div class="pet-controls">' +
        '<button type="button" class="pet-btn" data-pet="pause" title="暂停/继续">⏸</button>' +
        '<button type="button" class="pet-btn" data-pet="smaller" title="缩小">−</button>' +
        '<button type="button" class="pet-btn" data-pet="bigger" title="放大">＋</button>' +
        '<button type="button" class="pet-btn" data-pet="hide" title="隐藏角色">✕</button>' +
      '</div>' +
      '<button type="button" class="pet-wake" hidden>唤醒桌宠</button>';
    root.appendChild(wrap);

    const img = wrap.querySelector('.pet-sprite');
    const bubble = wrap.querySelector('.pet-bubble');
    const menu = wrap.querySelector('.pet-menu');
    const stats = wrap.querySelector('.pet-stats');
    const wake = wrap.querySelector('.pet-wake');
    const VISUAL_CLASSES = ['pet-thinking', 'pet-happy', 'pet-error'];

    function applySize(scale) {
      const s = size();
      const w = Math.round(s.width * scale);
      const h = Math.round(s.height * scale);
      img.style.width = w + 'px';
      img.style.height = h + 'px';
      wrap.style.width = w + 'px';
    }
    applySize(1);
    window.addEventListener('resize', () => applySize(img.dataset.scale ? Number(img.dataset.scale) : 1));

    let bubbleTimer = null;
    return {
      element: wrap,
      sprite: img,
      render(action, index) {
        if (action === lastAction && index === lastIndex) return; // 避免无谓 DOM 写入
        lastAction = action; lastIndex = index;
        img.src = adapter.urlFor(action, index);
      },
      // 五种状态的视觉区分（无对应帧素材，用滤镜/动画近似）
      setVisualState(name) {
        VISUAL_CLASSES.forEach(c => wrap.classList.remove(c));
        if (name === 'thinking' || name === 'happy' || name === 'error') wrap.classList.add('pet-' + name);
      },
      say(text) {
        const msg = String(text || '').slice(0, config.bubble.maxLength);
        if (!msg) return;
        bubble.textContent = msg;
        bubble.hidden = false;
        clearTimeout(bubbleTimer);
        bubbleTimer = setTimeout(() => { bubble.hidden = true; }, config.bubble.duration);
      },
      hideBubble() { bubble.hidden = true; clearTimeout(bubbleTimer); },
      // 互动菜单（替代桌面版右键菜单）
      renderMenu(items, onPick) {
        menu.innerHTML = '';
        (items || []).forEach(item => {
          const btn = document.createElement('button');
          btn.type = 'button';
          btn.className = 'pet-menu-item';
          btn.textContent = item.label;
          btn.addEventListener('click', (e) => { e.stopPropagation(); onPick(item.id); });
          menu.appendChild(btn);
        });
      },
      toggleMenu(open) {
        const next = (open === undefined) ? menu.hidden : !!open;
        menu.hidden = !next;
        if (next) stats.hidden = true; // 两个面板互斥，避免撑高页面
        return !menu.hidden;
      },
      isMenuOpen() { return !menu.hidden; },
      // 属性面板（对齐桌面版"查看属性"）
      showStats(rows) {
        stats.innerHTML = (rows || []).map(r =>
          '<div class="pet-stats-row">' +
            '<span class="pet-stats-label">' + r.label + '</span>' +
            '<span class="pet-stats-bar"><span class="pet-stats-fill ' + (r.tone || '') + '" style="width:' + r.value + '%"></span></span>' +
            '<span class="pet-stats-value" title="' + r.text + '">' + r.value + '</span>' +
          '</div>').join('');
        stats.hidden = false;
        menu.hidden = true;
        return true;
      },
      isStatsOpen() { return !stats.hidden; },
      hidePanels() { menu.hidden = true; stats.hidden = true; },
      setScale(scale) {
        const v = Math.max(0.6, Math.min(1.6, scale));
        img.dataset.scale = String(v);
        applySize(v);
      },
      setVisible(visible) {
        wrap.classList.toggle('pet-hidden', !visible);
        wake.hidden = !!visible;
        if (!visible) {
          // 隐藏时顺手收起浮层与气泡，避免残留节点挡住页面内容
          menu.hidden = true; stats.hidden = true;
          bubble.hidden = true; clearTimeout(bubbleTimer);
        }
      },
      controls: wrap.querySelector('.pet-controls'),
      // 唤醒按钮（隐藏后唯一的回归入口）
      onWake(handler) {
        wake.addEventListener('click', (e) => { e.stopPropagation(); handler(); });
      },
      onControl(handler) {
        wrap.querySelector('.pet-controls').addEventListener('click', (e) => {
          const btn = e.target.closest('[data-pet]');
          if (btn) handler(btn.dataset.pet);
        });
      },
    };
  }

  window.InnerOSPetView = { createView };
})();
