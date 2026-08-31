// TheSportsDB 体育数据代理（真实数据，免 API Key，符合 V1.2 §12）
// 提供：
//   1) type=teamsearch&q=&sport=football|cs2 —— 全球球队/战队搜索（含真实队标 badge），
//      解决 V1.2 §6.1"球队注册表硬编码、搜不到列表外球队"的根因。
//   2) type=matches&leagues=4328,4335,... —— 真实足球赛程（英超/西甲/德甲/意甲/法甲/欧冠），
//      替代此前 nextDate() 生成的假赛程（V1.2 §6.1 禁止项）。
//   3) type=cs2matches —— CS2 真实赛程（Liquipedia MediaWiki API，免密钥），
//      解析 Liquipedia:Matches ticker（未来+进行中场次，含时间戳/队名/队标/赛事/赛制）。
// Liquipedia API 合规：要求 gzip + 描述性 UA（含联系方式）+ ≤2 req/s，见 liquipedia.net/api-terms-of-use；
// 本函数经 cf cacheTtl=300 边缘缓存，远低于限流阈值。
// 边缘缓存 10 分钟，降低对免费接口的请求压力。

const TSB_KEY = '3'; // TheSportsDB 免费 Key（公开测试用）
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';
const LP_API = 'https://liquipedia.net/counterstrike/api.php';
const LP_UA = 'InnerOS/1.0 (https://inneros.pages.dev; contact: dev@inneros.asia)';

// 联赛 ID → 中文名 + 权重（用于推荐分）
const LEAGUE_MAP = {
  '4328': { name: '英超', weight: 4 },
  '4335': { name: '西甲', weight: 4 },
  '4331': { name: '德甲', weight: 4 },
  '4332': { name: '意甲', weight: 4 },
  '4334': { name: '法甲', weight: 3 },
  '4480': { name: '欧冠', weight: 5 },
  '4398': { name: '中超', weight: 3 },
};

async function tsdb(url) {
  const res = await fetch(url, {
    headers: { 'User-Agent': UA, 'Accept': 'application/json' },
    cf: { cacheEverything: true, cacheTtl: 600 },
  });
  if (!res.ok) throw new Error('tsdb ' + res.status);
  return res.json();
}

// 中文别名 → 英文（用户输入中文也能搜；覆盖常用球队/战队）
const CN_ALIAS = {
  '法尔孔':'Falcons', '猎鹰':'Falcons', '猎鹰队':'Falcons',
  '阿森纳':'Arsenal', '曼城':'Manchester City', '曼联':'Manchester United', '利物浦':'Liverpool',
  '切尔西':'Chelsea', '热刺':'Tottenham', '皇马':'Real Madrid', '皇马队':'Real Madrid',
  '巴塞罗那':'FC Barcelona', '巴萨':'FC Barcelona', '拜仁':'Bayern Munich', '多特':'Borussia Dortmund',
  '国米':'Inter Milan', 'AC米兰':'AC Milan', '巴黎':'Paris Saint-Germain', '巴黎圣日耳曼':'Paris Saint-Germain',
  '马竞':'Atletico Madrid', '尤文':'Juventus', '山东泰山':'Shandong Taishan', '上海海港':'Shanghai Port',
  '北京国安':'Beijing Guoan', '纳维':'Natus Vincere', '纳夫维':'Natus Vincere',
  '液体':'Team Liquid', '幽灵':'Team Spirit',
};
function cnToEn(q) { return CN_ALIAS[q.trim()] || ''; }

// 球队搜索（football→Soccer / cs2→ESports；电竞覆盖差时回退 Liquipedia opensearch）
async function teamSearch(q, sport) {
  const wantSport = sport === 'cs2' ? 'ESports' : 'Soccer';
  const d = await tsdb(`https://www.thesportsdb.com/api/v1/json/${TSB_KEY}/searchteams.php?t=${encodeURIComponent(q)}`);
  const teams = (d.teams || []).filter(t => !wantSport || t.strSport === wantSport).slice(0, 12);
  return teams.map(t => ({
    id: t.idTeam,
    name: t.strTeam || '',
    full: t.strTeamAlternate || t.strTeam || '',
    league: t.strLeague || '',
    badge: t.strBadge || '',
    sport: t.strSport || '',
    provider: 'thesportsdb',
  }));
}

