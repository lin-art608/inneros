// InnerOS 前端赛事模块（ARCH-015 / V1.19.2）
// 足球：赛事列表 → 联赛赛程 → 比赛详情；主队搜索添加；无比赛回退最近几天
// CS2：A级以上赛事（中文名）→ 赛程 → 详情；主队管理
// IIFE + window.InnerOSSports
(function () {
  'use strict';

  // ========== 页面状态管理 ==========
  let view = { page: 'football_home', params: {} };
  let historyStack = [];

  function navigateTo(page, params) {
    historyStack.push({ ...view });
    view = { page, params: params || {} };
    render();
  }
  function goBack() {
    if (historyStack.length > 0) {
      view = historyStack.pop();
      render();
    }
  }

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
    } catch (e) { /* 忽略 */ }
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
  async function enrichBadges(matches, sport) {
    for (const m of matches) {
      if (!m.home_badge) m.home_badge = await getCachedBadge(m.home_id, m.home_name, sport);
      if (!m.away_badge) m.away_badge = await getCachedBadge(m.away_id, m.away_name, sport);
      if (m.home_badge) await setCachedBadge(m.home_id, m.home_name, sport, m.home_badge);
      if (m.away_badge) await setCachedBadge(m.away_id, m.away_name, sport, m.away_badge);
    }
    return matches;
  }

  // ========== 图片代理（API-Football 图片需要 key） ==========
  function proxyImg(url) {
    if (!url) return '';
    if (url.includes('api-sports.io')) return '/api/v1/football/image?url=' + encodeURIComponent(url);
    return url;
  }

  // ========== CS2 中文名映射 ==========
  const CS2_TEAM_CN = {
    'Natus Vincere': 'NAVI', 'NAVI': 'NAVI', 'FaZe Clan': 'FaZe', 'FaZe': 'FaZe',
    'G2 Esports': 'G2', 'G2': 'G2', 'Team Vitality': 'Vitality', 'Vitality': 'Vitality',
    'Team Spirit': 'Spirit', 'Spirit': 'Spirit', 'MOUZ': 'MOUZ', 'Team Liquid': 'Liquid',
    'Liquid': 'Liquid', 'FURIA Esports': 'FURIA', 'FURIA': 'FURIA', 'Astralis': 'Astralis',
    'Heroic': 'Heroic', 'Cloud9': 'C9', 'ENCE': 'ENCE', 'Ninjas in Pyjamas': 'NiP',
    'NiP': 'NiP', 'Complexity': 'COL', 'Evil Geniuses': 'EG', 'paiN Gaming': 'paiN',
    'Imperial': 'Imperial', 'The MongolZ': '蒙古队', 'Team Falcons': 'Falcons',
    'Falcons': 'Falcons', 'Aurora Gaming': 'Aurora', 'BetBoom Team': 'BetBoom',
    'TYLOO': '天禄', 'RA': 'RA', 'Wings Up': 'Wings Up', 'Dplus KIA': 'DK',
    'T1': 'T1', 'Gen.G': 'Gen.G', 'DRX': 'DRX', 'Lynn Vision': 'LVG',
    '9z Team': '9z', 'SAW': 'SAW', 'AMKAL': 'AMKAL', 'Eternal Fire': '永恒之火',
    'Sangal': 'Sangal', 'Metizport': 'Metizport', 'Preasy': 'Preasy',
    'Apeks': 'Apeks', 'BIG': 'BIG', 'Sprout': 'Sprout', 'HEET': 'HEET',
  };
  const CS2_TOURNAMENT_CN = {
    'BLAST Premier Spring Groups': 'BLAST 春季小组赛',
    'BLAST Premier Fall Groups': 'BLAST 秋季小组赛',
    'BLAST Premier Spring Final': 'BLAST 春季总决赛',
    'BLAST Premier Fall Final': 'BLAST 秋季总决赛',
    'BLAST Premier World Final': 'BLAST 世界总决赛',
    'BLAST Premier Showdown': 'BLAST 赏金赛',
    'BLAST.tv Major': 'BLAST Major',
    'IEM Katowice': 'IEM 卡托维兹',
    'IEM Cologne': 'IEM 科隆',
    'IEM Rio': 'IEM 里约',
    'IEM Dallas': 'IEM 达拉斯',
    'IEM Chengdu': 'IEM 成都',
    'IEM Sydney': 'IEM 悉尼',
    'Intel Extreme Masters': 'IEM 英特尔极限大师赛',
    'ESL Pro League': 'ESL 职业联赛',
    'ESL Challenger': 'ESL 挑战者联赛',
    'PGL Major': 'PGL Major',
    'DreamHack Masters': 'DreamHack 大师赛',
    'Thunderpick World Championship': 'Thunderpick 世界锦标赛',
    'RMR': 'RMR  Major 预选赛',
    'Regional Major Ranking': 'RMR Major 预选赛',
  };
  function cs2TeamCN(name) {
    if (!name) return name;
    return CS2_TEAM_CN[name] || name;
  }
  function cs2TournamentCN(name) {
    if (!name) return name;
    for (const key in CS2_TOURNAMENT_CN) {
      if (name.includes(key)) return name.replace(key, CS2_TOURNAMENT_CN[key]);
    }
    return name;
  }

  // ========== 数据获取 ==========
  async function fetchFootballFixtures(date) {
    const d = date || getToday();
    try {
      const res = await window.InnerOSApi.get(`/api/v1/football/fixtures?date=${d}`);
      if (res.data && res.data.fallback) return fetchLegacyFootball();
      return (res.data && res.data.matches) || [];
    } catch (e) { return fetchLegacyFootball(); }
  }
  async function fetchLegacyFootball() {
    try {
      const res = await fetch(`/api/sports?type=matches&leagues=4328,4335,4331,4332,4334,4480`);
      const data = await res.json();
      return (data.matches || []).map(m => ({ ...m, sport: 'football' }));
    } catch (e) { return []; }
  }
  async function fetchFootballTeamFixtures(teamId) {
    try {
      const res = await window.InnerOSApi.get(`/api/v1/football/fixtures?team=${teamId}`);
      if (res.data && res.data.fallback) return [];
      return (res.data && res.data.matches) || [];
    } catch (e) { return []; }
  }
  async function searchFootballTeams(q) {
    try {
      const res = await window.InnerOSApi.get(`/api/v1/football/teams?search=${encodeURIComponent(q)}`);
      return (res.data && res.data.teams) || [];
    } catch (e) { return []; }
  }
  async function fetchFootballFixtureDetail(fixtureId) {
    try {
      const res = await window.InnerOSApi.get(`/api/v1/football/fixture?id=${fixtureId}`);
      return res.data || null;
    } catch (e) { return null; }
  }
  async function fetchCS2Matches() {
    try {
      const res = await fetch(`/api/sports?type=cs2matches`);
      const data = await res.json();
      return (data.matches || []).map(m => ({
        ...m,
        sport: 'cs2',
        home_name: cs2TeamCN(m.home_name),
        away_name: cs2TeamCN(m.away_name),
        league: cs2TournamentCN(m.league),
      }));
    } catch (e) { return []; }
  }
  async function searchCS2Teams(q) {
    try {
      const res = await fetch(`/api/sports?type=teamsearch&sport=cs2&q=${encodeURIComponent(q)}`);
      const data = await res.json();
      return (data.results || []).map(t => ({
        id: t.id || t.provider_team_id || t.name,
        name: cs2TeamCN(t.name) || t.name,
        logo: t.badge || t.logo || '',
        full: t.full || t.name,
      }));
    } catch (e) { return []; }
  }
  function getToday() {
    const now = new Date();
    const bj = new Date(now.getTime() + 8 * 3600 * 1000);
    return bj.toISOString().slice(0, 10);
  }
  function getDateOffset(offset) {
    const now = new Date();
    const bj = new Date(now.getTime() + 8 * 3600 * 1000 + offset * 86400000);
    return bj.toISOString().slice(0, 10);
  }

  // ========== 常用联赛 ==========
  const POPULAR_LEAGUES = [
    { id: 39, name: '英超', logo: 'https://media-1.api-sports.io/football/leagues/39.png' },
    { id: 140, name: '西甲', logo: 'https://media-1.api-sports.io/football/leagues/140.png' },
    { id: 78, name: '德甲', logo: 'https://media-1.api-sports.io/football/leagues/78.png' },
    { id: 135, name: '意甲', logo: 'https://media-1.api-sports.io/football/leagues/135.png' },
    { id: 61, name: '法甲', logo: 'https://media-1.api-sports.io/football/leagues/61.png' },
    { id: 2, name: '欧冠', logo: 'https://media-1.api-sports.io/football/leagues/2.png' },
    { id: 3, name: '欧联杯', logo: 'https://media-1.api-sports.io/football/leagues/3.png' },
    { id: 197, name: '中超', logo: 'https://media-1.api-sports.io/football/leagues/197.png' },
  ];

  // ========== 主队管理 ==========
  async function getFollowedTeams(sport) {
    const teams = await window.dbGetTeams();
    return teams.filter(t => t.sport === sport);
  }
  async function addFollowedTeam(team, sport) {
    await window.dbAddTeam({ ...team, sport });
  }
  async function removeFollowedTeam(id) {
    await window.dbDeleteTeam(id);
  }

  // ========== 渲染工具 ==========
  function escapeHtml(str) {
    return String(str || '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }
  // 队徽：无 fallback 首字母圆形，加载失败直接隐藏
  function renderBadge(badge, name) {
    if (!badge) return '';
    return `<img src="${badge}" class="sp-badge" alt="" onerror="this.style.display='none'">`;
  }
  function renderMatchCard(m, sport, showLeague) {
    const isLive = m.status === 'live';
    const isFinished = m.status === 'finished';
    const statusBadge = isLive
      ? '<span class="sp-status sp-live">● 直播</span>'
      : isFinished
        ? '<span class="sp-status sp-finished">已结束</span>'
        : '<span class="sp-status sp-upcoming">未开赛</span>';
    const scoreHtml = (m.home_score != null && m.away_score != null)
      ? `<span class="sp-score">${m.home_score} - ${m.away_score}</span>`
      : `<span class="sp-time">${m.time || ''}</span>`;
    return `<div class="sp-card ${isLive ? 'sp-card-live' : ''}" onclick="window.InnerOSSports.openMatchDetail('${m.id}', '${sport}')">
      <div class="sp-card-header">
        <span class="sp-league">${escapeHtml(showLeague !== false ? (m.league || '') : '')}</span>
        ${statusBadge}
      </div>
      <div class="sp-card-body">
        <div class="sp-team sp-team-home">
          ${renderBadge(m.home_badge, m.home_name)}
          <span class="sp-team-name">${escapeHtml(m.home_name || '')}</span>
        </div>
        <div class="sp-vs">${scoreHtml}</div>
        <div class="sp-team sp-team-away">
          <span class="sp-team-name">${escapeHtml(m.away_name || '')}</span>
          ${renderBadge(m.away_badge, m.away_name)}
        </div>
      </div>
    </div>`;
  }
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
    const today = getToday();
    const tomorrow = getDateOffset(1);
    const yesterday = getDateOffset(-1);
    if (dateStr === today) return '今天';
    if (dateStr === tomorrow) return '明天';
    if (dateStr === yesterday) return '昨天';
    const weekdays = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];
    return `${dateStr.slice(5)} ${weekdays[d.getDay()]}`;
  }
  function renderBackButton(title) {
    return `<div class="sp-page-header">
      <button class="sp-back-btn" onclick="window.InnerOSSports.back()">← 返回</button>
      <div class="sp-page-title">${escapeHtml(title)}</div>
    </div>`;
  }

  // ========== 搜索添加主队弹窗 ==========
  function openAddTeamModal(sport) {
    const modal = document.createElement('div');
    modal.className = 'sp-modal-overlay';
    modal.id = 'sp-add-team-modal';
    modal.innerHTML = `
      <div class="sp-modal">
        <div class="sp-modal-header">
          <span class="sp-modal-title">添加${sport === 'football' ? '足球' : 'CS2'}主队</span>
          <button class="sp-modal-close" onclick="window.InnerOSSports.closeAddTeamModal()">×</button>
        </div>
        <div class="sp-modal-body">
          <input type="text" class="sp-search-input" id="sp-team-search-input" placeholder="输入球队名称搜索..." autocomplete="off">
          <div class="sp-search-results" id="sp-team-search-results">
            <div class="sp-search-hint">输入球队名称，如"曼城"、"皇马"、"NAVI"</div>
          </div>
        </div>
      </div>`;
    document.body.appendChild(modal);

    const input = document.getElementById('sp-team-search-input');
    const results = document.getElementById('sp-team-search-results');
    let searchTimer = null;

    input.addEventListener('input', () => {
      const q = input.value.trim();
      clearTimeout(searchTimer);
      if (q.length < 1) {
        results.innerHTML = '<div class="sp-search-hint">输入球队名称，如"曼城"、"皇马"、"NAVI"</div>';
        return;
      }
      results.innerHTML = '<div class="sp-search-loading">搜索中...</div>';
      searchTimer = setTimeout(async () => {
        const teams = sport === 'football' ? await searchFootballTeams(q) : await searchCS2Teams(q);
        if (!teams.length) {
          results.innerHTML = '<div class="sp-search-empty">未找到相关球队，试试其他关键词</div>';
          return;
        }
        results.innerHTML = teams.map(t => `
          <div class="sp-search-result-item" onclick="window.InnerOSSports.confirmAddTeam('${t.id}', '${escapeHtml(t.name)}', '${proxyImg(t.logo)}', '${sport}')">
            ${renderBadge(proxyImg(t.logo), t.name)}
            <span class="sp-search-result-name">${escapeHtml(t.name)}</span>
            <span class="sp-search-result-add">＋ 添加</span>
          </div>`).join('');
      }, 400);
    });

    modal.addEventListener('click', (e) => {
      if (e.target === modal) closeAddTeamModal();
    });
    input.focus();
  }
  function closeAddTeamModal() {
    const modal = document.getElementById('sp-add-team-modal');
    if (modal) modal.remove();
  }
  async function confirmAddTeam(id, name, logo, sport) {
    await addFollowedTeam({ id, name, badge: logo, provider: sport === 'football' ? 'api-football' : 'liquipedia' }, sport);
    closeAddTeamModal();
    render();
  }

  // ========== 足球首页：联赛列表 + 主队 ==========
  async function renderFootballHome(container) {
    const followed = await getFollowedTeams('football');
    let html = `<div class="page-header">
      <div class="page-title">足球 · Football</div>
      <div class="page-subtitle">选择联赛查看赛程 · API-Football 数据源</div>
    </div>`;

    // 我的主队
    html += `<div class="sp-section">
      <div class="sp-section-header">
        <span class="sp-section-title">⭐ 我的主队</span>
        <button class="sp-add-btn" onclick="window.InnerOSSports.openAddTeam('football')">＋ 添加主队</button>
      </div>
      <div class="sp-teams-row">`;
    if (followed.length === 0) {
      html += `<div class="sp-empty-inline">还没有关注主队，点击「添加主队」搜索你支持的球队</div>`;
    } else {
      for (const t of followed) {
        html += `<div class="sp-team-chip" onclick="window.InnerOSSports.openTeam('${t.id}', '${escapeHtml(t.name)}', '${t.badge || ''}', 'football')">
          ${renderBadge(t.badge, t.name)}
          <span class="sp-team-chip-name">${escapeHtml(t.name)}</span>
          <button class="sp-team-remove" onclick="event.stopPropagation();window.InnerOSSports.removeTeam('${t.id}','football')">×</button>
        </div>`;
      }
    }
    html += `</div></div>`;

    // 联赛列表
    html += `<div class="sp-section">
      <div class="sp-section-header"><span class="sp-section-title">🏆 热门联赛</span></div>
      <div class="sp-league-grid">`;
    for (const league of POPULAR_LEAGUES) {
      const logo = proxyImg(league.logo);
      html += `<div class="sp-league-card" onclick="window.InnerOSSports.openLeague(${league.id}, '${league.name}', '${logo}')">
        <img src="${logo}" class="sp-league-logo" alt="" onerror="this.style.display='none'">
        <span class="sp-league-name">${league.name}</span>
      </div>`;
    }
    html += `</div></div>`;

    container.innerHTML = html;
  }

  // ========== 联赛赛程页（无比赛时回退最近几天） ==========
  async function renderLeaguePage(container, leagueId, leagueName, leagueLogo) {
    container.innerHTML = renderBackButton(leagueName) + `
      <div class="sp-tabs">
        <button class="sp-tab sp-tab-active" data-offset="0">今天</button>
        <button class="sp-tab" data-offset="1">明天</button>
        <button class="sp-tab" data-offset="2">后天</button>
      </div>
      <div class="sp-container" id="sp-league-content">${renderSkeleton(6)}</div>`;

    container.querySelectorAll('.sp-tab').forEach(btn => {
      btn.onclick = async () => {
        container.querySelectorAll('.sp-tab').forEach(b => b.classList.remove('sp-tab-active'));
        btn.classList.add('sp-tab-active');
        const offset = parseInt(btn.dataset.offset || '0');
        const targetDate = getDateOffset(offset);
        const content = document.getElementById('sp-league-content');
        if (content) content.innerHTML = renderSkeleton(6);
        await loadLeagueDate(targetDate, leagueId, content);
      };
    });

    await loadLeagueDate(getToday(), leagueId, document.getElementById('sp-league-content'));
  }
  async function loadLeagueDate(date, leagueId, contentEl) {
    if (!contentEl) return;
    let matches = await fetchFootballFixtures(date);
    if (leagueId) matches = matches.filter(m => String(m.league_id) === String(leagueId));

    // 无比赛时回退：拉取最近 3 天 + 未来 3 天
    if (matches.length === 0) {
      const all = [];
      for (let offset = -3; offset <= 3; offset++) {
        if (offset === 0) continue;
        const d = getDateOffset(offset);
        let dayMatches = await fetchFootballFixtures(d);
        if (leagueId) dayMatches = dayMatches.filter(m => String(m.league_id) === String(leagueId));
        all.push(...dayMatches);
      }
      matches = all;
      if (matches.length) {
        contentEl.innerHTML = `<div class="sp-no-today-notice">当天无比赛，以下为最近几天的赛程</div>` + contentEl.innerHTML;
      }
    }

    matches = await enrichBadges(matches, 'football');
    if (matches.length === 0) {
      contentEl.innerHTML = `<div class="empty-state"><div class="empty-state-icon">⚽</div><div class="empty-state-title">近期没有该联赛的比赛</div><div class="empty-state-desc">可能处于休赛期，换个联赛看看</div></div>`;
      return;
    }
    const groups = groupByDate(matches);
    let html = '';
    for (const g of groups) {
      html += `<div class="sp-date-group"><div class="sp-date-label">${formatDateLabel(g.date)}</div><div class="sp-grid">`;
      for (const m of g.matches) html += renderMatchCard(m, 'football', false);
      html += `</div></div>`;
    }
    // 保留无比赛提示
    const notice = contentEl.querySelector('.sp-no-today-notice');
    contentEl.innerHTML = (notice ? notice.outerHTML : '') + html;
  }

  // ========== 主队赛程页 ==========
  async function renderTeamPage(container, teamId, teamName, teamBadge, sport) {
    container.innerHTML = renderBackButton(teamName) + `
      <div class="sp-team-header">
        ${renderBadge(teamBadge, teamName)}
        <div class="sp-team-header-info">
          <div class="sp-team-header-name">${escapeHtml(teamName)}</div>
          <div class="sp-team-header-desc">${sport === 'football' ? '足球' : 'CS2'} · 近期赛程</div>
        </div>
      </div>
      <div class="sp-container" id="sp-team-content">${renderSkeleton(6)}</div>`;

    let matches = [];
    if (sport === 'football') {
      matches = await fetchFootballTeamFixtures(teamId);
    } else {
      const all = await fetchCS2Matches();
      const cnName = cs2TeamCN(teamName);
      matches = all.filter(m =>
        m.home_name === teamName || m.away_name === teamName ||
        m.home_name === cnName || m.away_name === cnName
      );
    }
    matches = await enrichBadges(matches, sport);
    const contentEl = document.getElementById('sp-team-content');
    if (!contentEl) return;
    if (matches.length === 0) {
      contentEl.innerHTML = `<div class="empty-state"><div class="empty-state-icon">📅</div><div class="empty-state-title">暂无赛程数据</div><div class="empty-state-desc">该球队近期没有比赛，或数据源暂未更新</div></div>`;
      return;
    }
    const upcoming = matches.filter(m => m.status !== 'finished').sort((a, b) => (a.ts || 0) - (b.ts || 0));
    const finished = matches.filter(m => m.status === 'finished').sort((a, b) => (b.ts || 0) - (a.ts || 0)).slice(0, 10);
    let html = '';
    if (upcoming.length) {
      html += `<div class="sp-date-group"><div class="sp-date-label">⏰ 即将开始</div><div class="sp-grid">`;
      for (const m of upcoming) html += renderMatchCard(m, sport, true);
      html += `</div></div>`;
    }
    if (finished.length) {
      html += `<div class="sp-date-group"><div class="sp-date-label">✅ 最近战绩</div><div class="sp-grid">`;
      for (const m of finished) html += renderMatchCard(m, sport, true);
      html += `</div></div>`;
    }
    contentEl.innerHTML = html;
  }

  // ========== CS2 首页 ==========
  async function renderCS2Home(container) {
    const followed = await getFollowedTeams('cs2');
    let html = `<div class="page-header">
      <div class="page-title">CS2 · Counter-Strike 2</div>
      <div class="page-subtitle">A级以上赛事 · Liquipedia 数据源 · 中文队名</div>
    </div>`;

    // 我的主队
    html += `<div class="sp-section">
      <div class="sp-section-header">
        <span class="sp-section-title">⭐ 我的主队</span>
        <button class="sp-add-btn" onclick="window.InnerOSSports.openAddTeam('cs2')">＋ 添加主队</button>
      </div>
      <div class="sp-teams-row">`;
    if (followed.length === 0) {
      html += `<div class="sp-empty-inline">还没有关注主队，点击「添加主队」搜索你支持的战队</div>`;
    } else {
      for (const t of followed) {
        html += `<div class="sp-team-chip" onclick="window.InnerOSSports.openTeam('${t.id}', '${escapeHtml(t.name)}', '${t.badge || ''}', 'cs2')">
          ${renderBadge(t.badge, t.name)}
          <span class="sp-team-chip-name">${escapeHtml(t.name)}</span>
          <button class="sp-team-remove" onclick="event.stopPropagation();window.InnerOSSports.removeTeam('${t.id}','cs2')">×</button>
        </div>`;
      }
    }
    html += `</div></div>`;

    // 全部赛事（按赛事分组）
    html += `<div class="sp-section">
      <div class="sp-section-header"><span class="sp-section-title">🎮 A级赛事</span></div>
      <div class="sp-container" id="sp-cs2-content">${renderSkeleton(8)}</div>
    </div>`;

    container.innerHTML = html;

    let matches = await fetchCS2Matches();
    matches = await enrichBadges(matches, 'cs2');
    const contentEl = document.getElementById('sp-cs2-content');
    if (!contentEl) return;
    if (matches.length === 0) {
      contentEl.innerHTML = `<div class="empty-state"><div class="empty-state-icon">🎮</div><div class="empty-state-title">暂无A级赛事</div><div class="empty-state-desc">近期可能没有顶级赛事，或 Liquipedia 数据获取中</div></div>`;
      return;
    }
    const byTournament = {};
    for (const m of matches) {
      const t = m.league || '其他赛事';
      if (!byTournament[t]) byTournament[t] = [];
      byTournament[t].push(m);
    }
    let html2 = '';
    for (const tour of Object.keys(byTournament)) {
      const tourMatches = byTournament[tour].sort((a, b) => (a.ts || 0) - (b.ts || 0));
      html2 += `<div class="sp-tournament-group">
        <div class="sp-tournament-name">${escapeHtml(tour)}</div>
        <div class="sp-grid">`;
      for (const m of tourMatches.slice(0, 10)) html2 += renderMatchCard(m, 'cs2', false);
      html2 += `</div></div>`;
    }
    contentEl.innerHTML = html2;
  }

  // ========== 比赛详情页 ==========
  async function renderMatchDetail(container, matchId, sport) {
    container.innerHTML = renderBackButton('比赛详情') + `
      <div class="sp-container" id="sp-detail-content">${renderSkeleton(3)}</div>`;

    if (sport === 'football') {
      const detail = await fetchFootballFixtureDetail(matchId);
      const contentEl = document.getElementById('sp-detail-content');
      if (!contentEl) return;
      if (!detail || !detail.fixture) {
        contentEl.innerHTML = `<div class="empty-state"><div class="empty-state-icon">📋</div><div class="empty-state-title">详情加载失败</div><div class="empty-state-desc">该比赛暂无详细数据</div></div>`;
        return;
      }
      const f = detail.fixture;
      const teams = detail.teams || {};
      const goals = detail.goals || {};
      const events = detail.events || [];
      const lineups = detail.lineups || [];

      let html = `<div class="sp-detail-header">
        <div class="sp-detail-team">
          ${renderBadge(proxyImg(teams.home?.logo), teams.home?.name)}
          <span class="sp-detail-team-name">${escapeHtml(teams.home?.name || '')}</span>
        </div>
        <div class="sp-detail-score">
          <span class="sp-detail-score-num">${goals.home ?? '-'} : ${goals.away ?? '-'}</span>
          <span class="sp-detail-status">${escapeHtml(f.status?.long || '')}</span>
          <span class="sp-detail-date">${f.date || ''} ${f.time || ''}</span>
          <span class="sp-detail-venue">${escapeHtml(f.venue?.name || '')} ${escapeHtml(f.venue?.city || '')}</span>
        </div>
        <div class="sp-detail-team">
          ${renderBadge(proxyImg(teams.away?.logo), teams.away?.name)}
          <span class="sp-detail-team-name">${escapeHtml(teams.away?.name || '')}</span>
        </div>
      </div>`;

      if (events && events.length) {
        html += `<div class="sp-detail-section"><div class="sp-detail-section-title">📋 比赛事件</div><div class="sp-events-list">`;
        for (const ev of events) {
          const icon = ev.type === 'Goal' ? '⚽' : ev.type === 'Card' ? (ev.detail === 'Yellow Card' ? '🟨' : '🟥') : ev.type === 'Subst' ? '🔄' : '📌';
          html += `<div class="sp-event-item">
            <span class="sp-event-time">${ev.time?.elapsed || ''}'</span>
            <span class="sp-event-icon">${icon}</span>
            <span class="sp-event-text">${escapeHtml(ev.team?.name || '')} - ${escapeHtml(ev.player?.name || '')} ${escapeHtml(ev.detail || '')}</span>
          </div>`;
        }
        html += `</div></div>`;
      }

      if (lineups && lineups.length) {
        html += `<div class="sp-detail-section"><div class="sp-detail-section-title">👥 阵容</div>`;
        for (const lu of lineups.slice(0, 2)) {
          html += `<div class="sp-lineup">
            <div class="sp-lineup-team">${renderBadge(proxyImg(lu.team?.logo), lu.team?.name)} ${escapeHtml(lu.team?.name || '')} - ${escapeHtml(lu.formation || '')}</div>
            <div class="sp-lineup-players">`;
          const starters = (lu.startXI || []).map(p => p.player?.name).filter(Boolean);
          html += starters.map(n => `<span class="sp-player">${escapeHtml(n)}</span>`).join('');
          html += `</div></div>`;
        }
        html += `</div>`;
      }

      contentEl.innerHTML = html;
    } else {
      const contentEl = document.getElementById('sp-detail-content');
      if (contentEl) {
        contentEl.innerHTML = `<div class="empty-state"><div class="empty-state-icon">🎮</div><div class="empty-state-title">CS2 比赛详情</div><div class="empty-state-desc">CS2 详细数据（地图比分、选手数据）需要额外 API 支持，当前 Liquipedia 免费接口无法提供。如需此功能，可考虑订阅 HLTV 或 PandaScore API。</div></div>`;
      }
    }
  }

  // ========== 主渲染入口 ==========
  async function render() {
    const container = document.getElementById('content');
    if (!container) return;
    switch (view.page) {
      case 'football_home':
        await renderFootballHome(container);
        break;
      case 'football_league':
        await renderLeaguePage(container, view.params.leagueId, view.params.leagueName, view.params.leagueLogo);
        break;
      case 'football_team':
      case 'cs2_team':
        await renderTeamPage(container, view.params.teamId, view.params.teamName, view.params.teamBadge, view.page.startsWith('football') ? 'football' : 'cs2');
        break;
      case 'cs2_home':
        await renderCS2Home(container);
        break;
      case 'match_detail':
        await renderMatchDetail(container, view.params.matchId, view.params.sport);
        break;
      default:
        await renderFootballHome(container);
    }
  }

  // ========== 对外 API ==========
  window.InnerOSSports = Object.freeze({
    renderFootball: (container) => { historyStack = []; view = { page: 'football_home', params: {} }; render(); },
    renderCS2: (container) => { historyStack = []; view = { page: 'cs2_home', params: {} }; render(); },
    openLeague: (leagueId, leagueName, leagueLogo) => navigateTo('football_league', { leagueId, leagueName, leagueLogo }),
    openTeam: (teamId, teamName, teamBadge, sport) => navigateTo(sport === 'football' ? 'football_team' : 'cs2_team', { teamId, teamName, teamBadge }),
    openMatchDetail: (matchId, sport) => navigateTo('match_detail', { matchId, sport }),
    openAddTeam: (sport) => openAddTeamModal(sport),
    closeAddTeamModal: closeAddTeamModal,
    confirmAddTeam: confirmAddTeam,
    removeTeam: async (id, sport) => { await removeFollowedTeam(id); render(); },
    back: goBack,
    refresh: render,
  });
})();
