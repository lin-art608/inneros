// InnerOS 前端赛事模块 V2 —— Sports Center 统一赛程中心（ARCH-016 / V1.20.0）
// 用户只理解三个层次：我的主队(scope=team) / 赛事(scope=competition) / 日期(今天/明天/后天/未来)。
// 数据流：UI → SportsScheduleService → FootballProvider/CS2Provider → normalizeMatch → Match → MatchList/DateGroup
// 规则（违反必返工）：
//   · Provider 原始对象禁止直接进 UI，一律 normalizeMatch 成统一 Match
//   · scope=team：以 teamId 为主，不受热门联赛(POPULAR_LEAGUES)/A 级(Tier1) 过滤截断
//   · scope=competition：以 competitionId 为主
//   · 日期按用户本地时区自然日计算，跨午夜比赛必须进入正确自然日（禁止字符串截取日期代替时区转换）
//   · UI 不直接访问第三方 API（统一走 /api/v1/** 与 /api/sports 代理）
// 纯逻辑挂 window.InnerOSSports.Core 供 node vm 单测（无 DOM 依赖）。
// IIFE + window.InnerOSSports
(function () {
  'use strict';

  // ========== 0. 页面状态 ==========
  let view = { page: 'home', params: { sport: 'football', scope: 'all', tab: 'today' } };
  let historyStack = [];

  function navigateTo(page, params) {
    // params 浅拷贝入栈：selectTab 只改当前 params，不污染历史记录
    historyStack.push({ page: view.page, params: { ...view.params } });
    view = { page, params: params || {} };
    render();
  }
  function goBack() {
    if (historyStack.length > 0) {
      view = historyStack.pop();
      render();
    }
  }

  // ========== 1. 统一 Match 模型 ==========
  // { id, sport, startAt, status:{state,label,detail}, home:{id,name,logo}, away:{id,name,logo},
  //   competition:{id,name,logo,tier}, score:{home,away}, provider, providerMatchId, format }
  const STATUS_LABEL = {
    scheduled: '未开赛', live: '直播', finished: '已结束', postponed: '已推迟', cancelled: '已取消',
  };
  function mapState(rawStatus) {
    switch (rawStatus) {
      case 'live': return 'live';
      case 'finished': return 'finished';
      case 'postponed': return 'postponed';
      case 'cancelled': return 'cancelled';
      default: return 'scheduled'; // 'upcoming' 及未知状态一律视为未开赛
    }
  }
  function toTs(raw) {
    if (typeof raw.ts === 'number' && raw.ts > 0) return raw.ts;
    if (typeof raw.ts === 'string' && raw.ts) {
      const t = Date.parse(raw.ts);
      if (!isNaN(t)) return t;
    }
    if (raw.date && raw.time) {
      const t = Date.parse(raw.date + 'T' + raw.time + ':00Z'); // 旧数据源时间为 UTC
      if (!isNaN(t)) return t;
    }
    return null;
  }
  function normalizeMatch(raw, sport) {
    const ts = toTs(raw);
    const state = mapState(raw.status);
    const isCS2 = sport === 'cs2';
    const boMatch = /^Bo[135]$/i.exec(String(raw.round || ''));
    return {
      id: String(raw.id || ''),
      sport: sport,
      startAt: ts != null ? new Date(ts).toISOString() : null,
      ts: ts,
      status: { state: state, label: STATUS_LABEL[state], detail: raw.status_text || '' },
      home: {
        id: String(raw.home_id || ''),
        name: isCS2 ? cs2TeamCN(raw.home_name) : (raw.home_name || ''),
        logo: proxyImg(raw.home_badge || ''),
      },
      away: {
        id: String(raw.away_id || ''),
        name: isCS2 ? cs2TeamCN(raw.away_name) : (raw.away_name || ''),
        logo: proxyImg(raw.away_badge || ''),
      },
      competition: {
        id: isCS2 ? String(raw.league || '') : String(raw.league_id || ''),
        name: isCS2 ? cs2TournamentCN(raw.league) : (raw.league || ''),
        logo: isCS2 ? '' : proxyImg(raw.league_logo || ''),
        tier: isCS2 ? 'A' : null,
      },
      score: {
        home: raw.home_score == null ? null : Number(raw.home_score),
        away: raw.away_score == null ? null : Number(raw.away_score),
      },
      provider: isCS2 ? 'liquipedia' : 'api-football',
      providerMatchId: String(raw.id || ''),
      format: boMatch ? boMatch[0] : '', // CS2 Bo1/Bo3/Bo5（Provider 有数据时）
    };
  }

  // ========== 2. 日期与时区（用户本地时区自然日） ==========
  function localDateKey(d) {
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return y + '-' + m + '-' + day;
  }
  function matchDateKey(m) {
    return m.ts != null ? localDateKey(new Date(m.ts)) : null;
  }
  function dateKeyOffset(offset) {
    const d = new Date();
    d.setDate(d.getDate() + offset);
    return localDateKey(d);
  }
  function todayKey() { return dateKeyOffset(0); }

  // 日期 tab：今天 / 明天 / 后天 / 未来（未来 = 后天之后 7 天，按本地日期分组）
  const DAY_TABS = [
    { key: 'today', label: '今天', offset: 0 },
    { key: 'tomorrow', label: '明天', offset: 1 },
    { key: 'dayafter', label: '后天', offset: 2 },
    { key: 'future', label: '未来', offset: null },
  ];
  function buildDayRange(tab) {
    if (tab === 'future') return { from: dateKeyOffset(3), to: dateKeyOffset(9) };
    const t = DAY_TABS.find(x => x.key === tab) || DAY_TABS[0];
    const key = dateKeyOffset(t.offset);
    return { from: key, to: key };
  }
  function inDateRange(m, from, to) {
    const key = matchDateKey(m);
    if (!key) return false;
    return key >= from && key <= to;
  }
  function mdCN(key) { return +key.slice(5, 7) + '月' + +key.slice(8, 10) + '日'; }
  const WEEKDAYS = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];
  function dateLabel(key) {
    if (key === todayKey()) return '今天 · ' + mdCN(key);
    if (key === dateKeyOffset(1)) return '明天 · ' + mdCN(key);
    if (key === dateKeyOffset(2)) return '后天 · ' + mdCN(key);
    const d = new Date(key + 'T12:00:00'); // 取正午，避免时区换算把日期挪到边界外
    return mdCN(key) + ' ' + (WEEKDAYS[d.getDay()] || '');
  }
  function groupByLocalDate(matches) {
    const groups = {};
    for (const m of matches) {
      const key = matchDateKey(m);
      if (!key) continue;
      (groups[key] = groups[key] || []).push(m);
    }
    return Object.keys(groups).sort().map(key => ({ date: key, label: dateLabel(key), matches: groups[key] }));
  }
  function localTime(ts) {
    if (ts == null) return '';
    const d = new Date(ts);
    return String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0');
  }

  // ========== 3. SportsScheduleQuery ==========
  // { sport, scope:'team'|'competition'|'all', teamId, team, competitionId, from, to, status }
  // scope=team：teamId 为第一过滤条件；scope=competition：competitionId 为第一过滤条件；
  // scope=all：首页默认（无主队/赛事选择，热门联赛过滤只在此场景用于赛事发现）。
  function buildQuery(ctx) {
    const range = buildDayRange(ctx.tab || 'today');
    const team = ctx.team || null;
    const comp = ctx.competition || null;
    return {
      sport: ctx.sport,
      scope: ctx.scope || 'all',
      teamId: team ? String(team.id || team.name || '') : null,
      team: team ? { id: String(team.id || ''), name: team.name || '', full: team.full || team.name || '' } : null,
      competitionId: comp ? String(comp.id != null ? comp.id : comp.name) : null,
      competitionName: comp ? (comp.name || '') : '',
      from: range.from,
      to: range.to,
      status: 'all',
    };
  }

  // ========== 4. Provider 层（请求构造 + 短 TTL 缓存） ==========
  const rawCache = new Map(); // url → { ts, data }
  const TTL = { normal: 120 * 1000, live: 30 * 1000 }; // 含直播场次时缓存更短

  function entryTTL(entry) {
    const matches = (entry.data && entry.data.matches) || [];
    return matches.some(m => m.status === 'live') ? TTL.live : TTL.normal;
  }
  function clearCache() { rawCache.clear(); }
  async function fetchV1(url) {
    const res = await window.InnerOSApi.get(url);
    return res.data;
  }
  async function fetchLegacy(url) {
    const res = await fetch(url);
    if (!res.ok) throw new Error('接口返回 ' + res.status);
    return res.json();
  }
  // 拉取一个 URL：缓存命中直接返回；失败时回退最近成功数据并标记 stale
  async function fetchRaw(url) {
    const entry = rawCache.get(url);
    if (entry && Date.now() - entry.ts < entryTTL(entry)) return { data: entry.data, stale: false };
    try {
      const data = url.indexOf('/api/v1/') === 0 ? await fetchV1(url) : await fetchLegacy(url);
      rawCache.set(url, { ts: Date.now(), data: data });
      return { data: data, stale: false };
    } catch (e) {
      if (entry) return { data: entry.data, stale: true };
      throw e;
    }
  }

  // 足球 Provider：API-Football（/api/v1/football/**）
  // scope=team → 单队查询（last+next，不下载热门联赛再前端筛选）
  // scope=competition → league 指定联赛；未来 tab 用 next=N
  // scope=all → 按日期逐天拉（后端已做热门联赛过滤，仅赛事发现）
  function buildFootballUrls(q) {
    if (q.scope === 'team') return ['/api/v1/football/fixtures?team=' + encodeURIComponent(q.teamId)];
    if (q.scope === 'competition') {
      const id = encodeURIComponent(q.competitionId);
      if (q.from === q.to) return ['/api/v1/football/fixtures?league=' + id + '&date=' + q.from];
      return ['/api/v1/football/fixtures?league=' + id + '&next=25'];
    }
    const urls = [];
    for (let d = new Date(q.from + 'T12:00:00'); localDateKey(d) <= q.to; d.setDate(d.getDate() + 1)) {
      urls.push('/api/v1/football/fixtures?date=' + localDateKey(d));
    }
    return urls;
  }
  const LEGACY_FOOTBALL_URL = '/api/sports?type=matches&leagues=4328,4335,4331,4332,4334,4480';

  // CS2 Provider：Liquipedia ticker（/api/sports?type=cs2matches）
  // scope=team → tier=all：主队查询拉全量，不受 A 级(Tier1) 过滤截断；其余场景默认 A 级赛事
  function buildCS2Url(q) {
    return q.scope === 'team'
      ? '/api/sports?type=cs2matches&tier=all'
      : '/api/sports?type=cs2matches';
  }
  function normKey(s) { return String(s || '').toLowerCase().replace(/[^a-z0-9一-鿿]/g, ''); }
  // 标准化 team identity：兼容 Liquipedia 页面标题(lp: 前缀)/全称/短名/中文名
  function teamIdentityKeys(team) {
    if (!team) return new Set();
    const out = new Set();
    for (const v of [team.id, team.name, team.full]) {
      if (!v) continue;
      const s = String(v).replace(/^lp:/, '');
      out.add(normKey(s));
      out.add(normKey(cs2TeamCN(s)));
    }
    return out;
  }
  function filterCS2ByTeam(rawList, team) {
    const keys = teamIdentityKeys(team);
    if (!keys.size) return [];
    return rawList.filter(m =>
      [m.home_id, m.home_name, m.away_id, m.away_name].some(x => keys.has(normKey(x))));
  }
  function competitionKey(s) { return normKey(s); }

  // ========== 5. SportsScheduleService ==========
  // query → Provider 拉取 → scope 过滤 → normalizeMatch → 日期过滤 → 去重 → 排序
  async function querySchedule(q) {
    const urls = q.sport === 'cs2' ? [buildCS2Url(q)] : buildFootballUrls(q);
    let stale = false;
    let degraded = null;
    let rawList = [];
    for (const url of urls) {
      const r = await fetchRaw(url);
      if (r.stale) stale = true;
      const data = r.data || {};
      if (data.fallback) {
        // 未配置 FOOTBALL_API_KEY：首页回退旧数据源（TheSportsDB）；主队/联赛查询无法降级，如实提示
        if (q.scope === 'all') {
          degraded = degraded || 'legacy';
          const lr = await fetchRaw(LEGACY_FOOTBALL_URL);
          if (lr.stale) stale = true;
          rawList = rawList.concat((lr.data && lr.data.matches) || []);
        } else {
          degraded = 'no-key';
        }
      } else {
        rawList = rawList.concat(data.matches || []);
      }
    }
    // scope 过滤（Provider 侧第一过滤条件）
    if (q.sport === 'cs2') {
      if (q.scope === 'team') rawList = filterCS2ByTeam(rawList, q.team);
      else if (q.scope === 'competition') rawList = rawList.filter(m => competitionKey(m.league) === competitionKey(q.competitionId));
    } else if (q.scope === 'competition') {
      rawList = rawList.filter(m => String(m.league_id) === String(q.competitionId));
    }
    // Provider 原始对象 → 统一 Match（UI 禁止理解原始对象）
    let matches = rawList.map(m => normalizeMatch(m, q.sport));
    // 日期过滤（本地时区自然日）
    matches = matches.filter(m => inDateRange(m, q.from, q.to));
    // 去重 + 排序（live 优先，其余按 startAt 升序）
    matches = dedupeMatches(matches);
    matches = sortMatches(matches);
    return { matches: matches, stale: stale, degraded: degraded };
  }

  function matchDedupeKey(m) {
    if (m.id) return m.sport + '|' + m.id;
    return m.sport + '|' + m.provider + '|' + m.home.id + '|' + m.away.id + '|' + (m.startAt || '');
  }
  function pickRicher(a, b) {
    const aScore = a.score.home != null || a.score.away != null;
    const bScore = b.score.home != null || b.score.away != null;
    if (aScore !== bScore) return aScore ? a : b; // 有比分者信息更全
    if ((a.status.state === 'live') !== (b.status.state === 'live')) return a.status.state === 'live' ? a : b;
    return a;
  }
  function dedupeMatches(list) {
    const byKey = new Map();
    for (const m of list) {
      const key = matchDedupeKey(m);
      byKey.set(key, byKey.has(key) ? pickRicher(byKey.get(key), m) : m);
    }
    return [...byKey.values()];
  }
  function sortMatches(list) {
    return list.slice().sort((a, b) => {
      const la = a.status.state === 'live' ? 0 : 1;
      const lb = b.status.state === 'live' ? 0 : 1;
      if (la !== lb) return la - lb;
      return (a.ts || 0) - (b.ts || 0);
    });
  }

  // ========== 6. CS2 中文名映射（Provider 展示映射，纯函数） ==========
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
    'RMR': 'RMR Major 预选赛',
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

  // ========== 7. 图片代理（API-Football 图片需要 key） ==========
  function proxyImg(url) {
    if (!url) return '';
    if (String(url).includes('api-sports.io')) return '/api/v1/football/image?url=' + encodeURIComponent(url);
    return url;
  }

  // ========== 8. 队徽缓存（IndexedDB teams 表，避免重复请求） ==========
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
      tx.objectStore('teams').put({ key: key, badge: badge, name: teamName, sport: sport, ts: Date.now() });
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
      if (!m.home.logo) m.home.logo = await getCachedBadge(m.home.id, m.home.name, sport);
      else await setCachedBadge(m.home.id, m.home.name, sport, m.home.logo);
      if (!m.away.logo) m.away.logo = await getCachedBadge(m.away.id, m.away.name, sport);
      else await setCachedBadge(m.away.id, m.away.name, sport, m.away.logo);
    }
    return matches;
  }

  // ========== 9. 常用联赛（足球赛事发现） ==========
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

  // ========== 10. 主队管理 ==========
  // 只显示用户通过搜索弹窗手动添加的队伍（source==='manual'），
  // 过滤旧版本自动 upsert 进 IndexedDB 的几百条记录
  async function getFollowedTeams(sport) {
    const teams = await window.dbGetTeams();
    return teams.filter(t => t.sport === sport && t.source === 'manual');
  }
  async function addFollowedTeam(team, sport) {
    try {
      await window.dbAddTeam({ ...team, sport: sport, source: 'manual' });
    } catch (e) { /* 重复添加（主键冲突）静默处理 */ }
  }
  async function removeFollowedTeam(id) {
    await window.dbDeleteTeam(id);
  }

  // ========== 11. 渲染工具 ==========
  function escapeHtml(str) {
    return String(str || '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }
  function renderBadge(logo, name) {
    if (!logo) return '';
    return `<img src="${logo}" class="sp-badge" alt="" loading="lazy" onerror="this.style.display='none'">`;
  }
  function statusBadge(m) {
    const s = m.status.state;
    if (s === 'live') return '<span class="sp-status sp-live">● 直播</span>';
    if (s === 'finished') return '<span class="sp-status sp-finished">已结束</span>';
    if (s === 'postponed') return '<span class="sp-status sp-postponed">已推迟</span>';
    if (s === 'cancelled') return '<span class="sp-status sp-cancelled">已取消</span>';
    return '<span class="sp-status sp-upcoming">未开赛</span>';
  }
  function scoreHtml(m) {
    if (m.score.home != null && m.score.away != null) {
      return `<span class="sp-score">${m.score.home} - ${m.score.away}</span>`;
    }
    const t = localTime(m.ts);
    const f = m.format ? ' · ' + m.format : '';
    return `<span class="sp-time">${t || '--'}${f}</span>`;
  }
  // 统一 MatchList 卡片：足球/CS2 同一渲染
  function renderMatchCard(m, showCompetition) {
    return `<div class="sp-card${m.status.state === 'live' ? ' sp-card-live' : ''}" onclick="window.InnerOSSports.openMatchDetail('${escapeHtml(m.id)}', '${m.sport}')">
      <div class="sp-card-header">
        <span class="sp-league">${escapeHtml(showCompetition !== false ? (m.competition.name || '') : '')}</span>
        ${statusBadge(m)}
      </div>
      <div class="sp-card-body">
        <div class="sp-team sp-team-home">
          ${renderBadge(m.home.logo, m.home.name)}
          <span class="sp-team-name">${escapeHtml(m.home.name || '')}</span>
        </div>
        <div class="sp-vs">${scoreHtml(m)}</div>
        <div class="sp-team sp-team-away">
          <span class="sp-team-name">${escapeHtml(m.away.name || '')}</span>
          ${renderBadge(m.away.logo, m.away.name)}
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
  function renderTabs(activeTab) {
    return `<div class="sp-tabs">` + DAY_TABS.map(t =>
      `<button class="sp-tab${t.key === activeTab ? ' sp-tab-active' : ''}" data-tab="${t.key}" onclick="window.InnerOSSports.selectTab('${t.key}')">${t.label}</button>`
    ).join('') + `</div>`;
  }
  function renderEmpty(ctx) {
    const tabLabel = (DAY_TABS.find(t => t.key === ctx.tab) || DAY_TABS[0]).label;
    let title, desc;
    if (ctx.scope === 'team') {
      title = `该${ctx.sport === 'cs2' ? '战队' : '球队'}${tabLabel}没有比赛`;
      desc = '试试其他日期，或回首页查看全部赛程';
    } else if (ctx.scope === 'competition') {
      title = `${tabLabel}没有该赛事的比赛`;
      desc = '试试其他日期，或换一个赛事';
    } else {
      title = `${tabLabel}没有比赛`;
      desc = '试试其他日期，或点击上方主队/赛事查看专属赛程';
    }
    const icon = ctx.sport === 'cs2' ? '🎮' : '⚽';
    return `<div class="empty-state"><div class="empty-state-icon">${icon}</div><div class="empty-state-title">${title}</div><div class="empty-state-desc">${desc}</div></div>`;
  }
  function renderError(e) {
    const msg = (e && e.message) || '网络或数据源异常';
    return `<div class="empty-state"><div class="empty-state-icon">⚠️</div><div class="empty-state-title">赛程加载失败</div><div class="empty-state-desc">${escapeHtml(msg)}，请稍后重试</div><div class="empty-state-action"><button class="sp-add-btn" onclick="window.InnerOSSports.retryList()">↻ 重新加载</button></div></div>`;
  }

  // ========== 12. MatchList 加载（统一 loading/empty/error/live） ==========
  function selectTab(tab) {
    view.params.tab = tab;
    document.querySelectorAll('.sp-tab').forEach(b => b.classList.toggle('sp-tab-active', b.dataset.tab === tab));
    const contentEl = document.getElementById('sp-list-content');
    if (contentEl) {
      contentEl.innerHTML = renderSkeleton(6); // 切换时先骨架屏，不闪烁旧数据
      loadList();
    }
  }
  async function loadList() {
    const contentEl = document.getElementById('sp-list-content');
    if (!contentEl) return;
    const ctx = view.params;
    const q = buildQuery(ctx);
    let result;
    try {
      result = await querySchedule(q);
    } catch (e) {
      if (document.getElementById('sp-list-content') === contentEl) contentEl.innerHTML = renderError(e);
      return;
    }
    await enrichBadges(result.matches, ctx.sport);
    if (document.getElementById('sp-list-content') !== contentEl) return; // 页面已切走，丢弃本次渲染
    if (result.matches.length === 0) {
      contentEl.innerHTML = renderEmpty(ctx);
      return;
    }
    let html = '';
    if (result.stale) html += `<div class="sp-notice sp-notice-stale">数据获取失败，以下为最近一次成功数据，可能已过期</div>`;
    if (result.degraded === 'legacy') html += `<div class="sp-notice">当前环境未配置足球数据源（FOOTBALL_API_KEY），以下为旧数据源（TheSportsDB）赛程</div>`;
    else if (result.degraded === 'no-key') html += `<div class="sp-notice">当前环境未配置足球数据源（FOOTBALL_API_KEY），暂无法查询主队/联赛赛程</div>`;
    const groups = groupByLocalDate(result.matches);
    for (const g of groups) {
      html += `<div class="sp-date-group"><div class="sp-date-label">${escapeHtml(g.label)}</div><div class="sp-grid">`;
      for (const m of g.matches) html += renderMatchCard(m, ctx.scope !== 'competition');
      html += `</div></div>`;
    }
    contentEl.innerHTML = html;
  }
  function retryList() {
    rawCache.clear();
    const contentEl = document.getElementById('sp-list-content');
    if (contentEl) contentEl.innerHTML = renderSkeleton(6);
    loadList();
  }

  // ========== 13. 首页（我的主队 + 赛事 + 日期 + MatchList） ==========
  async function renderHome(container) {
    const sport = view.params.sport;
    const isFootball = sport === 'football';
    const followed = await getFollowedTeams(sport);
    let html = `<div class="page-header">
      <div class="page-title">${isFootball ? '⚽ 足球 · Football' : '🎮 CS2 · Counter-Strike 2'}</div>
      <div class="page-subtitle">主队 · 赛事 · 日期 统一赛程中心 · ${isFootball ? 'API-Football' : 'Liquipedia'} 数据源</div>
    </div>`;

    // 我的主队
    html += `<div class="sp-section">
      <div class="sp-section-header">
        <span class="sp-section-title">⭐ 我的主队</span>
        <button class="sp-add-btn" onclick="window.InnerOSSports.openAddTeam('${sport}')">＋ 添加</button>
      </div>
      <div class="sp-teams-row">`;
    if (followed.length === 0) {
      html += `<div class="sp-empty-inline">还没有主队，点击「＋ 添加」搜索你支持的${isFootball ? '球队' : '战队'}</div>`;
    } else {
      for (const t of followed) {
        html += `<div class="sp-team-chip" onclick="window.InnerOSSports.openTeam('${escapeHtml(t.id)}', '${sport}')">
          ${renderBadge(t.badge, t.name)}
          <span class="sp-team-chip-name">${escapeHtml(t.name || '')}</span>
          <button class="sp-team-remove" onclick="event.stopPropagation();window.InnerOSSports.removeTeam('${escapeHtml(t.id)}','${sport}')">×</button>
        </div>`;
      }
    }
    html += `</div></div>`;

    // 赛事
    html += `<div class="sp-section">
      <div class="sp-section-header"><span class="sp-section-title">🏆 赛事</span></div>
      <div id="sp-events">${renderSkeleton(4)}</div>
    </div>`;

    // 日期 + 统一 MatchList
    html += `<div class="sp-section">
      <div class="sp-section-header"><span class="sp-section-title">📅 日期</span></div>
      ${renderTabs(view.params.tab || 'today')}
      <div class="sp-container" id="sp-list-content">${renderSkeleton(6)}</div>
    </div>`;

    container.innerHTML = html;
    loadEvents(sport);
    loadList();
  }

  async function loadEvents(sport) {
    const el = document.getElementById('sp-events');
    if (!el) return;
    if (sport === 'football') {
      el.innerHTML = `<div class="sp-league-grid">` + POPULAR_LEAGUES.map(l => {
        const logo = proxyImg(l.logo);
        return `<div class="sp-league-card" onclick="window.InnerOSSports.openLeague(${l.id}, '${l.name}', '${logo}')">
          <img src="${logo}" class="sp-league-logo" alt="" loading="lazy" onerror="this.style.display='none'">
          <span class="sp-league-name">${l.name}</span>
        </div>`;
      }).join('') + `</div>`;
      return;
    }
    // CS2：从 A 级赛程派生赛事列表（与日期列表共用同一缓存，零额外请求）
    try {
      const r = await fetchRaw(buildCS2Url({ scope: 'all' }));
      const raw = (r.data && r.data.matches) || [];
      const byComp = new Map();
      for (const m of raw) {
        const key = m.league || '其他赛事';
        if (!byComp.has(key)) byComp.set(key, { league: key, count: 0, nextTs: Infinity });
        const c = byComp.get(key);
        c.count++;
        if (m.ts && m.ts < c.nextTs) c.nextTs = m.ts;
      }
      const events = [...byComp.values()].sort((a, b) => a.nextTs - b.nextTs);
      if (!events.length) {
        el.innerHTML = `<div class="sp-empty-inline">暂无 A 级赛事，稍后再来看看</div>`;
        return;
      }
      el.innerHTML = `<div class="sp-league-grid">` + events.map(ev => {
        const nextLabel = ev.nextTs === Infinity ? '时间待定' : mdCN(localDateKey(new Date(ev.nextTs)));
        return `<div class="sp-league-card" onclick="window.InnerOSSports.openCompetition('${escapeHtml(ev.league)}')">
          <span class="sp-event-emoji">🎮</span>
          <span class="sp-league-name">${escapeHtml(cs2TournamentCN(ev.league))}</span>
          <span class="sp-event-meta">${ev.count} 场 · 最近 ${nextLabel}</span>
        </div>`;
      }).join('') + `</div>`;
    } catch (e) {
      el.innerHTML = `<div class="sp-empty-inline">赛事列表加载失败，<a href="javascript:void(0)" onclick="window.InnerOSSports.refresh()">点击重试</a></div>`;
    }
  }

  // ========== 14. 统一 Schedule 页（scope=team / scope=competition 共用） ==========
  async function renderSchedulePage(container) {
    const ctx = view.params;
    const isTeam = ctx.scope === 'team';
    const title = isTeam ? (ctx.team.name || '') : (ctx.competition.name || '');
    const sub = `${ctx.sport === 'football' ? '足球' : 'CS2'} · ${isTeam ? '主队赛程' : '赛事赛程'}`;
    let scopeHtml;
    if (isTeam) {
      scopeHtml = renderBadge(ctx.team.badge, ctx.team.name);
    } else {
      const logo = proxyImg(ctx.competition.logo || '');
      scopeHtml = logo
        ? `<img src="${logo}" class="sp-league-logo" alt="" loading="lazy" onerror="this.style.display='none'">`
        : '<span class="sp-event-emoji">🏆</span>';
    }
    container.innerHTML = `<div class="sp-page-header">
        <button class="sp-back-btn" onclick="window.InnerOSSports.back()">← 返回</button>
        <div class="sp-scope-header">
          ${scopeHtml}
          <div class="sp-scope-info">
            <div class="sp-scope-name">${escapeHtml(title)}</div>
            <div class="sp-scope-sub">${sub}</div>
          </div>
        </div>
      </div>
      ${renderTabs(ctx.tab || 'today')}
      <div class="sp-container" id="sp-list-content">${renderSkeleton(6)}</div>`;
    loadList();
  }

  // ========== 15. 比赛详情页 ==========
  async function renderMatchDetail(container, matchId, sport) {
    container.innerHTML = `<div class="sp-page-header">
        <button class="sp-back-btn" onclick="window.InnerOSSports.back()">← 返回</button>
        <div class="sp-page-title">比赛详情</div>
      </div>
      <div class="sp-container" id="sp-detail-content">${renderSkeleton(3)}</div>`;

    if (sport !== 'football') {
      const contentEl = document.getElementById('sp-detail-content');
      if (contentEl) {
        contentEl.innerHTML = `<div class="empty-state"><div class="empty-state-icon">🎮</div><div class="empty-state-title">CS2 比赛详情</div><div class="empty-state-desc">CS2 详细数据（地图比分、选手数据）需要额外 API 支持，当前 Liquipedia 免费接口无法提供。如需此功能，可考虑订阅 HLTV 或 PandaScore API。</div></div>`;
      }
      return;
    }
    let detail = null;
    try {
      const res = await window.InnerOSApi.get('/api/v1/football/fixture?id=' + encodeURIComponent(matchId));
      detail = res.data;
    } catch (e) { detail = null; }
    const contentEl = document.getElementById('sp-detail-content');
    if (!contentEl) return;
    if (!detail || !detail.fixture) {
      contentEl.innerHTML = `<div class="empty-state"><div class="empty-state-icon">📋</div><div class="empty-state-title">详情加载失败</div><div class="empty-state-desc">该比赛暂无详细数据，请稍后重试</div></div>`;
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
  }

  // ========== 16. 搜索添加主队弹窗 ==========
  async function searchFootballTeams(q) {
    const res = await window.InnerOSApi.get('/api/v1/football/teams?search=' + encodeURIComponent(q));
    return (res.data && res.data.teams) || [];
  }
  async function searchCS2Teams(q) {
    const res = await fetch('/api/sports?type=teamsearch&sport=cs2&q=' + encodeURIComponent(q));
    if (!res.ok) return [];
    const data = await res.json();
    return (data.results || []).map(t => ({
      id: t.id || t.provider_team_id || t.name,
      name: t.name || '',
      logo: t.badge || t.logo || '',
      full: t.full || t.name || '',
    }));
  }
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
        let teams = [];
        try {
          teams = sport === 'football' ? await searchFootballTeams(q) : await searchCS2Teams(q);
        } catch (e) { teams = []; }
        if (!teams.length) {
          results.innerHTML = '<div class="sp-search-empty">未找到相关球队，试试其他关键词</div>';
          return;
        }
        results.innerHTML = teams.map(t => {
          const sub = sport === 'football' ? (t.country || '') : (t.full || '');
          return `<div class="sp-search-result-item" onclick="window.InnerOSSports.confirmAddTeam('${escapeHtml(String(t.id))}', '${escapeHtml(t.name)}', '${escapeHtml(proxyImg(t.logo || ''))}', '${sport}', '${escapeHtml(t.full || '')}')">
            ${renderBadge(proxyImg(t.logo || ''), t.name)}
            <span class="sp-search-result-name">${escapeHtml(t.name)}</span>
            <span class="sp-search-result-sub">${escapeHtml(sub)}</span>
            <span class="sp-search-result-add">＋ 添加</span>
          </div>`;
        }).join('');
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
  async function confirmAddTeam(id, name, logo, sport, full) {
    await addFollowedTeam(
      { id: String(id), name: name, full: full || name, badge: logo || '', provider: sport === 'football' ? 'api-football' : 'liquipedia' },
      sport
    );
    closeAddTeamModal();
    render();
  }

  // ========== 17. 导航入口 ==========
  async function openTeam(id, sport) {
    const teams = await getFollowedTeams(sport);
    const t = teams.find(x => String(x.id) === String(id)) || { id: String(id), name: String(id) };
    navigateTo('schedule', { sport: sport, scope: 'team', team: t, tab: 'today' });
  }
  function openLeague(leagueId, leagueName, leagueLogo) {
    navigateTo('schedule', {
      sport: 'football', scope: 'competition',
      competition: { id: String(leagueId), name: leagueName, logo: leagueLogo },
      tab: 'today',
    });
  }
  function openCompetition(rawLeagueName) {
    navigateTo('schedule', {
      sport: 'cs2', scope: 'competition',
      competition: { id: rawLeagueName, name: cs2TournamentCN(rawLeagueName) },
      tab: 'today',
    });
  }

  // ========== 18. 主渲染入口 ==========
  async function render() {
    const container = document.getElementById('content');
    if (!container) return;
    switch (view.page) {
      case 'home':
        await renderHome(container);
        break;
      case 'schedule':
        await renderSchedulePage(container);
        break;
      case 'match_detail':
        await renderMatchDetail(container, view.params.matchId, view.params.sport);
        break;
      default:
        await renderHome(container);
    }
  }

  // ========== 19. 对外 API ==========
  window.InnerOSSports = Object.freeze({
    renderFootball: (container) => { historyStack = []; view = { page: 'home', params: { sport: 'football', scope: 'all', tab: 'today' } }; render(); },
    renderCS2: (container) => { historyStack = []; view = { page: 'home', params: { sport: 'cs2', scope: 'all', tab: 'today' } }; render(); },
    openTeam: openTeam,
    openLeague: openLeague,
    openCompetition: openCompetition,
    openMatchDetail: (matchId, sport) => navigateTo('match_detail', { matchId: matchId, sport: sport }),
    openAddTeam: (sport) => openAddTeamModal(sport),
    closeAddTeamModal: closeAddTeamModal,
    confirmAddTeam: confirmAddTeam,
    removeTeam: async (id, sport) => { await removeFollowedTeam(id); render(); },
    selectTab: selectTab,
    retryList: retryList,
    back: goBack,
    refresh: render,
    // 纯逻辑导出（node vm 单测用，无 DOM 依赖）
    Core: Object.freeze({
      normalizeMatch: normalizeMatch,
      mapState: mapState,
      STATUS_LABEL: STATUS_LABEL,
      localDateKey: localDateKey,
      dateKeyOffset: dateKeyOffset,
      todayKey: todayKey,
      buildDayRange: buildDayRange,
      inDateRange: inDateRange,
      dateLabel: dateLabel,
      groupByLocalDate: groupByLocalDate,
      localTime: localTime,
      buildQuery: buildQuery,
      buildFootballUrls: buildFootballUrls,
      buildCS2Url: buildCS2Url,
      querySchedule: querySchedule,
      dedupeMatches: dedupeMatches,
      sortMatches: sortMatches,
      matchDedupeKey: matchDedupeKey,
      normKey: normKey,
      teamIdentityKeys: teamIdentityKeys,
      filterCS2ByTeam: filterCS2ByTeam,
      competitionKey: competitionKey,
      DAY_TABS: DAY_TABS,
      POPULAR_LEAGUES: POPULAR_LEAGUES,
      TTL: TTL,
      clearCache: clearCache,
    }),
  });
})();
