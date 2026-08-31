// V1.20.0 Sports Center V2 前端单测（ARCH-016）
// 用 node vm 加载 src/features/sports.js（IIFE 挂 window.InnerOSSports），
// mock InnerOSApi 与 fetch，验证统一 Match / SportsScheduleQuery / 日期分组 / 排序 / 去重 /
// Provider 请求构造（主队不受热门联赛与 Tier1 过滤）/ 缓存与降级。
// 运行：node tests/unit/sports-feature.test.mjs
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const src = readFileSync(join(__dirname, '../../src/features/sports.js'), 'utf-8');

// 构造可运行 sports.js 的沙箱：v1 接口走 InnerOSApi.get，旧接口走 fetch
function load({ getImpl, fetchImpl }) {
  const state = { getCalls: [], fetchCalls: [] };
  const sandbox = {
    window: {
      InnerOSApi: { get: async (path) => { state.getCalls.push(path); return getImpl(path); } },
    },
    fetch: async (url) => { state.fetchCalls.push(String(url)); return fetchImpl(String(url)); },
    console: { warn: () => {}, error: () => {} },
    setTimeout, clearTimeout, Date, encodeURIComponent, decodeURIComponent,
  };
  sandbox.globalThis = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(src, sandbox);
  return { S: sandbox.window.InnerOSSports, ...state };
}

function C() {
  return load({
    getImpl: async () => ({ data: { matches: [] } }),
    fetchImpl: async () => ({ ok: true, json: async () => ({ matches: [] }) }),
  }).S.Core;
}

// ---------- 1. normalizeMatch：足球原始对象 → 统一 Match ----------
{
  const Core = C();
  const raw = {
    id: 12345, home_id: '50', home_name: 'Manchester City', home_badge: 'https://media-1.api-sports.io/football/teams/50.png',
    away_id: '42', away_name: 'Arsenal', away_badge: 'https://media-1.api-sports.io/football/teams/42.png',
    ts: 1756636200000, league: 'Premier League', league_id: '39', league_logo: 'https://media-1.api-sports.io/football/leagues/39.png',
    round: 'Regular Season - 5', status: 'live', status_text: '2nd Half', home_score: 2, away_score: 1,
  };
  const m = Core.normalizeMatch(raw, 'football');
  assert.equal(m.id, '12345');
  assert.equal(m.sport, 'football');
  assert.equal(m.status.state, 'live');
  assert.equal(m.status.label, '直播');
  assert.equal(m.home.id, '50');
  assert.equal(m.home.name, 'Manchester City');
  assert.ok(m.home.logo.startsWith('/api/v1/football/image?url='), 'api-sports 图片必须走代理');
  assert.equal(m.competition.id, '39');
  assert.equal(m.competition.name, 'Premier League');
  assert.equal(m.score.home, 2);
  assert.equal(m.score.away, 1);
  assert.equal(m.provider, 'api-football');
  assert.equal(m.providerMatchId, '12345');
  assert.equal(m.startAt, new Date(1756636200000).toISOString());
}

// ---------- 2. mapState：状态映射（upcoming→scheduled，新状态直通） ----------
{
  const Core = C();
  assert.equal(Core.mapState('upcoming'), 'scheduled', '旧模型的 upcoming 归一为 scheduled');
  assert.equal(Core.mapState(''), 'scheduled');
  assert.equal(Core.mapState(undefined), 'scheduled');
  assert.equal(Core.mapState('live'), 'live');
  assert.equal(Core.mapState('finished'), 'finished');
  assert.equal(Core.mapState('postponed'), 'postponed');
  assert.equal(Core.mapState('cancelled'), 'cancelled');
  assert.equal(Core.STATUS_LABEL.postponed, '已推迟');
  assert.equal(Core.STATUS_LABEL.cancelled, '已取消');
}

// ---------- 3. postponed / cancelled 的 Match ----------
{
  const Core = C();
  const mk = (status) => Core.normalizeMatch({ id: '1', ts: Date.now(), home_name: 'A', away_name: 'B', status, league: 'L', league_id: '39' }, 'football');
  assert.equal(mk('postponed').status.state, 'postponed');
  assert.equal(mk('cancelled').status.state, 'cancelled');
  assert.equal(mk('postponed').score.home, null);
}

