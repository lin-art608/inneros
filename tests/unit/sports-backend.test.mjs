// V1.20.0 Sports Center V2 后端单测（ARCH-016）
// 覆盖：
//   1. football-client.normalizeFixture —— 状态扩展（live/finished/postponed/cancelled）+ league_logo
//   2. /api/v1/football/fixtures 路由 —— URL 构造（team 单队 / league+next）+ 热门联赛过滤豁免（team/league 场景不过滤）
//   3. /api/sports?type=cs2matches —— 默认 A 级白名单过滤；tier=all 全量返回（主队查询不被 Tier1 截断）
// 运行：node tests/unit/sports-backend.test.mjs（零依赖，mock 全局 fetch）
import assert from 'node:assert/strict';
import { normalizeFixture } from '../../functions/_services/football-client.js';
import { onRequestGet as fixturesGet } from '../../functions/api/v1/football/fixtures.js';
import { onRequestGet as sportsGet } from '../../functions/api/sports.js';

// API-Football 原始 fixture → 统一模型
function apiFixture(short, { leagueId = 39, goalsHome = 1, goalsAway = 2 } = {}) {
  return {
    fixture: {
      id: 1035048,
      date: '2026-08-31T19:30:00+00:00',
      status: { short, long: 'Status ' + short },
      venue: { name: 'Etihad Stadium' },
      referee: 'M. Oliver',
    },
    teams: {
      home: { id: 50, name: 'Manchester City', logo: 'https://media-1.api-sports.io/football/teams/50.png' },
      away: { id: 42, name: 'Arsenal', logo: 'https://media-1.api-sports.io/football/teams/42.png' },
    },
    goals: { home: goalsHome, away: goalsAway },
    league: {
      id: leagueId,
      name: leagueId === 39 ? 'Premier League' : 'Some Minor League',
      logo: `https://media-1.api-sports.io/football/leagues/${leagueId}.png`,
      round: 'Regular Season - 5',
    },
  };
}

// ---------- 1. normalizeFixture：状态映射 ----------
{
  const cases = [
    ['1H', 'live'], ['HT', 'live'], ['2H', 'live'], ['LIVE', 'live'],
    ['FT', 'finished'], ['AET', 'finished'], ['PEN', 'finished'],
    ['PST', 'postponed'], ['SUSP', 'postponed'], ['INT', 'postponed'],
    ['CANC', 'cancelled'], ['ABD', 'cancelled'],
    ['NS', 'upcoming'], ['', 'upcoming'],
  ];
  for (const [short, want] of cases) {
    assert.equal(normalizeFixture(apiFixture(short)).status, want, `statusShort=${short || '(空)'} 应映射为 ${want}`);
  }
}

// ---------- 2. normalizeFixture：league_logo 透传 + 推迟场次分数置空 ----------
{
  const m = normalizeFixture(apiFixture('PST', { goalsHome: 3, goalsAway: 1 }));
  assert.equal(m.league_logo, 'https://media-1.api-sports.io/football/leagues/39.png', '联赛 logo 必须透传');
  assert.equal(m.home_score, null, '已推迟场次不展示比分');
  assert.equal(m.away_score, null);
  assert.equal(m.status_text, 'Status PST');
  assert.equal(m.venue, 'Etihad Stadium');
  assert.equal(m.referee, 'M. Oliver');
  assert.equal(m.home_id, '50');
  assert.equal(m.ts, new Date('2026-08-31T19:30:00+00:00').getTime());
}

// ---------- fixtures 路由：mock fetch + 信封解析 ----------
const realFetch = globalThis.fetch;
let fetchLog = [];
let fetchImpl = null;
globalThis.fetch = (url, init) => {
  const u = String(url);
  fetchLog.push(u);
  return fetchImpl(u);
};
function apiFootballRes(fixtures) {
  return { ok: true, json: async () => ({ response: fixtures }) };
}
async function callFixtures(query, env = { FOOTBALL_API_KEY: 'test-key-123456' }) {
  const req = new Request('http://localhost/api/v1/football/fixtures' + query);
  const res = await fixturesGet({ request: req, env });
  return res.json();
}
function resetFetch(impl) { fetchLog = []; fetchImpl = impl; }

// ---------- 3. 未配置 FOOTBALL_API_KEY → fallback:true（前端回退旧数据源） ----------
{
  resetFetch(() => { throw new Error('不应发起请求'); });
  const body = await callFixtures('?date=2026-08-31', {});
  assert.equal(body.success, true);
  assert.equal(body.data.fallback, true);
  assert.deepEqual(body.data.matches, []);
  assert.equal(fetchLog.length, 0);
}

// ---------- 4. team 查询：last=5 + next=10 并行，合并不受热门联赛过滤 ----------
{
  resetFetch((u) => {
    if (u.includes('last=5')) return apiFootballRes([apiFixture('FT', { leagueId: 999 })]);
    if (u.includes('next=10')) return apiFootballRes([apiFixture('NS', { leagueId: 999 })]);
    throw new Error('意外 URL: ' + u);
  });
  const body = await callFixtures('?team=50');
  assert.ok(fetchLog.some(u => u.includes('team=50&last=5')), '单队查询必须走 last 接口');
  assert.ok(fetchLog.some(u => u.includes('team=50&next=10')), '单队查询必须走 next 接口');
  assert.equal(body.data.matches.length, 2, '主队查询不受热门联赛过滤（league 999 保留）');
  const ids = body.data.matches.map(m => m.status);
  assert.ok(ids.includes('finished') && ids.includes('upcoming'), '最近+未来按时间合并');
}