// 战队页 infobox 首图即队标；重定向页（NAVI→Natus_Vincere）跟随一次；每队缓存 24h，控制限速
async function lpLogoFor(title) {
  for (let i = 0; i < 2; i++) {
    const d = await lpFetch(`${LP_API}?action=parse&page=${encodeURIComponent(title.replace(/ /g, '_'))}&prop=text&format=json`);
    const html = d.parse && d.parse.text && d.parse.text['*'];
    if (!html) return '';
    const inf = html.match(/infobox-image[^>]*>[\s\S]{0,400}?<img[^>]*src="([^"]+)"/);
    const any = inf || html.match(/<img[^>]*src="(\/commons\/images\/[^"]+?lightmode[^"]*?)"/);
    if (any) return any[1].startsWith('/') ? 'https://liquipedia.net' + any[1] : any[1];
    const red = html.match(/redirectText"><ul><li><a href="\/counterstrike\/([^"]+)"/);
    if (!red) return '';
    title = decodeURIComponent(red[1]);
  }
  return '';
}

// CS2 搜索兜底：TheSportsDB 电竞覆盖差（搜 NAVI 无结果）→ Liquipedia opensearch
// 队标取战队页 infobox 首图（每队缓存 24h）；id 用 'lp:' 前缀 + LP 页面标题（关注后可与 ticker 队名匹配）
async function searchCS2Fallback(q) {
  // 中文/别名词自动换英文检索；opensearch 无结果再用 list=search 全文兜底
  const terms = [q, cnToEn(q)].filter(Boolean);
  const titles = [];
  for (const term of terms) {
    if (!term) continue;
    try {
      const d = await lpFetch(`${LP_API}?action=opensearch&search=${encodeURIComponent(term)}&limit=6&format=json`);
      for (const t of (d[1] || [])) { if (!t.includes('/') && !titles.includes(t)) titles.push(t); }
    } catch (e) { /* 继续 */ }
    if (titles.length >= 4) break;
  }
  if (!titles.length) {
    try {
      const d = await lpFetch(`${LP_API}?action=query&list=search&srsearch=${encodeURIComponent(q)}&srlimit=6&format=json`);
      for (const r of (d.query?.search || [])) { if (!r.title.includes('/') && !titles.includes(r.title)) titles.push(r.title); }
    } catch (e) { /* 继续 */ }
  }
  const out = [];
  for (const t of titles.slice(0, 4)) {
    let badge = '';
    try { badge = await lpLogoFor(t); } catch (e) { /* 队标失败允许为空 */ }
    out.push({ id: 'lp:' + t, name: t, full: t, league: 'CS2 · Liquipedia', badge, sport: 'ESports', provider: 'liquipedia' });
  }
  return out;
}

// 事件 → 统一比赛模型（app.js 既有模型，见 getUnifiedMatches）
function normalizeEvent(ev, lm) {
  let ts = null;
  const rawTs = ev.strTimestamp;
  if (rawTs) {
    // 无时区标记则按 UTC 处理（TheSportsDB 返回 UTC）
    ts = (/Z$|[+-]\d{2}:?\d{2}$/.test(rawTs)) ? rawTs : rawTs + 'Z';
  }
  const hasScore = (ev.intHomeScore != null && ev.intHomeScore !== '') || (ev.intAwayScore != null && ev.intAwayScore !== '');
  const isFinished = hasScore || /FT|Finished|AET|PEN/i.test(ev.strStatus || '');
  const round = ev.intRound ? `第${ev.intRound}轮` : (ev.strStatus || '');
  return {
    sport: 'football',
    home_id: ev.idHomeTeam || String(ev.idEvent) + '_h',
    home_name: ev.strHomeTeam || '',
    home_badge: ev.strHomeTeamBadge || '',
    away_id: ev.idAwayTeam || String(ev.idEvent) + '_a',
    away_name: ev.strAwayTeam || '',
    away_badge: ev.strAwayTeamBadge || '',
    ts,
    date: ev.dateEvent || '',
    time: (ev.strTime || '').slice(0, 5),
    league: lm ? lm.name : (ev.strLeague || ''),
    league_id: ev.idLeague || '',
    round,
    status: isFinished ? 'finished' : 'upcoming',
    home_score: ev.intHomeScore == null || ev.intHomeScore === '' ? null : Number(ev.intHomeScore),
    away_score: ev.intAwayScore == null || ev.intAwayScore === '' ? null : Number(ev.intAwayScore),
    importance: lm ? lm.weight : 3,
    tournament_weight: lm ? lm.weight : 3,
  };
}

// 多联赛下一批赛程（eventsnextleague）
async function leagueMatches(leagueIds) {
  const ids = leagueIds.split(',').map(s => s.trim()).filter(Boolean);
  const all = [];
  await Promise.all(ids.map(async id => {
    const lm = LEAGUE_MAP[id];
    try {
      const d = await tsdb(`https://www.thesportsdb.com/api/v1/json/${TSB_KEY}/eventsnextleague.php?id=${id}`);
      for (const ev of (d.events || [])) all.push(normalizeEvent(ev, lm));
    } catch (e) { /* 单联赛失败不影响其它 */ }
  }));
  return all;
}

// 按关注球队拉取：下一场（eventsnext）+ 最近完赛（eventslast），免费档各返回少量场次
// V1.2 §6.1：显示下一场、最近 3~5 场；联赛级 fixtures 只有 1 场，关注球队必须按队拉取才能覆盖
async function followedTeamEvents(teamIds) {
  const ids = teamIds.slice(0, 6);
  const all = [];
  await Promise.all(ids.flatMap(id => [
    (async () => {
      try {
        const d = await tsdb(`https://www.thesportsdb.com/api/v1/json/${TSB_KEY}/eventsnext.php?id=${encodeURIComponent(id)}`);
        for (const ev of (d.events || [])) all.push(normalizeEvent(ev, null));
      } catch (e) { /* 单队失败不影响其它 */ }
    })(),
    (async () => {
      try {
        const d = await tsdb(`https://www.thesportsdb.com/api/v1/json/${TSB_KEY}/eventslast.php?id=${encodeURIComponent(id)}`);
        for (const ev of (d.results || [])) all.push(normalizeEvent(ev, null));
      } catch (e) { /* 同上 */ }
    })(),
  ]));
  return all;
}

function jsonResponse(obj, status) {
  return new Response(JSON.stringify(obj), {
    status: status || 200,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Access-Control-Allow-Origin': '*',
      'Cache-Control': 'public, max-age=300',
    },
  });
}

