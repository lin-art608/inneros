// API-Football 共享客户端（ARCH-015 / V1.19.0）
// 代理 v3.football.api-sports.io，key 从环境变量 FOOTBALL_API_KEY 读取；
// 未配置 key 时返回空数组（前端回退 TheSportsDB 旧接口）。
// 所有响应经 CF 边缘缓存（fixtures 60s，leagues/standings 1h），降低免费档限流压力。

const BASE = 'https://v3.football.api-sports.io';

// V1.20.2：记录最近一次上游状态码，供路由写进错误 message（用户可在 UI 直接看到
// 是 401（key 无效）/403（被封禁）/429（限流）——排查不用猜）
let _lastStatus = 0;
export function lastFootballStatus() { return _lastStatus; }
export function footballStatusHint() {
  const s = _lastStatus;
  if (s === 401) return `HTTP 401：FOOTBALL_API_KEY 无效或已重置，请到 Cloudflare Pages → Settings → Variables 核对`;
  if (s === 403) return `HTTP 403：key 被封禁或订阅过期（dashboard.api-football.com 查看）`;
  if (s === 429) return `HTTP 429：免费档 100 次/天已用尽（UTC 0 点重置），明天自动恢复`;
  if (s > 0) return `HTTP ${s}`;
  return '';
}

export function hasKey(env) {
  return !!(env && env.FOOTBALL_API_KEY && env.FOOTBALL_API_KEY.length > 5);
}

export async function fetchFootball(path, env, cacheTtl = 300) {
  if (!hasKey(env)) return null;
  const url = BASE + path;
  const res = await fetch(url, {
    headers: {
      'x-apisports-key': env.FOOTBALL_API_KEY,
      'Accept': 'application/json',
    },
    cf: { cacheEverything: true, cacheTtl },
  });
  if (!res.ok) {
    _lastStatus = res.status;
    console.error('[football] API', res.status, path);
    return null;
  }
  _lastStatus = 0;
  return res.json();
}

// API-Football 比赛 → 统一模型（与 app.js 既有模型同构）
export function normalizeFixture(f) {
  const home = f.teams?.home || {};
  const away = f.teams?.away || {};
  const goals = f.goals || {};
  const fixture = f.fixture || {};
  const league = f.league || {};
  const hasScore = goals.home != null && goals.away != null;
  const statusShort = fixture.status?.short || '';
  const isLive = ['1H', 'HT', '2H', 'ET', 'P', 'BT', 'LIVE'].includes(statusShort);
  const isFinished = ['FT', 'AET', 'PEN', 'MT', 'AWD', 'WO'].includes(statusShort);
  // V2 统一状态：推迟 / 取消（前端 mapState 映射为 postponed/cancelled）
  const isPostponed = ['PST', 'SUSP', 'INT'].includes(statusShort);
  const isCancelled = ['CANC', 'ABD'].includes(statusShort);
  const showScore = hasScore && !isPostponed && !isCancelled;
  const ts = fixture.date ? new Date(fixture.date).getTime() : null;
  const d = fixture.date ? fixture.date.slice(0, 10) : '';
  const t = fixture.date ? fixture.date.slice(11, 16) : '';
  return {
    sport: 'football',
    id: String(fixture.id || ''),
    home_id: String(home.id || ''),
    home_name: home.name || '',
    home_badge: home.logo || '',
    away_id: String(away.id || ''),
    away_name: away.name || '',
    away_badge: away.logo || '',
    ts,
    date: d,
    time: t,
    league: league.name || '',
    league_id: String(league.id || ''),
    league_logo: league.logo || '',
    round: f.league?.round || '',
    status: isLive ? 'live' : (isFinished ? 'finished' : (isPostponed ? 'postponed' : (isCancelled ? 'cancelled' : 'upcoming'))),
    status_text: fixture.status?.long || '',
    home_score: showScore ? goals.home : null,
    away_score: showScore ? goals.away : null,
    importance: 3,
    tournament_weight: 3,
    venue: fixture.venue?.name || '',
    referee: fixture.referee || '',
  };
}

// 常用联赛 ID（API-Football）→ 中文名
export const POPULAR_LEAGUES = [
  { id: 39, name: '英超', country: 'England', logo: 'https://media-1.api-sports.io/football/leagues/39.png' },
  { id: 140, name: '西甲', country: 'Spain', logo: 'https://media-1.api-sports.io/football/leagues/140.png' },
  { id: 78, name: '德甲', country: 'Germany', logo: 'https://media-1.api-sports.io/football/leagues/78.png' },
  { id: 135, name: '意甲', country: 'Italy', logo: 'https://media-1.api-sports.io/football/leagues/135.png' },
  { id: 61, name: '法甲', country: 'France', logo: 'https://media-1.api-sports.io/football/leagues/61.png' },
  { id: 2, name: '欧冠', country: 'Europe', logo: 'https://media-1.api-sports.io/football/leagues/2.png' },
  { id: 3, name: '欧联杯', country: 'Europe', logo: 'https://media-1.api-sports.io/football/leagues/3.png' },
  { id: 197, name: '中超', country: 'China', logo: 'https://media-1.api-sports.io/football/leagues/197.png' },
];
