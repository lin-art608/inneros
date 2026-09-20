// ARCH-017：Liquipedia Adapter → Sports Service → /api/v1 路由。
import assert from 'node:assert/strict';
import { buildTickerUrl, parseLiquipediaTicker } from '../../functions/_adapters/liquipedia-adapter.js';
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