// ---------- 4. 日期与时区：本地自然日、跨午夜 ----------
{
  const Core = C();
  // 用本地 23:30 与次日 00:30 构造，任何时区下都应分属两个自然日
  const late = new Date(); late.setHours(23, 30, 0, 0);
  const early = new Date(); early.setDate(early.getDate() + 1); early.setHours(0, 30, 0, 0);
  assert.equal(Core.localDateKey(late), Core.todayKey(), '本地 23:30 属于今天');
  assert.equal(Core.localDateKey(early), Core.dateKeyOffset(1), '本地次日 00:30 属于明天（跨午夜进入正确自然日）');
  assert.notEqual(Core.localDateKey(late), Core.localDateKey(early));
}

// ---------- 5. buildDayRange：今天/明天/后天/未来 ----------
{
  const Core = C();
  const today = Core.todayKey();
  const r0 = Core.buildDayRange('today');
  assert.equal(r0.from, today); assert.equal(r0.to, today);
  const r1 = Core.buildDayRange('tomorrow');
  assert.equal(r1.from, Core.dateKeyOffset(1)); assert.equal(r1.to, Core.dateKeyOffset(1));
  const r2 = Core.buildDayRange('dayafter');
  assert.equal(r2.from, Core.dateKeyOffset(2)); assert.equal(r2.to, Core.dateKeyOffset(2));
  const rf = Core.buildDayRange('future');
  assert.equal(rf.from, Core.dateKeyOffset(3), '未来 = 后天之后');
  assert.equal(rf.to, Core.dateKeyOffset(9));
}

// ---------- 6. inDateRange / groupByLocalDate ----------
{
  const Core = C();
  const t23 = new Date(); t23.setHours(23, 30, 0, 0);
  const t24 = new Date(); t24.setDate(t24.getDate() + 1); t24.setHours(0, 30, 0, 0);
  const m1 = { ts: t23.getTime() }, m2 = { ts: t24.getTime() };
  assert.equal(Core.inDateRange(m1, Core.todayKey(), Core.todayKey()), true);
  assert.equal(Core.inDateRange(m2, Core.todayKey(), Core.todayKey()), false);
  const groups = Core.groupByLocalDate([m2, m1]);
  assert.equal(groups.length, 2);
  assert.equal(groups[0].date, Core.todayKey(), '分组按日期升序');
  assert.ok(groups[0].label.startsWith('今天'), '今天组标签');
  assert.ok(groups[1].label.startsWith('明天'), '明天组标签');
}

// ---------- 7. 排序：live 优先，其余按 startAt 升序 ----------
{
  const Core = C();
  const mk = (state, ts) => ({ ts, status: { state } });
  const out = Core.sortMatches([
    mk('scheduled', 300), mk('finished', 100), mk('live', 200), mk('scheduled', 50),
  ]);
  assert.equal(out[0].status.state, 'live', '直播场次排最前');
  assert.deepEqual(out.slice(1).map(m => m.ts), [50, 100, 300], '其余按时间升序');
}

// ---------- 8. 去重：同 id 留信息更全的一场 ----------
{
  const Core = C();
  const base = { id: 'x1', sport: 'football', provider: 'p', home: { id: 'a' }, away: { id: 'b' }, startAt: 'T', ts: 1, status: { state: 'scheduled' }, score: { home: null, away: null } };
  const withScore = { ...base, score: { home: 2, away: 1 } };
  const out = Core.dedupeMatches([base, withScore]);
  assert.equal(out.length, 1);
  assert.equal(out[0].score.home, 2, '有比分者胜出');
  const out2 = Core.dedupeMatches([{ ...base, id: '' }, { ...base, id: '' }]);
  assert.equal(out2.length, 1, '无 id 时按 home|away|startAt 兜底键去重');
}

