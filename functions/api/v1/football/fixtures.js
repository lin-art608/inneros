// GET /api/v1/football/fixtures —— 足球赛程（API-Football 代理）
// 参数：
//   date=YYYY-MM-DD  指定日期（默认今天，UTC+8）
//   league=id         过滤联赛（与 date 或 next 组合）
//   team=id           过滤球队（单队最近 5 场 + 未来 10 场）
//   live=all          仅实时比赛
//   next=10           未来 N 场（与 league 组合：联赛未来赛程）
// 所有查询带 timezone=Asia/Shanghai（按北京时间自然日过滤与展示，跨午夜场次不漏）。
// 未配置 FOOTBALL_API_KEY **或 API-Football 请求失败（限流/密钥异常）** 时均返回
// { matches: [], fallback: true }，前端回退旧接口（V1.20.1 修复）。

import { fetchFootball, normalizeFixture, hasKey, POPULAR_LEAGUES, footballStatusHint } from '../../../_services/football-client.js';
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
        fetchFootball(`/fixtures?team=${encodeURIComponent(team)}&last=5&timezone=Asia%2FShanghai`, env, 120),
        fetchFootball(`/fixtures?team=${encodeURIComponent(team)}&next=10&timezone=Asia%2FShanghai`, env, 120),
      ]);
      const matches = [
        ...((last?.response || []).map(normalizeFixture)),
        ...((nextRes?.response || []).map(normalizeFixture)),
      ].sort((a, b) => (a.ts || 0) - (b.ts || 0));
      return ok({ matches, count: matches.length });
    } else if (leagueParam && next) {
      // 指定联赛未来 N 场（赛事页完整赛程；主队查询不受热门联赛过滤）
      path = `/fixtures?league=${encodeURIComponent(leagueParam)}&next=${encodeURIComponent(next)}&timezone=Asia%2FShanghai`;
    } else {
      // 按日期赛程（默认今天，北京时间）
      const date = dateParam || getBeijingDate();
      path = `/fixtures?date=${date}`;
      if (leagueParam) path += `&league=${encodeURIComponent(leagueParam)}`;
      path += '&timezone=Asia%2FShanghai';
    }

    const data = await fetchFootball(path, env, 60); // 赛程缓存 60s
    // V1.20.1 fix：API-Football 请求失败（限流/密钥异常）时也必须标记 fallback:true，
    // 前端才回退 TheSportsDB 旧数据源——此前返回 false 导致足球页全空
    // V1.20.2：message 带上游 HTTP 状态码（401=key 无效 / 403=封禁 / 429=限流），排查不用猜
    if (!data) return ok({ matches: [], fallback: true, message: 'API-Football 请求失败' + (footballStatusHint() ? '（' + footballStatusHint() + '），已回退旧数据源' : '（可能限流或密钥异常），已回退旧数据源') });

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
