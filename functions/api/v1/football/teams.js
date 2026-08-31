// GET /api/v1/football/teams?search=xxx —— 球队搜索（API-Football）
// 用于主队添加时的搜索选择。缓存 1 小时。
// API-Football 的 search 只支持英文名：中文关键词先经 CN_ALIAS 转成英文再查
// （与 server.py /api/sports?type=teamsearch 的 cn_alias 同源，双端保持一致）。
import { fetchFootball, hasKey, footballStatusHint } from '../../../_services/football-client.js';
import { ok, errors } from '../../../_infra/errors.js';

const CN_ALIAS = {
  '阿森纳': 'Arsenal', '阿仙奴': 'Arsenal', '枪手': 'Arsenal',
  '曼城': 'Manchester City', '曼联': 'Manchester United', '利物浦': 'Liverpool',
  '切尔西': 'Chelsea', '车路士': 'Chelsea', '热刺': 'Tottenham',
  '皇马': 'Real Madrid', '皇家马德里': 'Real Madrid', '巴塞罗那': 'FC Barcelona',
  '巴萨': 'FC Barcelona', '马竞': 'Atletico Madrid', '马德里竞技': 'Atletico Madrid',
  '拜仁': 'Bayern Munich', '拜仁慕尼黑': 'Bayern Munich', '多特': 'Borussia Dortmund',
  '多特蒙德': 'Borussia Dortmund', '勒沃库森': 'Bayer Leverkusen', '莱比锡': 'RB Leipzig',
  '国米': 'Inter', '国际米兰': 'Inter', 'AC米兰': 'AC Milan', '米兰': 'AC Milan',
  '尤文': 'Juventus', '尤文图斯': 'Juventus', '那不勒斯': 'Napoli', '罗马': 'Roma',
  '拉齐奥': 'Lazio', '亚特兰大': 'Atalanta', '佛罗伦萨': 'Fiorentina',
  '巴黎': 'Paris Saint Germain', '巴黎圣日耳曼': 'Paris Saint Germain', '大巴黎': 'Paris Saint Germain',
  '里昂': 'Lyon', '摩纳哥': 'Monaco', '马赛': 'Marseille',
  '阿贾克斯': 'Ajax', '本菲卡': 'Benfica', '波尔图': 'FC Porto',
  '纽卡斯尔': 'Newcastle', '维拉': 'Aston Villa', '阿斯顿维拉': 'Aston Villa',
  '西汉姆': 'West Ham', '埃弗顿': 'Everton', '莱斯特城': 'Leicester',
  '塞尔塔': 'Celta Vigo', '塞维利亚': 'Sevilla', '瓦伦西亚': 'Valencia',
  '比利亚雷亚尔': 'Villarreal', '皇家社会': 'Real Sociedad', '毕尔巴鄂': 'Athletic Bilbao',
  '山东泰山': 'Shandong Taishan', '上海海港': 'Shanghai Port', '上海申花': 'Shanghai Shenhua',
  '北京国安': 'Beijing Guoan', '广州队': 'Guangzhou FC', '成都蓉城': 'Chengdu Rongcheng',
  '浙江队': 'Zhejiang Professional', '武汉三镇': 'Wuhan Three Towns',
};

function isCJK(q) {
  return /[\u4e00-\u9fff]/.test(q);
}

export async function onRequestGet(context) {
  const { request, env } = context;
  const url = new URL(request.url);
  const q = (url.searchParams.get('search') || url.searchParams.get('q') || '').trim();

  if (!q || q.length < 1) return errors.validation('搜索关键词不能为空');
  if (!hasKey(env)) return ok({ teams: [], fallback: true });

  // 中文 → 英文搜索词（API-Football 只认英文名）；无映射的中文词如实返回空
  const term = isCJK(q) ? (CN_ALIAS[q] || '') : q;
  if (!term) return ok({ teams: [], message: '暂不支持该中文关键词，请输入英文名，或从热门球队推荐中选择' });

  try {
    const data = await fetchFootball(`/teams?search=${encodeURIComponent(term)}`, env, 3600);
    if (!data || !data.response) return ok({ teams: [], fallback: true, message: 'API-Football 请求失败' + (footballStatusHint() ? '（' + footballStatusHint() + '）' : '，请稍后重试') });
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
