// PandaScore Adapter —— CS2 完整赛程优先源。
// 免费 Fixtures 方案提供赛程、队伍、赛事、赛制、状态、结果和直播链接；密钥只从环境变量读取。

const API_BASE = 'https://api.pandascore.co/csgo/matches';
export const DEFAULT_PANDASCORE_LIMIT = 100;

export function buildPandaScoreMatchesUrl({ from, to, page = 1, limit = DEFAULT_PANDASCORE_LIMIT } = {}) {
  const start = from || new Date(Date.now() - 24 * 3600e3).toISOString();
  const end = to || new Date(Date.now() + 9 * 24 * 3600e3).toISOString();
  const query = new URLSearchParams({
    'range[begin_at]': `${start},${end}`,
    sort: 'begin_at',
    page: String(Math.max(1, Number(page) || 1)),
    per_page: String(Math.max(1, Math.min(DEFAULT_PANDASCORE_LIMIT, Number(limit) || DEFAULT_PANDASCORE_LIMIT))),
  });
  return `${API_BASE}?${query.toString()}`;
}

function providerStatus(status) {
  if (status === 'running') return 'live';
  if (status === 'finished') return 'finished';
  if (status === 'canceled') return 'cancelled';
  if (status === 'postponed') return 'postponed';
  return 'upcoming';
}

function competitionName(match) {
  const values = [match.league?.name, match.serie?.full_name || match.serie?.name, match.tournament?.name]
    .map(value => String(value || '').trim())
    .filter(Boolean);
  return [...new Set(values)].join(' · ');
}

function teamAt(match, index) {
  return match.opponents?.[index]?.opponent || {};
}

function scoreFor(match, teamId) {
  const result = (match.results || []).find(item => String(item.team_id) === String(teamId));
  return result && Number.isFinite(Number(result.score)) ? Number(result.score) : null;
}

export function normalizePandaScoreMatch(match) {
  const home = teamAt(match, 0);
  const away = teamAt(match, 1);
  const beginAt = match.begin_at || match.scheduled_at || null;
  const ts = beginAt ? Date.parse(beginAt) : null;
  const games = Number(match.number_of_games);
  return {
    sport: 'cs2',
    id: `ps-${match.id}`,
    home_id: String(home.id || ''),
    home_name: home.acronym || home.name || '待定',
    home_badge: home.image_url || '',
    away_id: String(away.id || ''),
    away_name: away.acronym || away.name || '待定',
    away_badge: away.image_url || '',
    ts: Number.isFinite(ts) ? ts : null,
    league: competitionName(match),
    round: games > 0 ? `Bo${games}` : '',
    status: providerStatus(match.status),
    status_text: match.status || '',
    home_score: scoreFor(match, home.id),
    away_score: scoreFor(match, away.id),
    provider: 'pandascore',
  };
}

export function createPandaScoreProvider(token, fetchImpl = fetch) {
  const apiToken = String(token || '').trim();
  return Object.freeze({
    configured: Boolean(apiToken),
    async getMatches({ limit = 200 } = {}) {
      if (!apiToken) throw new Error('pandascore token missing');
      const now = Date.now();
      const from = new Date(now - 24 * 3600e3).toISOString();
      const to = new Date(now + 9 * 24 * 3600e3).toISOString();
      const pages = Math.max(1, Math.ceil(Math.min(200, Number(limit) || 200) / DEFAULT_PANDASCORE_LIMIT));
      const rows = [];
      for (let page = 1; page <= pages; page++) {
        const response = await fetchImpl(buildPandaScoreMatchesUrl({ from, to, page }), {
          headers: { Authorization: `Bearer ${apiToken}`, Accept: 'application/json' },
          cf: { cacheEverything: true, cacheTtl: 300 },
        });
        if (!response.ok) throw new Error(`pandascore ${response.status}`);
        const batch = await response.json();
        if (!Array.isArray(batch)) throw new Error('pandascore invalid payload');
        rows.push(...batch);
        if (batch.length < DEFAULT_PANDASCORE_LIMIT) break;
      }
      return rows.slice(0, Math.min(200, Number(limit) || 200)).map(normalizePandaScoreMatch);
    },
  });
}
