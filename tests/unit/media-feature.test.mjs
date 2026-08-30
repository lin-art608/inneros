// V1.16.1 前端媒体数据层单测（ARCH-012 收口 / 文档 P1「v1 成功不触发 fallback」）
// 用 node vm 加载 src/features/media.js（IIFE 挂 window.InnerOSMedia），mock InnerOSApi 与 fetch，
// 验证：主链 v1 成功时绝不触发 fallback（fetch 不被调用）；v1 失败时才走 fallback。
// 运行：node tests/unit/media-feature.test.mjs
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const src = readFileSync(join(__dirname, '../../src/features/media.js'), 'utf-8');

// 构造一个可运行 media.js 的沙箱，返回 { InnerOSMedia, fetchCalls, getCalls }
function load({ getImpl }) {
  const state = { fetchCalls: [], getCalls: [] };
  const sandbox = {
    window: {
      InnerOSApi: {
        get: async (path) => { state.getCalls.push(path); return getImpl(path); },
      },
    },
    // 记录每次 fetch 的完整 URL，供断言“fallback 是否触发、URL 是否正确”
    fetch: async (url) => { state.fetchCalls.push(String(url)); return { ok: true, json: async () => ({ results: [], items: [] }) }; },
    encodeURIComponent: encodeURIComponent,
    console: { warn: () => {} },
  };
  sandbox.globalThis = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(src, sandbox);
  return { InnerOSMedia: sandbox.window.InnerOSMedia, ...state };
}

// 标准 Media 的 mock（v1 成功返回形状）
const okItem = (mediaType) => ({
  externalId: '1', mediaType, source: mediaType === 'music' ? 'itunes' : 'douban', title: '测试',
  originalTitle: '', poster: '', releaseDate: '2020-01-01', creators: ['作者'], genres: ['剧情'],
  score: 9.0, description: '简介', providerMetadata: {},
});
const okGet = (items) => async () => ({ data: { items } });

// 1) v1 movie 成功 → 绝不触发 fallback（fetch 不被调用）
{
  const m = load({ getImpl: okGet([okItem('movie')]) });
  const r = await m.InnerOSMedia.searchMovie('星际穿越');
  assert.equal(r.length, 1);
  assert.equal(r[0].title, '测试');
  assert.equal(m.fetchCalls.length, 0, 'v1 电影成功时不得触发 fallback fetch');
}

// 2) v1 book 成功 → 绝不触发 fallback
{
  const m = load({ getImpl: okGet([okItem('book')]) });
  const r = await m.InnerOSMedia.searchBook('百年孤独');
  assert.equal(r.length, 1);
  assert.equal(m.fetchCalls.length, 0, 'v1 书籍成功时不得触发 fallback fetch');
}

// 3) v1 music 成功 → 绝不触发 fallback
{
  const m = load({ getImpl: okGet([okItem('music')]) });
  const r = await m.InnerOSMedia.searchMusic('稻香');
  assert.equal(r.length, 1);
  assert.equal(m.fetchCalls.length, 0, 'v1 音乐成功时不得触发 fallback fetch');
}

// 4) v1 movie 失败 → 走 fallback（fetch 被调用，且 URL 指向 legacy /api/douban，而非 iTunes）
{
  const m = load({ getImpl: async () => { throw new Error('v1 down'); } });
  await m.InnerOSMedia.searchMovie('星际穿越');
  assert.equal(m.fetchCalls.length, 1, 'v1 失败时应触发 fallback');
  assert.ok(m.fetchCalls[0].startsWith('/api/douban?type=movie'), '电影 fallback 应指向 /api/douban，而非 iTunes');
}

// 5) v1 music 失败 → 走 fallback（fetch 指向 iTunes）
{
  const m = load({ getImpl: async () => { throw new Error('v1 down'); } });
  await m.InnerOSMedia.searchMusic('稻香');
  assert.equal(m.fetchCalls.length, 1, 'v1 音乐失败时应触发 fallback');
  assert.ok(m.fetchCalls[0].includes('itunes.apple.com'), '音乐 fallback 应指向 iTunes');
}

// 6) enrichWorkDetail：v1 详情成功 → 不触发 fallback
{
  const m = load({ getImpl: okGet([]) });
  // detail 走 getImpl 但返回 shape 不同；这里重载 getImpl 让 detail 成功
  const m2 = load({ getImpl: async () => ({ data: okItem('movie') }) });
  const d = await m2.InnerOSMedia.enrichWorkDetail('movie', { external_id: '1' });
  assert.equal(d.title, '测试');
  assert.equal(m2.fetchCalls.length, 0, 'v1 详情成功时不得触发 fallback');
}

// 7) mediaToWorkFields 三种类型字段映射不回归（复用 ARCH-012 验证）
{
  const m = load({ getImpl: okGet([]) });
  const movie = m.InnerOSMedia.mediaToWorkFields({ externalId: '1889243', mediaType: 'movie', source: 'douban', title: '星际穿越', creators: ['诺兰'], genres: ['剧情'], score: 9.4, description: '', providerMetadata: { runtime: 169 } }, 'movie');
  assert.equal(movie.director, '诺兰');
  assert.equal(movie.runtime, 169);
  const music = m.InnerOSMedia.mediaToWorkFields({ externalId: '1', mediaType: 'music', source: 'itunes', title: '稻香', creators: ['周杰伦'], genres: ['国语流行'], providerMetadata: { album: '魔杰座' } }, 'music');
  assert.equal(music.artist, '周杰伦');
  assert.equal(music.album, '魔杰座');
}

console.log('media-feature.test: 全部通过（7 组）');
