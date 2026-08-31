// InnerOS 前端赛事模块（ARCH-015 / V1.19.0）
// 从 app.js 迁出，统一足球+CS2 赛事界面。
// 足球：/api/v1/football/fixtures（API-Football，未配置 key 时回退旧 /api/sports）
// CS2：/api/sports?type=cs2matches（Liquipedia）
// 队徽：IndexedDB teams 表本地缓存，避免重复请求，提升渲染速度
// IIFE + window.InnerOSSports，与 media.js/footprint.js 同模式。
(function () {
  'use strict';

  // ========== 队徽缓存（IndexedDB teams 表） ==========
  async function getCachedBadge(teamId, teamName, sport) {
    const key = (sport || 'x') + ':' + (teamId || teamName || '');
    try {
      const db = await openTeamsDB();
      return new Promise(resolve => {
        const tx = db.transaction('teams', 'readonly');
        const req = tx.objectStore('teams').get(key);
        req.onsuccess = () => resolve(req.result ? req.result.badge : '');
        req.onerror = () => resolve('');
      });
    } catch (e) { return ''; }
  }

  async function setCachedBadge(teamId, teamName, sport, badge) {
    if (!badge) return;
    const key = (sport || 'x') + ':' + (teamId || teamName || '');
    try {
      const db = await openTeamsDB();
      const tx = db.transaction('teams', 'readwrite');
      tx.objectStore('teams').put({ key, badge, name: teamName, sport, ts: Date.now() });
    } catch (e) { /* 缓存失败不影响主流程 */ }
  }

  let _teamsDB = null;
  function openTeamsDB() {
    if (_teamsDB) return Promise.resolve(_teamsDB);
    return new Promise((resolve, reject) => {
      const req = indexedDB.open('memory_os', 4);
      req.onsuccess = () => { _teamsDB = req.result; resolve(_teamsDB); };
      req.onerror = () => reject(req.error);
    });
  }

  // 批量补全队徽：对没有 badge 的比赛，从缓存取；都没有则显示占位
  async function enrichBadges(matches, sport) {
    for (const m of matches) {
      if (!m.home_badge) m.home_badge = await getCachedBadge(m.home_id, m.home_name, sport);
      if (!m.away_badge) m.away_badge = await getCachedBadge(m.away_id, m.away_name, sport);
      // 缓存新获取的队徽
      if (m.home_badge) await setCachedBadge(m.home_id, m.home_name, sport, m.home_badge);
      if (m.away_badge) await setCachedBadge(m.away_id, m.away_name, sport, m.away_badge);
    }
    return matches;
  }

  // ========== 数据获取 ==========
  async function fetchFootballFixtures(date) {
    const d = date || getToday();
    try {
      const res = await window.InnerOSApi.get(`/api/v1/football/fixtures?date=${d}`);
      if (res.data && res.data.fallback) {
        // 未配置 API-Football key，回退旧接口
        return fetchLegacyFootball();
      }
      return (res.data && res.data.matches) || [];
    } catch (e) {
      console.warn('[sports] football fixtures failed, fallback', e);
      return fetchLegacyFootball();
    }
  }

  async function fetchLegacyFootball() {
    try {
      const res = await fetch(`/api/sports?type=matches&leagues=4328,4335,4331,4332,4334,4480`);
      const data = await res.json();
      return (data.matches || []).map(m => ({ ...m, sport: 'football' }));
    } catch (e) { return []; }
  }

  async function fetchCS2Matches() {
    try {
      const res = await fetch(`/api/sports?type=cs2matches`);
      const data = await res.json();
      return (data.matches || []).map(m => ({ ...m, sport: 'cs2' }));
    } catch (e) { return []; }
  }

  function getToday() {
    const now = new Date();
    const bj = new Date(now.getTime() + 8 * 3600 * 1000);
    return bj.toISOString().slice(0, 10);
  }

  // ========== 渲染：比赛卡片 ==========
  function renderMatchCard(m) {
    const isLive = m.status === 'live';
    const isFinished = m.status === 'finished';
    const statusBadge = isLive
      ? '<span class="sp-status sp-live">● 直播中</span>'
      : isFinished
        ? '<span class="sp-status sp-finished">已结束</span>'
        : '<span class="sp-status sp-upcoming">未开赛</span>';

    const scoreHtml = (m.home_score != null && m.away_score != null)
      ? `<span class="sp-score">${m.home_score} - ${m.away_score}</span>`
      : `<span class="sp-time">${m.time || ''}</span>`;

    const homeBadge = m.home_badge
      ? `<img src="${m.home_badge}" class="sp-badge" alt="" onerror="this.style.display='none';this.nextElementSibling.style.display='flex'"><span class="sp-badge-fallback" style="display:none">${(m.home_name || '?').slice(0, 2)}</span>`
      : `<span class="sp-badge-fallback">${(m.home_name || '?').slice(0, 2)}</span>`;

    const awayBadge = m.away_badge
      ? `<img src="${m.away_badge}" class="sp-badge" alt="" onerror="this.style.display='none';this.nextElementSibling.style.display='flex'"><span class="sp-badge-fallback" style="display:none">${(m.away_name || '?').slice(0, 2)}</span>`
      : `<span class="sp-badge-fallback">${(m.away_name || '?').slice(0, 2)}</span>`;

    return `<div class="sp-card ${isLive ? 'sp-card-live' : ''}">
      <div class="sp-card-header">
        <span class="sp-league">${escapeHtml(m.league || '')}</span>
        ${statusBadge}
      </div>
      <div class="sp-card-body">
        <div class="sp-team sp-team-home">
          ${homeBadge}
          <span class="sp-team-name">${escapeHtml(m.home_name || '')}</span>
        </div>
        <div class="sp-vs">${scoreHtml}</div>
        <div class="sp-team sp-team-away">
          <span class="sp-team-name">${escapeHtml(m.away_name || '')}</span>
          ${awayBadge}
        </div>
      </div>
      ${m.venue ? `<div class="sp-card-footer">${escapeHtml(m.venue)}</div>` : ''}
    </div>`;
  }

  function escapeHtml(str) {
    return String(str || '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  // 按日期分组
  function groupByDate(matches) {
    const groups = {};
    for (const m of matches) {
      const d = m.date || '未知';
      if (!groups[d]) groups[d] = [];
      groups[d].push(m);
    }
    return Object.keys(groups).sort().map(d => ({ date: d, matches: groups[d] }));
  }

  function formatDateLabel(dateStr) {
    if (!dateStr || dateStr === '未知') return '未知日期';
    const d = new Date(dateStr + 'T00:00:00+08:00');
    const today = new Date();
    const todayStr = new Date(today.getTime() + 8 * 3600 * 1000).toISOString().slice(0, 10);
    const tomorrow = new Date(today.getTime() + 8 * 3600 * 1000 + 86400000).toISOString().slice(0, 10);
    if (dateStr === todayStr) return '今天';
    if (dateStr === tomorrow) return '明天';
    const weekdays = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];
    return `${dateStr.slice(5)} ${weekdays[d.getDay()]}`;
  }

  // ========== 骨架屏 ==========
  function renderSkeleton(count) {
    let html = '';
    for (let i = 0; i < count; i++) {
      html += `<div class="sp-card sp-skeleton">
        <div class="sp-card-header"><div class="sp-skel-line" style="width:40%"></div><div class="sp-skel-line" style="width:20%"></div></div>
        <div class="sp-card-body">
          <div class="sp-skel-badge"></div><div class="sp-skel-line" style="width:30%"></div>
          <div class="sp-skel-line" style="width:15%"></div>
          <div class="sp-skel-line" style="width:30%"></div><div class="sp-skel-badge"></div>
        </div>
      </div>`;
    }
    return html;
  }

  // ========== 足球页面 ==========
  async function renderFootball(container) {
    const date = getToday();
    container.innerHTML = `
      <div class="page-header">
        <div class="page-title">足球 · Football</div>
        <div class="page-subtitle">${date} 赛程 · API-Football 数据源</div>
      </div>
      <div class="sp-tabs">
        <button class="sp-tab sp-tab-active" data-date="${date}">今天</button>
        <button class="sp-tab" data-offset="1">明天</button>
        <button class="sp-tab" data-offset="2">后天</button>
      </div>
      <div class="sp-container" id="sp-football-content">
        ${renderSkeleton(6)}
      </div>`;

    // tab 切换
    container.querySelectorAll('.sp-tab').forEach(btn => {
      btn.onclick = async () => {
        container.querySelectorAll('.sp-tab').forEach(b => b.classList.remove('sp-tab-active'));
        btn.classList.add('sp-tab-active');
        const offset = parseInt(btn.dataset.offset || '0');
        const targetDate = offset > 0
          ? new Date(Date.now() + 8 * 3600 * 1000 + offset * 86400000).toISOString().slice(0, 10)
          : date;
        const content = document.getElementById('sp-football-content');
        if (content) content.innerHTML = renderSkeleton(6);
        await loadFootballDate(targetDate, content);
      };
    });

    await loadFootballDate(date, document.getElementById('sp-football-content'));
  }

  async function loadFootballDate(date, contentEl) {
    if (!contentEl) return;
    let matches = await fetchFootballFixtures(date);
    matches = await enrichBadges(matches, 'football');
    if (matches.length === 0) {
      contentEl.innerHTML = `<div class="empty-state"><div class="empty-state-icon">⚽</div><div class="empty-state-title">当天没有赛程</div><div class="empty-state-desc">换个日期看看，或检查 API-Football 配置</div></div>`;
      return;
    }
    const groups = groupByDate(matches);
    let html = '';
    for (const g of groups) {
      html += `<div class="sp-date-group"><div class="sp-date-label">${formatDateLabel(g.date)}</div><div class="sp-grid">`;
      for (const m of g.matches) html += renderMatchCard(m);
      html += `</div></div>`;
    }
    contentEl.innerHTML = html;
  }

  // ========== CS2 页面 ==========
  async function renderCS2(container) {
    container.innerHTML = `
      <div class="page-header">
        <div class="page-title">CS2 · Counter-Strike 2</div>
        <div class="page-subtitle">赛事赛程 · Liquipedia 数据源</div>
      </div>
      <div class="sp-container" id="sp-cs2-content">
        ${renderSkeleton(6)}
      </div>`;

    let matches = await fetchCS2Matches();
    matches = await enrichBadges(matches, 'cs2');
    const contentEl = document.getElementById('sp-cs2-content');
    if (!contentEl) return;

    if (matches.length === 0) {
      contentEl.innerHTML = `<div class="empty-state"><div class="empty-state-icon">🎮</div><div class="empty-state-title">暂无赛事数据</div><div class="empty-state-desc">Liquipedia 数据获取中，请稍后刷新</div></div>`;
      return;
    }

    // 分类：直播中 / 即将开始 / 已结束
    const live = matches.filter(m => m.status === 'live');
    const upcoming = matches.filter(m => m.status === 'upcoming').sort((a, b) => (a.ts || 0) - (b.ts || 0));
    const finished = matches.filter(m => m.status === 'finished').sort((a, b) => (b.ts || 0) - (a.ts || 0));

    let html = '';
    if (live.length) {
      html += `<div class="sp-date-group"><div class="sp-date-label sp-date-live">🔴 直播中</div><div class="sp-grid">`;
      for (const m of live) html += renderMatchCard(m);
      html += `</div></div>`;
    }
    if (upcoming.length) {
      html += `<div class="sp-date-group"><div class="sp-date-label">⏰ 即将开始</div><div class="sp-grid">`;
      for (const m of upcoming.slice(0, 20)) html += renderMatchCard(m);
      html += `</div></div>`;
    }
    if (finished.length) {
      html += `<div class="sp-date-group"><div class="sp-date-label">✅ 已结束</div><div class="sp-grid">`;
      for (const m of finished.slice(0, 15)) html += renderMatchCard(m);
      html += `</div></div>`;
    }
    contentEl.innerHTML = html;
  }

  window.InnerOSSports = Object.freeze({
    renderFootball: renderFootball,
    renderCS2: renderCS2,
  });
})();