// ---------- 9. buildQuery：scope 与日期范围 ----------
{
  const Core = C();
  const q = Core.buildQuery({ sport: 'football', scope: 'team', team: { id: '50', name: '曼城', full: 'Manchester City' }, tab: 'tomorrow' });
  assert.equal(q.teamId, '50');
  assert.equal(q.scope, 'team');
  assert.equal(q.from, Core.dateKeyOffset(1));
  assert.equal(q.status, 'all');
  const q2 = Core.buildQuery({ sport: 'cs2', scope: 'competition', competition: { id: 'BLAST Premier Fall Groups', name: 'BLAST 秋季小组赛' }, tab: 'today' });
  assert.equal(q2.competitionId, 'BLAST Premier Fall Groups');
  // V1.20.1：赛事页宽窗口（今天起 60 天）+ status=upcoming（隐藏已结束）
  assert.equal(q2.from, Core.todayKey(), '赛事页从今天开始');
  assert.equal(q2.to, Core.dateKeyOffset(60), '赛事页 60 天宽窗口');
  assert.equal(q2.status, 'upcoming', '赛事页隐藏已结束场次');
  const q3 = Core.buildQuery({ sport: 'football', scope: 'all', tab: 'today' });
  assert.equal(q3.status, 'all', '首页/主队页不过滤状态');
}

// ---------- 10. Provider 请求构造：主队查询不受热门联赛过滤 ----------
{
  const Core = C();
  // 足球 team：单队查询，URL 不带 league（不下载热门联赛再前端筛选）
  const teamUrls = Core.buildFootballUrls({ scope: 'team', teamId: '50', from: '2026-08-31', to: '2026-08-31' });
  assert.equal(teamUrls.length, 1);
  assert.ok(teamUrls[0].includes('team=50'));
  assert.ok(!teamUrls[0].includes('league='));
  // 足球 competition：完整未来赛程（V1.20.1 起恒走 league+next，不再按日期分类）
  const compUrls = Core.buildFootballUrls({ scope: 'competition', competitionId: '39', from: '2026-08-31', to: '2026-08-31' });
  assert.ok(compUrls[0].includes('league=39') && compUrls[0].includes('next=25'), '赛事页请求完整赛程: ' + compUrls[0]);
  assert.ok(!compUrls[0].includes('date='), '赛事页不做日期过滤');
  // 首页 scope=all 未来：+3..+9 逐天
  const allFuture = Core.buildFootballUrls({ scope: 'all', from: Core.dateKeyOffset(3), to: Core.dateKeyOffset(9) });
  assert.equal(allFuture.length, 7);
  assert.ok(allFuture.every(u => u.includes('date=')));
  // CS2 team：tier=all（不受 A 级白名单截断）；其余默认 A 级
  assert.ok(Core.buildCS2Url({ scope: 'team' }).includes('tier=all'));
  assert.ok(!Core.buildCS2Url({ scope: 'competition' }).includes('tier=all'));
  assert.ok(!Core.buildCS2Url({ scope: 'all' }).includes('tier=all'));
}

// ---------- 11. CS2 主队身份匹配（lp: 前缀 / 全称 / 短名 / 中文） ----------
{
  const Core = C();
  const team = { id: 'lp:Natus Vincere', name: 'NAVI', full: 'Natus Vincere' };
  const raws = [
    { home_id: 'Natus Vincere', home_name: 'NAVI', away_id: 'FaZe Clan', away_name: 'FaZe', league: 'BLAST Premier Fall Groups' },
    { home_id: 'TYLOO', home_name: 'TYLOO', away_id: 'Natus Vincere', away_name: 'NAVI', league: 'ECL Season 48' }, // B 级赛事
    { home_id: 'Team Vitality', home_name: 'Vitality', away_id: 'G2 Esports', away_name: 'G2', league: 'IEM Cologne' },
  ];
  const filtered = Core.filterCS2ByTeam(raws, team);
  assert.equal(filtered.length, 2, '按标准化 team identity 匹配（含 B 级赛事，不被 Tier1 截断）');
}