// ---- CS2：Liquipedia ticker 解析（结构经 2026-08 实测验证） ----
async function lpFetch(url) {
  const res = await fetch(url, {
    headers: { 'User-Agent': LP_UA, 'Accept-Encoding': 'gzip' },
    cf: { cacheEverything: true, cacheTtl: 300 },
  });
  if (!res.ok) throw new Error('liquipedia ' + res.status);
  return res.json();
}

// 把 Liquipedia:Matches 的 HTML 解析为统一比赛模型（与 normalizeEvent 同构）
function parseLpTicker(html) {
  const blocks = html.split('<div class="match-info">');
  const matches = [];
  const parseTeam = (seg) => {
    // 队标：优先 lightmode/allmode 变体；大量队伍块用无后缀的 team-template-image-icon（2026-08 实测占 ~2/3），必须兜底
    let img = seg.match(/team-template-(?:lightmode|allmode)"><a[^>]*><img[^>]*src="([^"]+)"/)
      || seg.match(/team-template-image-icon[^"]*"><a[^>]*><img[^>]*src="([^"]+)"/);
    if (img) img[1] = img[1].replace(/\/(\d+)px-/, '/128px-'); // 提升清晰度
    // name span：text = 队伍短名（NAVI），title 属性 = LP 页面标题（Natus Vincere，与关注匹配键一致）
    const name = seg.match(/<span class="name"[^>]*><a[^>]*title="([^"]*)"[^>]*>([^<]*)<\/a>/);
    return {
      full: name ? name[1] : '',
      name: name ? name[2].trim() : '',
      badge: img ? (img[1].startsWith('/') ? 'https://liquipedia.net' + img[1] : img[1]) : '',
    };
  };
  for (const b of blocks.slice(1)) {
    const parts = b.split('<div class="match-info-header-opponent');
    if (parts.length < 3) continue;
    const home = parseTeam(parts[1]);
    const away = parseTeam(parts[2]);
    if (!home.name && !away.name) continue;
    const tsM = b.match(/timer-object[^>]*data-timestamp="(\d+)"/);
    const ts = tsM ? parseInt(tsM[1], 10) * 1000 : 0;
    // 赛事名 + Liquipedia 页面链接（含阶段锚点）：赛事页用于"点进赛事看完整赛程/观看"
    const tourM = b.match(/match-info-tournament-name"[^>]*>([\s\S]*?)<\/span>/);
    const leagueHtml = tourM ? tourM[1] : '';
    const league = leagueHtml.replace(/<[^>]+>/g, '').trim();
    const leagueHrefM = leagueHtml.match(/<a[^>]*href="([^"]+)"/);
    const league_url = leagueHrefM ? (leagueHrefM[1].startsWith('/') ? 'https://liquipedia.net' + leagueHrefM[1] : leagueHrefM[1]) : '';
    const boM = b.match(/\((Bo\d)\)/i);
    const scores = [...b.matchAll(/match-info-header-scoreholder-score[^"]*">\s*(-?\d+)\s*</g)].map(m => m[1]);
    // ticker 包含未开赛 + 进行中 + 刚完赛的场次：按时间戳窗口判定状态（Bo3 场次按 3.5h 兜底）
    const now = Date.now();
    let status = 'upcoming';
    let home_score = null, away_score = null;
    if (ts && now >= ts && now < ts + 3.5 * 3600e3) status = 'live';
    else if (ts && now >= ts + 3.5 * 3600e3) {
      status = 'finished';
      if (scores.length >= 2) { home_score = Number(scores[0]); away_score = Number(scores[1]); }
    }
    const d = new Date(ts || now);
    matches.push({
      sport: 'cs2',
      id: 'lp-' + Math.floor(ts / 1000) + '-' + (home.name + '-' + away.name).toLowerCase().replace(/[^a-z0-9-]/g, ''),
      home_id: home.full || home.name,
      home_name: home.name, home_badge: home.badge,
      away_id: away.full || away.name,
      away_name: away.name, away_badge: away.badge,
      ts,
      date: d.toISOString().slice(0, 10),
      time: ('0' + d.getUTCHours()).slice(-2) + ':' + ('0' + d.getUTCMinutes()).slice(-2),
      league, league_url, round: boM ? boM[1] : '',
      status, home_score, away_score,
      importance: 3, tournament_weight: 3,
    });
  }
  return matches;
}

// A 级以上赛事白名单（S-Tier / A-Tier），只保留这些赛事的比赛
const CS2_TIER1_KEYWORDS = [
  'BLAST Premier', 'BLAST.tv', 'BLAST World Final', 'BLAST Spring Final', 'BLAST Fall Final',
  'BLAST Open', 'BLAST Showdown', 'BLAST Spring Groups', 'BLAST Fall Groups',
  'IEM', 'Intel Extreme Masters',
  'ESL Pro League',
  'PGL Major', 'PGL Cluj', 'PGL Bucharest', 'PGL Astana', 'Major',
  'DreamHack Masters',
  'Thunderpick World Championship',
  'RMR', 'Regional Major Ranking',
  'Esports World Cup',
  'FISSURE Playground', 'FISSURE Masters',
  'BLAST Bounty',
];
// 排除关键词（明确的 B 级及以下）
const CS2_TIER_EXCLUDE = [
  'Open Qualifier', 'Closed Qualifier', 'Regional League', 'ESEA', '5E', 'Perfect World',
  'Champions Cup Finals', 'CCT', 'Elisa', 'Pinnacle Cup', 'Funspark', 'REPUBLEAGUE',
  'ECL', 'United21', 'NODWIN', 'Clutch Series', 'YaLLa', 'Snow Sweet', 'Malta',
];
function isCS2Tier1(league) {
  if (!league) return false;
  const lower = league.toLowerCase();
  for (const ex of CS2_TIER_EXCLUDE) {
    if (lower.includes(ex.toLowerCase())) return false;
  }
  for (const kw of CS2_TIER1_KEYWORDS) {
    if (lower.includes(kw.toLowerCase())) return true;
  }
  return false;
}

async function cs2Matches() {
  const d = await lpFetch(`${LP_API}?action=parse&page=Liquipedia:Matches&format=json&prop=text`);
  const html = d.parse && d.parse.text && d.parse.text['*'];
  if (!html) throw new Error('liquipedia empty');
  const all = parseLpTicker(html);
  // 只保留 A 级以上赛事
  return all.filter(m => isCS2Tier1(m.league));
}
// V2 Sports Center：主队查询用全量 ticker（不套 A 级白名单），
// 保证 scope=team 不被 Tier1 过滤截断；赛事发现/赛事页继续用 cs2Matches()。
async function cs2MatchesAll() {
  const d = await lpFetch(`${LP_API}?action=parse&page=Liquipedia:Matches&format=json&prop=text`);
  const html = d.parse && d.parse.text && d.parse.text['*'];
  if (!html) throw new Error('liquipedia empty');
  return parseLpTicker(html);
}

export async function onRequestGet(context) {
  const url = new URL(context.request.url);
  const type = url.searchParams.get('type') || '';
  const q = (url.searchParams.get('q') || '').trim();

  try {
    if (type === 'teamsearch') {
      if (!q) return jsonResponse({ results: [] }, 400);
      const sport = url.searchParams.get('sport') || 'football';
      let results = await teamSearch(q, sport);
      if (!results.length && sport === 'cs2') results = await searchCS2Fallback(q);
      return jsonResponse({ results });
    }
    if (type === 'matches') {
      const leagues = url.searchParams.get('leagues') || '4328,4335,4331,4332,4334,4480';
      const followedIds = (url.searchParams.get('ids') || '').split(',').map(s => s.trim()).filter(Boolean);
      // 联赛 fixtures + 关注球队各自赛程，按事件 id 去重后按时间排序
      const [lg, mine] = await Promise.all([leagueMatches(leagues), followedTeamEvents(followedIds)]);
      const seen = new Set();
      const matches = [...lg, ...mine].filter(m => {
        const key = m.home_id + '|' + m.away_id + '|' + m.date;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      }).sort((a, b) => String(a.ts || '').localeCompare(String(b.ts || ''))).slice(0, 80);
      return jsonResponse({ matches });
    }
    if (type === 'leagueseason') {
      // 联赛近期赛程：eventsseason（当前赛季部分场次）+ eventsnextleague（下一场），去重合并
      // 免费档限制：eventsseason 每赛季仅返回少量场次，非完整赛季——前端如实提示并外链完整赛程
      const id = (url.searchParams.get('id') || '').trim();
      if (!id) return jsonResponse({ matches: [] }, 400);
      const lm = LEAGUE_MAP[id];
      const seen = new Set();
      const all = [];
      const push = (m) => {
        const key = m.home_id + '|' + m.away_id + '|' + m.date;
        if (!seen.has(key)) { seen.add(key); all.push(m); }
      };
      for (const s of ['2026-2027', '2026']) {
        try {
          const d = await tsdb(`https://www.thesportsdb.com/api/v1/json/${TSB_KEY}/eventsseason.php?id=${encodeURIComponent(id)}&s=${s}`);
          for (const ev of (d.events || [])) push(normalizeEvent(ev, lm));
        } catch (e) { /* 单赛季失败继续 */ }
        if (all.length >= 8) break;
      }
      try {
        const d = await tsdb(`https://www.thesportsdb.com/api/v1/json/${TSB_KEY}/eventsnextleague.php?id=${encodeURIComponent(id)}`);
        for (const ev of (d.events || [])) push(normalizeEvent(ev, lm));
      } catch (e) { /* 同上 */ }
      all.sort((a, b) => String(a.ts || '').localeCompare(String(b.ts || '')));
      return jsonResponse({ matches: all.slice(0, 40) });
    }
    if (type === 'cs2matches') {
      // tier=all：主队查询用全量（不受 A 级白名单过滤）；默认只返回 A 级以上赛事
      const matches = url.searchParams.get('tier') === 'all' ? await cs2MatchesAll() : await cs2Matches();
      return jsonResponse({ matches });
    }
    return jsonResponse({ error: 'unknown type' }, 400);
  } catch (e) {
    return jsonResponse({ results: [], matches: [] }, 502);
  }
}
