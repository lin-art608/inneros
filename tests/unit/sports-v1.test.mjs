// ARCH-017：Liquipedia Adapter → Sports Service → /api/v1 路由。
import assert from 'node:assert/strict';
import { buildTickerUrl, parseLiquipediaTicker } from '../../functions/_adapters/liquipedia-adapter.js';
import { buildPandaScoreMatchesUrl, createPandaScoreProvider, normalizePandaScoreMatch } from '../../functions/_adapters/pandascore-adapter.js';
import { createSportsService } from '../../functions/_services/sports-service.js';
import { onRequestGet } from '../../functions/api/v1/sports/cs2/matches.js';

const future = Math.floor(Date.now() / 1000) + 3600;
const html = `<div class="match-info">
  <div class="match-info-header-opponent team-template-image-icon"><a><img src="/counterstrike/images/64px-NAVI.png"></a><span class="name"><a title="Natus Vincere">NAVI</a></span></div>
  <span class="timer-object" data-timestamp="${future}"></span>
  <div class="match-info-header-opponent team-template-image-icon"><a><img src="/counterstrike/images/64px-RA.png"></a><span class="name"><a title="Rare Atom">RA</a></span></div>
  <span class="match-info-tournament-name"><a href="/counterstrike/ECL/Season_48">ECL Season 48</a></span>
  <span>(Bo3)</span>
</div>`;

{
  const url = new URL(buildTickerUrl());
  assert.equal(url.searchParams.get('action'), 'parse');
  assert.match(url.searchParams.get('text'), /limit=200/);
  const matches = parseLiquipediaTicker(html);
  assert.equal(matches.length, 1);
  assert.equal(matches[0].home_id, 'Natus Vincere');
  assert.equal(matches[0].away_name, 'RA');
  assert.equal(matches[0].league, 'ECL Season 48', '不按主观赛事等级丢弃赛程');
  assert.equal(matches[0].round, 'Bo3');
  assert.match(matches[0].home_badge, /128px-NAVI/);
}

{
  const url = new URL(buildPandaScoreMatchesUrl({ from: '2026-09-20T00:00:00.000Z', to: '2026-09-29T00:00:00.000Z' }));
  assert.equal(url.searchParams.get('per_page'), '100');
  assert.equal(url.searchParams.get('range[begin_at]'), '2026-09-20T00:00:00.000Z,2026-09-29T00:00:00.000Z');
  const match = normalizePandaScoreMatch({
    id: 88, begin_at: '2026-09-20T12:00:00Z', status: 'not_started', number_of_games:3,
    opponents:[{ opponent:{ id:1, name:'Natus Vincere', acronym:'NAVI', image_url:'navi.png' } }, { opponent:{ id:2, name:'Rare Atom', acronym:'RA', image_url:'ra.png' } }],
    league:{ name:'ESL Pro League' }, serie:{ full_name:'Season 22' }, tournament:{ name:'Group A' }, results:[],
  });
  assert.equal(match.id, 'ps-88');
  assert.equal(match.round, 'Bo3');
  assert.equal(match.provider, 'pandascore');
  assert.match(match.league, /ESL Pro League/);
}

{
  let auth = '';
  const provider = createPandaScoreProvider('secret', async (url, init) => {
    auth = init.headers.Authorization;
    assert.match(String(url), /api\.pandascore\.co\/csgo\/matches/);
    return { ok:true, json:async () => [] };
  });
  const rows = await provider.getMatches({ limit:100 });
  assert.equal(auth, 'Bearer secret');
  assert.deepEqual(rows, []);
}

{
  const service = createSportsService({ liquipedia: { getMatches: async ({ limit }) => {
    assert.equal(limit, 200);
    return [{ id: 'one' }];
  } } });
  const result = await service.listCS2Matches({ scope: 'all' });
  assert.equal(result.matches.length, 1);
  assert.equal(result.coverage.limit, 200);
  assert.equal(result.attribution.license, 'CC BY-SA 3.0');
  await assert.rejects(() => service.listCS2Matches({ scope: 'unknown' }), e => e.code === 'VALIDATION_ERROR');
}

{
  let lpCalls = 0;
  const service = createSportsService({
    pandascore: { configured:true, getMatches:async () => [{ id:'ps-one' }] },
    liquipedia: { getMatches:async () => { lpCalls++; return []; } },
  });
  const result = await service.listCS2Matches();
  assert.equal(result.provider, 'pandascore');
  assert.equal(result.matches[0].id, 'ps-one');
  assert.equal(lpCalls, 0, 'PandaScore 成功时不请求有限降级源');
}

{
  const service = createSportsService({
    pandascore: { configured:true, getMatches:async () => { throw new Error('quota'); } },
    liquipedia: { getMatches:async () => [{ id:'lp-fallback' }] },
  });
  const result = await service.listCS2Matches();
  assert.equal(result.provider, 'liquipedia');
  assert.equal(result.degraded, 'pandascore-error');
}

{
  const realFetch = globalThis.fetch;
  let requested = '';
  let authorization = '';
  globalThis.fetch = async (url, init) => {
    requested = String(url);
    authorization = init.headers.Authorization;
    assert.equal(init.cf.cacheTtl, 300);
    return { ok:true, json:async () => [{
      id:99, begin_at:'2026-09-20T12:00:00Z', status:'not_started', number_of_games:3,
      opponents:[{ opponent:{ id:1, acronym:'NAVI' } }, { opponent:{ id:2, acronym:'RA' } }],
      league:{ name:'ESL Pro League' }, serie:{ full_name:'Season 22' }, tournament:{ name:'Group A' }, results:[],
    }] };
  };
  try {
    const response = await onRequestGet({
      request:new Request('http://localhost/api/v1/sports/cs2/matches?scope=all'),
      env:{ PANDASCORE_TOKEN:'unit-test-only' },
    });
    const body = await response.json();
    assert.equal(body.success, true);
    assert.equal(body.data.provider, 'pandascore');
    assert.equal(body.data.matches[0].id, 'ps-99');
    assert.match(requested, /api\.pandascore\.co\/csgo\/matches/);
    assert.equal(authorization, 'Bearer unit-test-only', 'Function 必须从 context.env 读取 Secret 后放入服务端 Authorization');
  } finally {
    globalThis.fetch = realFetch;
  }
}

{
  const realFetch = globalThis.fetch;
  let requested = '';
  globalThis.fetch = async (url, init) => {
    requested = String(url);
    assert.equal(init.cf.cacheTtl, 900);
    assert.equal(init.headers['Accept-Encoding'], 'gzip');
    return { ok: true, json: async () => ({ parse: { text: { '*': html } } }) };
  };
  try {
    const response = await onRequestGet({ request: new Request('http://localhost/api/v1/sports/cs2/matches?scope=all') });
    const body = await response.json();
    assert.equal(body.success, true);
    assert.equal(body.data.matches.length, 1);
    assert.equal(body.data.coverage.limit, 200);
    assert.equal(body.data.attribution.name, 'Liquipedia');
    assert.match(decodeURIComponent(requested), /limit=200/);
  } finally {
    globalThis.fetch = realFetch;
  }
}

console.log('sports-v1.test: 全部通过');
