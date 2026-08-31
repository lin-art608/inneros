// GET /api/v1/football/leagues —— 常用联赛列表（无需 API key，内置常用联赛）
// GET /api/v1/football/standings?league=id&season=year —— 联赛积分榜（需 API key）

import { fetchFootball, hasKey, POPULAR_LEAGUES } from '../../../_services/football-client.js';
import { ok, errors } from '../../../_infra/errors.js';

export async function onRequestGet(context) {
  const { request, env } = context;
  const url = new URL(request.url);
  const action = url.searchParams.get('action') || 'list';

  if (action === 'list') {
    // 常用联赛列表（内置，无需 key）
    return ok({ leagues: POPULAR_LEAGUES });
  }

  if (action === 'standings') {
    if (!hasKey(env)) return ok({ standings: [], fallback: true });
    const league = url.searchParams.get('league');
    const season = url.searchParams.get('season') || String(new Date().getFullYear());
    if (!league) return errors.validation('联赛 ID 不能为空');

    try {
      const data = await fetchFootball(`/standings?league=${encodeURIComponent(league)}&season=${encodeURIComponent(season)}`, env, 3600);
      if (!data || !data.response || !data.response.length) return ok({ standings: [] });
      const table = data.response[0].league?.standings?.[0] || [];
      const standings = table.map(row => ({
        rank: row.rank,
        team_id: String(row.team?.id || ''),
        team_name: row.team?.name || '',
        team_badge: row.team?.logo || '',
        points: row.points,
        played: row.all?.played || 0,
        win: row.all?.win || 0,
        draw: row.all?.draw || 0,
        lose: row.all?.lose || 0,
        goals_for: row.all?.goals?.for || 0,
        goals_against: row.all?.goals?.against || 0,
        goals_diff: row.goalsDiff,
        form: row.form || '',
        status: row.status || '',
      }));
      return ok({ standings, league: data.response[0].league?.name || '', season });
    } catch (e) {
      console.error('[football standings]', e.message);
      return errors.provider('积分榜获取失败', true);
    }
  }

  return errors.validation('未知 action');
}
