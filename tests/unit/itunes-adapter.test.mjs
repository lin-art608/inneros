// ARCH-011 单元测试：iTunes Adapter 标准映射（纯函数，不发网络请求）
// 运行：node tests/unit/itunes-adapter.test.mjs
import assert from 'node:assert/strict';
import { mapTrack } from '../../functions/_adapters/itunes-adapter.js';

// 1) 完整 track → 标准 Media（字段映射 + artwork 升 600 + 原始字段只进 providerMetadata）
const track = mapTrack({
  trackId: 1624001324,
  trackName: '稻香',
  artistName: '周杰伦',
  collectionName: '魔杰座',
  releaseDate: '2008-10-14T12:00:00Z',
  primaryGenreName: '国语流行',
  artworkUrl100: 'https://is1.mzstatic.com/image/thumb/x/100x100bb.jpg',
  previewUrl: 'https://audio.itunes.apple.com/preview.m4a',
  trackPrice: 1.0,
  currency: 'CNY',
  trackTimeMillis: 223453,
});
assert.equal(track.externalId, '1624001324');
assert.equal(track.mediaType, 'music');
assert.equal(track.source, 'itunes');
assert.equal(track.title, '稻香');
assert.deepEqual(track.creators, ['周杰伦']);
assert.deepEqual(track.genres, ['国语流行']);
assert.equal(track.releaseDate, '2008-10-14');
assert.equal(track.poster, 'https://is1.mzstatic.com/image/thumb/x/600x600bb.jpg', 'artworkUrl100 应升为 600');
assert.equal(track.score, null, 'iTunes 无评分 → null');
assert.equal(track.description, '', 'iTunes 无简介 → 空串');
// 原始字段只进 providerMetadata，不泄漏到顶层
assert.ok(!('trackPrice' in track) && !('previewUrl' in track) && !('collectionName' in track), '原始字段不得泄漏到顶层');
assert.equal(track.providerMetadata.album, '魔杰座');
assert.equal(track.providerMetadata.previewUrl, 'https://audio.itunes.apple.com/preview.m4a');
assert.equal(track.providerMetadata.trackPrice, 1.0);
assert.equal(track.providerMetadata.currency, 'CNY');
assert.equal(track.providerMetadata.trackTimeMillis, 223453);

// 2) 缺字段兜底：空 title/artist/album 均不抛错，返回空串/空数组
const sparse = mapTrack({});
assert.equal(sparse.externalId, '');
assert.equal(sparse.title, '');
assert.deepEqual(sparse.creators, []);
assert.deepEqual(sparse.genres, []);
assert.equal(sparse.poster, '');
assert.equal(sparse.providerMetadata.album, '');
assert.equal(sparse.providerMetadata.trackPrice, null);

// 3) artwork 缺失时不抛错（空串 replace 安全）
const noArt = mapTrack({ trackId: 1, trackName: 'T', artistName: 'A' });
assert.equal(noArt.poster, '');

console.log('itunes-adapter.test: 全部通过');