// ---------- 12. querySchedule 端到端（mock 网络）：足球主队单队查询 ----------
{
  const raw = [{
    id: '1035048', home_id: '50', home_name: 'Manchester City', away_id: '47', away_name: 'Tottenham',
    ts: new Date().setHours(20, 30, 0, 0), league: 'Premier League', league_id: '39', status: 'upcoming', home_score: null, away_score: null,
  }];
  const h = load({
    getImpl: async (path) => ({ data: { matches: path.includes('team=50') ? raw : [] } }),
    fetchImpl: async () => ({ ok: true, json: async () => ({ matches: [] }) }),
  });
  const q = h.S.Core.buildQuery({ sport: 'football', scope: 'team', team: { id: '50', name: '曼城', full: 'Manchester City' }, tab: 'today' });
  const r = await h.S.Core.querySchedule(q);
  assert.equal(h.getCalls.length, 1);
  assert.ok(h.getCalls[0].includes('team=50'), '主队查询必须走单队接口');
  assert.equal(r.matches.length, 1);
  assert.equal(r.matches[0].competition.name, 'Premier League');
  assert.equal(r.matches[0].status.state, 'scheduled');
}

// ---------- 13. querySchedule：CS2 主队不受 Tier1 过滤（tier=all + B 级赛事保留） ----------
{
  const tsToday = new Date(); tsToday.setHours(18, 0, 0, 0);
  const cs2Raw = [
    { id: 'lp-1-navi-vs-faze', home_id: 'Natus Vincere', home_name: 'NAVI', away_id: 'FaZe Clan', away_name: 'FaZe', ts: tsToday.getTime(), league: 'BLAST Premier Fall Groups', status: 'upcoming', round: 'Bo3' },
    { id: 'lp-2-tyloo-vs-navi', home_id: 'TYLOO', home_name: 'TYLOO', away_id: 'Natus Vincere', away_name: 'NAVI', ts: tsToday.getTime() + 3600e3, league: 'ECL Season 48', status: 'upcoming', round: 'Bo1' },
  ];
  const h = load({
    getImpl: async () => ({ matches: [] }),
    fetchImpl: async (url) => {
      assert.ok(url.includes('type=cs2matches') && url.includes('tier=all'), 'CS2 主队查询必须请求全量（tier=all）');
      return { ok: true, json: async () => ({ matches: cs2Raw }) };
    },
  });
  const q = h.S.Core.buildQuery({ sport: 'cs2', scope: 'team', team: { id: 'lp:Natus Vincere', name: 'NAVI', full: 'Natus Vincere' }, tab: 'today' });
  const r = await h.S.Core.querySchedule(q);
  assert.equal(r.matches.length, 2, 'B 级赛事（ECL）的主队比赛也必须保留');
  assert.equal(r.matches[0].format, 'Bo3', 'CS2 Bo 赛制透传');
  assert.equal(r.matches[0].competition.name, 'BLAST 秋季小组赛', '赛事中文名映射');
  assert.equal(r.matches[0].home.name, 'NAVI');
}

// ---------- 14. querySchedule：CS2 赛事页按 competitionId 过滤 ----------
{
  const tsToday = new Date(); tsToday.setHours(18, 0, 0, 0);
  const cs2Raw = [
    { id: 'lp-1', home_id: 'Natus Vincere', home_name: 'NAVI', away_id: 'FaZe Clan', away_name: 'FaZe', ts: tsToday.getTime(), league: 'IEM Cologne', status: 'upcoming' },
    { id: 'lp-2', home_id: 'G2 Esports', home_name: 'G2', away_id: 'Team Vitality', away_name: 'Vitality', ts: tsToday.getTime(), league: 'BLAST Premier Fall Groups', status: 'upcoming' },
  ];
  const h = load({
    getImpl: async () => ({ matches: [] }),
    fetchImpl: async (url) => {
      assert.ok(!url.includes('tier=all'), '非主队查询默认 A 级赛事');
      return { ok: true, json: async () => ({ matches: cs2Raw }) };
    },
  });
  const q = h.S.Core.buildQuery({ sport: 'cs2', scope: 'competition', competition: { id: 'IEM Cologne', name: 'IEM 科隆' }, tab: 'today' });
  const r = await h.S.Core.querySchedule(q);
  assert.equal(r.matches.length, 1, '赛事页以 competitionId 为第一过滤条件');
  assert.equal(r.matches[0].competition.name, 'IEM 科隆');
}

