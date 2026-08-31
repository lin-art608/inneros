// GET /api/v1/football/fixture?id=xxx —— 比赛详情（阵容/事件/统计）
// 代理 API-Football /fixtures?id=xxx，缓存 120s。
import { fetchFootball, hasKey } from '../../../_services/football-client.js';
import { ok, errors } from '../../../_infra/errors.js';

export async function onRequestGet(context) {
  const { request, env } = context;
  const url = new URL(request.url);
  const id = url.searchParams.get('id');

  if (!id) return errors.validation('比赛 ID 不能为空');
  if (!hasKey(env)) return ok({ fixture: null, fallback: true });

  try {
    const data = await fetchFootball(`/fixtures?id=${encodeURIComponent(id)}`, env, 120);
    if (!data || !data.response || !data.response.length) return ok({ fixture: null });
    const raw = data.response[0];
    return ok({
      fixture: raw.fixture,
      league: raw.league,
      teams: raw.teams,
      goals: raw.goals,
      score: raw.score,
      events: raw.events || [],
      lineups: raw.lineups || [],
      statistics: raw.statistics || [],
      players: raw.players || [],
    });
  } catch (e) {
    console.error('[football fixture]', e.message);
    return errors.provider('比赛详情获取失败', true);
  }
}
