// GET /api/v1/football/fixtures —— 足球赛程（API-Football 代理）
// 参数：
//   date=YYYY-MM-DD  指定日期（默认今天，UTC+8）
//   league=id         过滤联赛（可多个，逗号分隔）
//   team=id           过滤球队
//   live=all          仅实时比赛
//   next=10           球队未来 N 场（需配合 team）
// 未配置 FOOTBALL_API_KEY 时返回 { matches: [], fallback: true }，前端回退旧接口。

import { fetchFootball, normalizeFixture, hasKey, POPULAR_LEAGUES } from '../../../_services/football-client.js';
import { ok, fail, errors } from '../../../_infra/errors.js';

export async function onRequestGet(context) {
  const { request, env } = context;
  const url = new URL(request.url);

  if (!hasKey(env)) {
    return ok({ matches: [], fallback: true, message: '未配置 FOOTBALL_API_KEY，使用旧数据源' });
  }

  const live = url.searchParams.get('live');
  const team = url.searchParams.get('team');
  const next = url.searchParams.get('next');
  const leagueParam = url.searchParams.get('league');
  const dateParam = url.searchParams.get('date');

  try {
    let path = '';
    if (live === 'all') {
      path = '/fixtures?live=all';
    } else if (team && next) {
      path = `/fixtures?team=${encodeURIComponent(team)}&next=${encodeURIComponent(next)}`;
    } else if (team) {
      // 球队最近+未来赛程
      const [last, nextRes] = await Promise.all([
        fetchFootball(`/fixtures?team=${encodeURIComponent(team)}&last=5`, env, 120),
        fetchFootball(`/fixtures?team=${encodeURIComponent(team)}&next=10`, env, 120),
      ]);
      const matches = [
        ...((last?.response || []).map(normalizeFixture)),
        ...((nextRes?.response || []).map(normalizeFixture)),
      ].sort((a, b) => (a.ts || 0) - (b.ts || 0));
      return ok({ matches, count: matches.length });
    } else {
      // 按日期赛程（默认今天，北京时间）
      const date = dateParam || getBeijingDate();
      path = `/fixtures?date=${date}`;
      if (leagueParam) path += `&league=${encodeURIComponent(leagueParam)}`;
    }

    const data = await fetchFootball(path, env, 60); // 赛程缓存 60s
    if (!data) return ok({ matches: [], fallback: false, message: 'API-Football 请求失败' });

    let matches = (data.response || []).map(normalizeFixture);

    // 未指定联赛时，只保留常用联赛（避免返回太多小众联赛）
    if (!leagueParam && !team && !live) {
      const popularIds = new Set(POPULAR_LEAGUES.map(l => String(l.id)));
      matches = matches.filter(m => popularIds.has(m.league_id));
    }

    matches.sort((a, b) => (a.ts || 0) - (b.ts || 0));
    return ok({ matches, count: matches.length });
  } catch (e) {
    console.error('[football fixtures]', e.message);
    return errors.provider('足球赛程获取失败，请稍后重试', true);
  }
}

function getBeijingDate() {
  const now = new Date();
  // UTC+8
  const beijing = new Date(now.getTime() + 8 * 3600 * 1000);
  return beijing.toISOString().slice(0, 10);
}