// ---------- 14.5 CS2 赛事名多词翻译（V1.20.1：英文赛事名中文化） ----------
{
  const Core = C();
  assert.equal(Core.cs2TournamentCN('BLAST Open Fall 2026 - Group A'), 'BLAST 公开赛 秋季 2026 - A组');
  assert.equal(Core.cs2TournamentCN('FISSURE Playground #3 - Group B'), 'FISSURE 系列赛 #3 - B组');
  assert.equal(Core.cs2TournamentCN('Esports World Cup 2026 - Groups'), '电竞世界杯 2026 - 小组赛');
  assert.equal(Core.cs2TournamentCN('IEM Melbourne'), 'IEM 墨尔本');
  assert.equal(Core.cs2TournamentCN('BLAST Premier Fall Groups'), 'BLAST 秋季小组赛', '整串精确映射优先');
  assert.equal(Core.cs2TournamentCN('StarLadder Major'), 'StarLadder Major 世界锦标赛');
  assert.equal(Core.cs2TournamentCN(''), '');
}

// ---------- 14.55 CS2 赛事按基础名聚合（V1.20.2：同赛事 A/B 组不再分卡） ----------
{
  const Core = C();
  assert.equal(Core.cs2BaseLeague('BLAST Open Fall 2026 - Group A'), 'BLAST Open Fall 2026');
  assert.equal(Core.cs2BaseLeague('FISSURE Playground #3 - Group B'), 'FISSURE Playground #3');
  assert.equal(Core.cs2BaseLeague('IEM Cologne'), 'IEM Cologne', '无分组后缀原样返回');
  assert.equal(Core.cs2BaseLeague(''), '');
  assert.equal(Core.cs2BaseLeague(null), '', '空值兜底');
}

// ---------- 14.6 querySchedule：赛事页（status=upcoming）过滤已结束场次 ----------
{
  const tsFuture = new Date(); tsFuture.setDate(tsFuture.getDate() + 1); tsFuture.setHours(18, 0, 0, 0);
  const raw = [
    { id: 'f1', home_id: '50', home_name: 'Man City', away_id: '42', away_name: 'Arsenal', ts: tsFuture.getTime(), league: 'Premier League', league_id: '39', status: 'upcoming' },
    { id: 'f2', home_id: '33', home_name: 'Man Utd', away_id: '49', home_badge: '', away_name: 'Chelsea', ts: tsFuture.getTime() + 3600e3, league: 'Premier League', league_id: '39', status: 'finished', home_score: 2, away_score: 1 },
  ];
  const h = load({
    getImpl: async (path) => {
      assert.ok(path.includes('league=39') && path.includes('next=25'), '赛事页走 league+next: ' + path);
      return { data: { matches: raw } };
    },
    fetchImpl: async () => ({ ok: true, json: async () => ({ matches: [] }) }),
  });
  const q = h.S.Core.buildQuery({ sport: 'football', scope: 'competition', competition: { id: '39', name: '英超' }, tab: 'today' });
  const r = await h.S.Core.querySchedule(q);
  assert.equal(r.matches.length, 1, '已结束场次在赛事页不显示');
  assert.equal(r.matches[0].id, 'f1');
}

// ---------- 15. 缓存：TTL 内切换日期/主队不重复请求 ----------
{
  let calls = 0;
  const tsToday = new Date(); tsToday.setHours(20, 0, 0, 0);
  const raw = [{ id: '1', home_id: '50', home_name: 'A', away_id: '47', away_name: 'B', ts: tsToday.getTime(), league: 'Premier League', league_id: '39', status: 'upcoming' }];
  const h = load({
    getImpl: async () => { calls++; return { data: { matches: raw } }; },
    fetchImpl: async () => ({ ok: true, json: async () => ({ matches: [] }) }),
  });
  const q = h.S.Core.buildQuery({ sport: 'football', scope: 'all', tab: 'today' });
  await h.S.Core.querySchedule(q);
  await h.S.Core.querySchedule(q); // 二次查询（切 tab 回来）
  assert.equal(calls, 1, '缓存命中，零重复网络请求');
}