// ---------- 5. league+next：赛事页未来 tab 的 URL 构造 ----------
{
  resetFetch((u) => {
    assert.ok(u.includes('league=39') && u.includes('next=25'), 'league+next 组合 URL：' + u);
    return apiFootballRes([apiFixture('NS')]);
  });
  const body = await callFixtures('?league=39&next=25');
  assert.equal(body.data.matches.length, 1);
}

// ---------- 6. 按日期默认：只保留热门联赛（赛事发现场景） ----------
{
  resetFetch(() => apiFootballRes([apiFixture('NS', { leagueId: 39 }), apiFixture('NS', { leagueId: 999 })]));
  const body = await callFixtures('?date=2026-08-31');
  assert.equal(body.data.matches.length, 1, 'scope=all 只保留常用联赛');
  assert.equal(body.data.matches[0].league_id, '39');
}

// ---------- 7. 指定联赛 + 日期：不做热门过滤（主队/联赛查询不受截断） ----------
{
  resetFetch(() => apiFootballRes([apiFixture('NS', { leagueId: 999 })]));
  const body = await callFixtures('?league=999&date=2026-08-31');
  assert.equal(body.data.matches.length, 1, '指定联赛时返回该联赛全部赛程');
  assert.equal(body.data.matches[0].league_id, '999');
}

// ---------- CS2：Liquipedia ticker mock ----------
function lpMatchHtml({ homeFull, homeName, awayFull, awayName, tsSec, league, leagueHref, round = 'Bo3' }) {
  const esc = (s) => String(s).replace(/ /g, '_');
  const badge = (n) => `/counterstrike/images/64px-${n}.png`;
  return `
<div class="match-info">
<div class="match-info-header-opponent team-template-image-icon lightmode"><a href="/counterstrike/${esc(homeFull)}"><img src="${badge(homeName)}" alt=""></a><span class="name"><a href="/counterstrike/${esc(homeFull)}" title="${homeFull}">${homeName}</a></span></div>
<div class="match-countdown"><span class="timer-object countdown" data-timestamp="${tsSec}"></span></div>
<div class="match-info-header-opponent team-template-image-icon lightmode"><a href="/counterstrike/${esc(awayFull)}"><img src="${badge(awayName)}" alt=""></a><span class="name"><a href="/counterstrike/${esc(awayFull)}" title="${awayFull}">${awayName}</a></span></div>
<span class="match-info-tournament-name"><a href="/counterstrike/${leagueHref}" title="${league}">${league}</a></span>
<span class="match-info-header-scoreholder"><span class="match-info-header-scoreholder-score">0</span><span class="match-info-header-scoreholder-score">0</span></span>
<span class="match-info-header-vs">${round ? '(' + round + ')' : ''}</span>
</div>`;
}

const futureTs = Math.floor(Date.now() / 1000) + 7200; // 2 小时后开赛 → upcoming
const lpHtml = [
  lpMatchHtml({ homeFull: 'Natus Vincere', homeName: 'NAVI', awayFull: 'FaZe Clan', awayName: 'FaZe', tsSec: futureTs, league: 'BLAST Premier Fall Groups', leagueHref: 'BLAST_Premier/2026/Fall' }),
  lpMatchHtml({ homeFull: 'TYLOO', homeName: 'TYLOO', awayFull: 'Rare Atom', awayName: 'RA', tsSec: futureTs + 600, league: 'ECL Season 48', leagueHref: 'ECL/Season_48' }),
].join('');
function lpRes() { return { ok: true, json: async () => ({ parse: { text: { '*': lpHtml } } }) }; }

// ---------- 8. 默认 A 级白名单：ECL（B 级）被过滤 ----------
{
  resetFetch(() => lpRes());
  const req = new Request('http://localhost/api/sports?type=cs2matches');
  const body = await (await sportsGet({ request: req })).json();
  assert.equal(body.matches.length, 1, '默认只保留 A 级以上赛事');
  assert.equal(body.matches[0].league, 'BLAST Premier Fall Groups');
  // parseLpTicker 字段：队名/全称/队标 128px/赛制/时间
  const m = body.matches[0];
  assert.equal(m.home_id, 'Natus Vincere', 'home_id 用 LP 页面标题（与关注匹配键一致）');
  assert.equal(m.home_name, 'NAVI');
  assert.equal(m.home_badge, 'https://liquipedia.net/counterstrike/images/128px-NAVI.png', '队标升级到 128px');
  assert.equal(m.round, 'Bo3', 'Bo 赛制透传');
  assert.equal(m.status, 'upcoming');
  assert.ok(m.league_url.includes('BLAST_Premier'), '赛事页链接透传');
}

// ---------- 9. tier=all：主队查询全量返回（含 B 级赛事） ----------
{
  resetFetch(() => lpRes());
  const req = new Request('http://localhost/api/sports?type=cs2matches&tier=all');
  const body = await (await sportsGet({ request: req })).json();
  assert.equal(body.matches.length, 2, 'tier=all 不套 A 级白名单，B 级（ECL）主队比赛保留');
  assert.ok(body.matches.some(m => m.league === 'ECL Season 48'));
  assert.ok(body.matches.some(m => m.away_id === 'Rare Atom'));
}

globalThis.fetch = realFetch;
console.log('✓ sports-backend 全部断言通过');
