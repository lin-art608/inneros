// InnerOS 页面层级与移动端导航手势（纯逻辑 + 轻量 Hub UI）
(function (global) {
  'use strict';

  const PAGE_PARENT = Object.freeze({
    today: 'memory', timeline: 'memory', library: 'memory', search: 'memory',
    onthisday: 'memory', random: 'memory', 'year-review': 'memory',
    'res-cs': 'resources', 'res-football': 'resources', 'res-ai': 'resources', 'res-links': 'resources',
  });

  const HUBS = Object.freeze({
    memory: {
      eyebrow: 'MEMORY', title: '记忆', desc: '记录、回看与整理你的个人时间。',
      items: [
        ['today', '今天', '今天发生了什么'], ['timeline', '时间线', '按日、月、季、年回看'],
        ['library', '收藏', '电影、书籍、音乐与地点'], ['search', '搜索', '查找所有记忆'],
        ['onthisday', '那年今日', '看看过去的今天'], ['random', '随机回忆', '重新遇见一段往事'],
        ['year-review', '年度回顾', '汇总这一年的生活'],
      ],
    },
    resources: {
      eyebrow: 'RESOURCES', title: '资源整合', desc: '把赛事与常用工具集中在一个入口。',
      items: [
        ['res-cs', 'CS2 赛程', '主队与近期比赛'], ['res-football', '足球赛程', '主队与近期比赛'],
        ['res-ai', 'AI 工具', '常用 AI 服务导航'], ['res-links', '常用资源', '开发、设计与效率工具'],
      ],
    },
  });

  function parentOf(page) { return PAGE_PARENT[page] || null; }

  function swipeAction(input) {
    const x1 = Number(input?.startX), y1 = Number(input?.startY);
    const x2 = Number(input?.endX), y2 = Number(input?.endY);
    if (![x1, y1, x2, y2].every(Number.isFinite)) return null;
    const dx = x2 - x1, dy = y2 - y1;
    const threshold = Number(input?.threshold) || 72;
    if (Math.abs(dx) < threshold || Math.abs(dx) < Math.abs(dy) * 1.25) return null;
    if (input?.sidebarOpen && dx < 0) return 'close';
    if (!input?.sidebarOpen && dx > 0) return 'open';
    return null;
  }

  function drawerProgress(input) {
    const width = Math.max(1, Number(input?.width) || 280);
    const deltaX = Number(input?.deltaX) || 0;
    const start = input?.sidebarOpen ? 1 : 0;
    return Math.max(0, Math.min(1, start + deltaX / width));
  }

  function settleDrawer(input) {
    const progress = Math.max(0, Math.min(1, Number(input?.progress) || 0));
    const velocityX = Number(input?.velocityX) || 0;
    if (velocityX >= 0.35) return true;
    if (velocityX <= -0.35) return false;
    return progress >= 0.5;
  }

  function hubHtml(page, iconFor) {
    const hub = HUBS[page];
    if (!hub) return '';
    return `<section class="nav-hub"><div class="nav-hub-hero"><span>${hub.eyebrow}</span><h1>${hub.title}</h1><p>${hub.desc}</p></div><div class="nav-hub-grid">${hub.items.map(([target, title, desc]) => `<button class="nav-hub-card" onclick="navigate('${target}')"><span class="nav-hub-icon">${iconFor ? iconFor(target) : ''}</span><span><strong>${title}</strong><small>${desc}</small></span><i aria-hidden="true">→</i></button>`).join('')}</div></section>`;
  }

  global.InnerOSNavigation = Object.freeze({ PAGE_PARENT, HUBS, parentOf, swipeAction, drawerProgress, settleDrawer, hubHtml });
})(typeof window !== 'undefined' ? window : globalThis);
