// 桌宠视图（阶段 1）——DOM 挂载、帧渲染、气泡、轻量控制
// 不认识业务数据、不发网络请求；只暴露 render(action, frameIndex) 与显隐/尺寸控制。
(function () {
  'use strict';

  function createView(config, adapter, root) {
    const isMobile = () => window.matchMedia('(max-width: 768px)').matches;
    const size = () => (isMobile() ? config.mobile : config.display);

    let lastAction = null;
    let lastIndex = -1;

    // 结构：容器 > 角色图 + 气泡 + 控制条
    const wrap = document.createElement('div');
    wrap.className = 'pet-stage';
    wrap.innerHTML =
      '<div class="pet-bubble" hidden></div>' +
      '<img class="pet-sprite" alt="私人助手" draggable="false">' +
      '<div class="pet-controls">' +
        '<button type="button" class="pet-btn" data-pet="pause" title="暂停/继续">⏸</button>' +
        '<button type="button" class="pet-btn" data-pet="smaller" title="缩小">−</button>' +
        '<button type="button" class="pet-btn" data-pet="bigger" title="放大">＋</button>' +
        '<button type="button" class="pet-btn" data-pet="hide" title="隐藏角色">✕</button>' +
      '</div>';
    root.appendChild(wrap);

    const img = wrap.querySelector('.pet-sprite');
    const bubble = wrap.querySelector('.pet-bubble');

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
      render(action, index) {
        if (action === lastAction && index === lastIndex) return; // 避免无谓 DOM 写入
        lastAction = action; lastIndex = index;
        img.src = adapter.urlFor(action, index);
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
      setScale(scale) {
        const v = Math.max(0.6, Math.min(1.6, scale));
        img.dataset.scale = String(v);
        applySize(v);
      },
      setVisible(visible) { wrap.classList.toggle('pet-hidden', !visible); },
      controls: wrap.querySelector('.pet-controls'),
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
