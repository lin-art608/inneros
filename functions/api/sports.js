// TheSportsDB 体育数据代理（真实数据，免 API Key，符合 V1.2 §12）
// 提供：
//   1) type=teamsearch&q=&sport=football|cs2 —— 全球球队/战队搜索（含真实队标 badge），
//      解决 V1.2 §6.1"球队注册表硬编码、搜不到列表外球队"的根因。
//   2) type=matches&leagues=4328,4335,... —— 真实足球赛程（英超/西甲/德甲/意甲/法甲/欧冠），
//      替代此前 nextDate() 生成的假赛程（V1.2 §6.1 禁止项）。
// 注意：TheSportsDB 无 CS2 赛事数据（仅 LoL/RL），CS2 真实赛程仍为已知阻塞项（需 Key 源）。
// 边缘缓存 10 分钟，降低对免费接口的请求压力。

const TSB_KEY = '3'; // TheSportsDB 免费 Key（公开测试用）
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

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

// 球队搜索（football→Soccer / cs2→ESports）
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
  }));
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
    away_id: ev.idAwayTeam || String(ev.idEvent) + '_a',
    away_name: ev.strAwayTeam || '',
    ts,
    date: ev.dateEvent || '',
    time: (ev.strTime || '').slice(0, 5),
    league: lm ? lm.name : (ev.strLeague || ''),
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
  all.sort((a, b) => String(a.ts || '').localeCompare(String(b.ts || '')));
  return all.slice(0, 80);
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

export async function onRequestGet(context) {
  const url = new URL(context.request.url);
  const type = url.searchParams.get('type') || '';
  const q = (url.searchParams.get('q') || '').trim();

  try {
    if (type === 'teamsearch') {
      if (!q) return jsonResponse({ results: [] }, 400);
      const sport = url.searchParams.get('sport') || 'football';
      const results = await teamSearch(q, sport);
      return jsonResponse({ results });
    }
    if (type === 'matches') {
      const leagues = url.searchParams.get('leagues') || '4328,4335,4331,4332,4334,4480';
      const matches = await leagueMatches(leagues);
      return jsonResponse({ matches });
    }
    return jsonResponse({ error: 'unknown type' }, 400);
  } catch (e) {
    return jsonResponse({ results: [], matches: [] }, 502);
  }
}
