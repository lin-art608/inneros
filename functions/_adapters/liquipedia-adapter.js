// Liquipedia Adapter（ARCH-017）——只负责官方 MediaWiki API 请求与字段归一化。
// 合规约束：action=parse 最多 1 次/30 秒；描述性 UA；gzip；边缘缓存 15 分钟；保留 CC BY-SA 署名。

const LP_API = 'https://liquipedia.net/counterstrike/api.php';
const LP_UA = 'InnerOS/1.0 (https://inneros.pages.dev; contact: dev@inneros.asia)';
export const DEFAULT_MATCH_LIMIT = 200;

export function buildTickerUrl(limit = DEFAULT_MATCH_LIMIT) {
  const safeLimit = Math.max(1, Math.min(200, Number(limit) || DEFAULT_MATCH_LIMIT));
  const text = `{{#invoke:Lua|invoke|module=Widget/Factory|fn=fromTemplate|widget=Match/Ticker/Container|limit=${safeLimit}}}`;
  const query = new URLSearchParams({ action: 'parse', text, contentmodel: 'wikitext', prop: 'text', format: 'json' });
  return `${LP_API}?${query.toString()}`;
}

function absoluteUrl(src) {
  return src && src.startsWith('/') ? 'https://liquipedia.net' + src : (src || '');
}

export function parseLiquipediaTicker(html, nowMs = Date.now()) {
  const blocks = String(html || '').split('<div class="match-info">');
  const matches = [];
  const parseTeam = (segment) => {
    let image = segment.match(/team-template-(?:lightmode|allmode)"><a[^>]*><img[^>]*src="([^"]+)"/)
      || segment.match(/team-template-image-icon[^"]*"><a[^>]*><img[^>]*src="([^"]+)"/);
    if (image) image[1] = image[1].replace(/\/(\d+)px-/, '/128px-');
    const name = segment.match(/<span class="name"[^>]*><a[^>]*title="([^"]*)"[^>]*>([^<]*)<\/a>/);
    return {
      full: name ? name[1] : '',
      name: name ? name[2].trim() : '',
      badge: image ? absoluteUrl(image[1]) : '',
    };
  };

  for (const block of blocks.slice(1)) {
    const opponents = block.split('<div class="match-info-header-opponent');
    if (opponents.length < 3) continue;
    const home = parseTeam(opponents[1]);
    const away = parseTeam(opponents[2]);
    if (!home.name && !away.name) continue;

    const timestampMatch = block.match(/timer-object[^>]*data-timestamp="(\d+)"/);
    const timestamp = timestampMatch ? Number(timestampMatch[1]) * 1000 : 0;
    const tournamentMatch = block.match(/match-info-tournament-name"[^>]*>([\s\S]*?)<\/span>/);
    const tournamentHtml = tournamentMatch ? tournamentMatch[1] : '';
    const league = tournamentHtml.replace(/<[^>]+>/g, '').trim();
    const leagueHref = tournamentHtml.match(/<a[^>]*href="([^"]+)"/);
    const formatMatch = block.match(/\((Bo\d)\)/i);
    const scores = [...block.matchAll(/match-info-header-scoreholder-score[^"]*">\s*(-?\d+)\s*</g)].map(m => Number(m[1]));

    let status = 'upcoming';
    let homeScore = null;
    let awayScore = null;
    if (timestamp && nowMs >= timestamp && nowMs < timestamp + 3.5 * 3600e3) status = 'live';
    else if (timestamp && nowMs >= timestamp + 3.5 * 3600e3) {
      status = 'finished';
      if (scores.length >= 2) [homeScore, awayScore] = scores;
    }
    const date = new Date(timestamp || nowMs);
    matches.push({
      sport: 'cs2',
      id: 'lp-' + Math.floor(timestamp / 1000) + '-' + (home.name + '-' + away.name).toLowerCase().replace(/[^a-z0-9-]/g, ''),
      home_id: home.full || home.name,
      home_name: home.name,
      home_badge: home.badge,
      away_id: away.full || away.name,
      away_name: away.name,
      away_badge: away.badge,
      ts: timestamp,
      date: date.toISOString().slice(0, 10),
      time: String(date.getUTCHours()).padStart(2, '0') + ':' + String(date.getUTCMinutes()).padStart(2, '0'),
      league,
      league_url: leagueHref ? absoluteUrl(leagueHref[1]) : '',
      round: formatMatch ? formatMatch[1] : '',
      status,
      home_score: homeScore,
      away_score: awayScore,
      importance: 3,
      tournament_weight: 3,
    });
  }
  return matches;
}

export async function getMatches({ fetchImpl = fetch, limit = DEFAULT_MATCH_LIMIT, nowMs = Date.now() } = {}) {
  const response = await fetchImpl(buildTickerUrl(limit), {
    headers: { 'User-Agent': LP_UA, 'Accept-Encoding': 'gzip', Accept: 'application/json' },
    cf: { cacheEverything: true, cacheTtl: 900 },
  });
  if (!response.ok) throw new Error('liquipedia ' + response.status);
  const data = await response.json();
  const html = data.parse && data.parse.text && data.parse.text['*'];
  if (!html) throw new Error('liquipedia empty');
  return parseLiquipediaTicker(html, nowMs);
}

export const liquipediaProvider = Object.freeze({ getMatches });

