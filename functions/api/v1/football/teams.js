// GET /api/v1/football/teams?search=xxx —— 球队搜索（API-Football）
// 用于主队添加时的搜索选择。缓存 1 小时。
import { fetchFootball, hasKey } from '../../../_services/football-client.js';
import { ok, errors } from '../../../_infra/errors.js';

export async function onRequestGet(context) {
  const { request, env } = context;
  const url = new URL(request.url);
  const q = url.searchParams.get('search') || url.searchParams.get('q');

  if (!q || q.length < 1) return errors.validation('搜索关键词不能为空');
  if (!hasKey(env)) return ok({ teams: [], fallback: true });

  try {
    const data = await fetchFootball(`/teams?search=${encodeURIComponent(q)}`, env, 3600);
    if (!data || !data.response) return ok({ teams: [] });
    const teams = data.response.map(item => ({
      id: String(item.team?.id || ''),
      name: item.team?.name || '',
      logo: item.team?.logo || '',
      country: item.team?.country || '',
      founded: item.team?.founded || null,
    })).filter(t => t.id && t.name);
    return ok({ teams, count: teams.length });
  } catch (e) {
    console.error('[football teams]', e.message);
    return errors.provider('球队搜索失败', true);
  }
}