// ---------- 16. Provider 失败：回退最近成功数据并标记 stale；首次失败抛错 ----------
{
  const tsToday = new Date(); tsToday.setHours(20, 0, 0, 0);
  const raw = [{ id: '1', home_id: '50', home_name: 'A', away_id: '47', away_name: 'B', ts: tsToday.getTime(), league: 'L', league_id: '39', status: 'upcoming' }];
  let okMode = true;
  const h = load({
    getImpl: async () => { if (okMode) return { data: { matches: raw } }; throw new Error('provider down'); },
    fetchImpl: async () => ({ ok: true, json: async () => ({ matches: [] }) }),
  });
  const q = h.S.Core.buildQuery({ sport: 'football', scope: 'all', tab: 'today' });
  const r1 = await h.S.Core.querySchedule(q);
  assert.equal(r1.stale, false);
  okMode = false;
  h.S.Core.TTL.normal = 0; // 模拟缓存过期（重新请求 Provider）
  const r2 = await h.S.Core.querySchedule(q);
  h.S.Core.TTL.normal = 120 * 1000;
  assert.equal(r2.stale, true, '失败时回退最近成功数据');
  assert.equal(r2.matches.length, 1);
  // 首次就失败（无缓存）→ 抛错，由 UI 走统一 error + retry
  const h2 = load({
    getImpl: async () => { throw new Error('provider down'); },
    fetchImpl: async () => { throw new Error('network down'); },
  });
  await assert.rejects(() => h2.S.Core.querySchedule(h2.S.Core.buildQuery({ sport: 'football', scope: 'all', tab: 'today' })), /down/);
}

// ---------- 17. 未配置 FOOTBALL_API_KEY：首页回退旧数据源，主队/联赛如实提示 ----------
{
  const tsToday = new Date(); tsToday.setHours(20, 0, 0, 0);
  const legacyRaw = [{ id: 'e1', home_id: 'h1', home_name: 'A', away_id: 'a1', away_name: 'B', ts: tsToday.getTime(), date: new Date().toISOString().slice(0, 10), time: '12:00', league: '英超', league_id: '4328', status: 'upcoming' }];
  const h = load({
    getImpl: async () => ({ data: { matches: [], fallback: true } }),
    fetchImpl: async (url) => {
      assert.ok(url.includes('type=matches'), '回退旧 TheSportsDB 接口');
      return { ok: true, json: async () => ({ matches: legacyRaw }) };
    },
  });
  const r = await h.S.Core.querySchedule(h.S.Core.buildQuery({ sport: 'football', scope: 'all', tab: 'today' }));
  assert.equal(r.degraded, 'legacy');
  assert.equal(r.matches.length, 1, '首页降级仍显示真实旧数据源赛程');
  // 主队查询降级 → 空结果 + no-key 标记（禁止假数据）
  const r2 = await h.S.Core.querySchedule(h.S.Core.buildQuery({ sport: 'football', scope: 'team', team: { id: '50', name: '曼城' }, tab: 'today' }));
  assert.equal(r2.degraded, 'no-key');
  assert.equal(r2.matches.length, 0);
}

// ---------- 18. 日期过滤：明天 tab 过滤掉今天的比赛 ----------
{
  const t20 = new Date(); t20.setHours(20, 0, 0, 0);
  const t20tom = new Date(); t20tom.setDate(t20tom.getDate() + 1); t20tom.setHours(20, 0, 0, 0);
  const raw = [
    { id: '1', home_id: '50', home_name: 'A', away_id: '47', away_name: 'B', ts: t20.getTime(), league: 'L', league_id: '39', status: 'upcoming' },
    { id: '2', home_id: '50', home_name: 'A', away_id: '47', away_name: 'B', ts: t20tom.getTime(), league: 'L', league_id: '39', status: 'upcoming' },
  ];
  const h = load({ getImpl: async () => ({ data: { matches: raw } }), fetchImpl: async () => ({ ok: true, json: async () => ({ matches: [] }) }) });
  const r = await h.S.Core.querySchedule(h.S.Core.buildQuery({ sport: 'football', scope: 'team', team: { id: '50', name: 'A' }, tab: 'tomorrow' }));
  assert.equal(r.matches.length, 1, '日期作为第二层过滤');
  assert.equal(r.matches[0].id, '2');
}

console.log('✓ sports-feature 全部断言通过');
