// ARCH-009 单元测试：Media 领域模型（纯函数，无网络/D1）
// 运行：node tests/unit/media-domain.test.mjs
import assert from 'node:assert/strict';
import { normalizeMedia, validateMedia, mediaToMemoryPatch, MEDIA_TYPES } from '../../functions/_domain/media.js';
import { normalizeMemory } from '../../functions/_domain/memory.js';

// 1) normalizeMedia：字段归一 + 缺省值 + 隔离 providerMetadata
{
  const m = normalizeMedia({
    externalId: '1889243', mediaType: 'movie', source: 'douban', title: '星际穿越',
    originalTitle: 'Interstellar', poster: 'http://img/p.jpg', releaseDate: '2014-11-12(中国大陆)',
    creators: ['克里斯托弗·诺兰'], genres: ['剧情', '科幻'], score: 9.4,
    description: '近未来的地球黄沙遍野……',
    providerMetadata: { runtime: 169, subtitle: '2014 / 美国' },
  });
  assert.equal(m.externalId, '1889243');
  assert.equal(m.title, '星际穿越');
  assert.equal(m.score, 9.4);
  assert.deepEqual(m.genres, ['剧情', '科幻']);
  assert.equal(m.providerMetadata.runtime, 169);
  // providerMetadata 是拷贝，改原对象不应影响归一化结果
  const raw = { title: 'X', providerMetadata: { a: 1 } };
  const mm = normalizeMedia(raw);
  raw.providerMetadata.a = 2;
  assert.equal(mm.providerMetadata.a, 1, 'providerMetadata 必须是拷贝（防止外部字段被就地改写）');
}

// 2) normalizeMedia 兜底：空/非法输入
{
  assert.equal(normalizeMedia(null), null);
  const m = normalizeMedia({ title: '无名' });
  assert.equal(m.externalId, '');
  assert.deepEqual(m.creators, []);
  assert.equal(m.score, null);
}

// 3) validateMedia：缺 title / 未知类型 / score 非数字
{
  assert.equal(validateMedia({ title: '星际穿越', mediaType: 'movie' }).ok, true);
  assert.equal(validateMedia({}).ok, false);
  assert.equal(validateMedia({ title: 'X', mediaType: 'anime' }).ok, false);
  assert.equal(validateMedia({ title: 'X', score: 'abc' }).ok, false);
  assert.ok(MEDIA_TYPES.includes('movie'));
}

// 4) mediaToMemoryPatch（电影）：旧字段 + 标准 media 块 + providerMetadata 三者都在
{
  const patch = mediaToMemoryPatch({
    externalId: '1889243', mediaType: 'movie', source: 'douban', title: '星际穿越',
    originalTitle: 'Interstellar', poster: 'http://img/p.jpg', releaseDate: '2014-11-12(中国大陆)',
    creators: ['克里斯托弗·诺兰', '马修·麦康纳'], genres: ['剧情', '科幻'], score: 9.4,
    description: '简介', providerMetadata: { runtime: 169 },
  }, 'movie');
  assert.equal(patch.type, 'movie');
  assert.equal(patch.title, '星际穿越');
  assert.equal(patch.director, '克里斯托弗·诺兰', '电影的 director 取 creators[0]');
  assert.equal(patch.runtime, 169);
  assert.equal(patch.rating, 9.4);
  assert.equal(patch.poster, 'http://img/p.jpg');
  assert.deepEqual(patch.genres, ['剧情', '科幻']);
  // 标准块
  assert.equal(patch.media.mediaType, 'movie');
  assert.equal(patch.media.source, 'douban');
  assert.equal(patch.media.externalId, '1889243');
  assert.equal(patch.media.providerMetadata.runtime, 169);
}

// 5) mediaToMemoryPatch（书籍）：作者/出版社/ISBN/页数 从 providerMetadata 落到业务字段
{
  const patch = mediaToMemoryPatch({
    externalId: '6082808', mediaType: 'book', source: 'douban', title: '百年孤独',
    creators: ['加西亚·马尔克斯'], rating: null, score: 9.3, description: '简介',
    providerMetadata: { publisher: '南海出版公司', isbn: '9787544253994', pageCount: 360 },
  }, 'book');
  assert.equal(patch.author, '加西亚·马尔克斯');
  assert.equal(patch.publisher, '南海出版公司');
  assert.equal(patch.isbn, '9787544253994');
  assert.equal(patch.page_count, 360);
  assert.equal(patch.book_description, '简介');
}

// 6) 往返：标准 Media → Memory 补丁 → normalizeMemory，标准结构可被读回
{
  const media = {
    externalId: '1889243', mediaType: 'movie', source: 'douban', title: '星际穿越',
    originalTitle: 'Interstellar', poster: 'http://img/p.jpg', releaseDate: '2014-11-12',
    creators: ['克里斯托弗·诺兰'], genres: ['剧情'], score: 9.4, description: '简介',
    providerMetadata: { runtime: 169 },
  };
  const patch = mediaToMemoryPatch(media, 'movie');
  const stored = { id: 'mem-1', ...patch, updated_at: '2026-08-30T20:00:00Z' };
  const norm = normalizeMemory(stored);
  assert.equal(norm.type, 'media', '电影应归一化为 media 类型');
  assert.equal(norm.media.mediaType, 'movie');
  assert.equal(norm.media.externalId, '1889243');
  assert.equal(norm.media.score, 9.4);
  assert.equal(norm.media.poster, 'http://img/p.jpg');
  assert.equal(norm.title, '星际穿越');
  assert.equal(norm.metadata.legacyType, 'movie');
}

// 7) 兼容：没有标准 media 块的老数据仍能从旧字段推导（零迁移）
{
  const legacy = { id: 'old-1', type: 'movie', title: '老片', watch_date: '2026-01-01', director: '某导演', rating: 7.5, genres: ['剧情'] };
  const norm = normalizeMemory(legacy);
  assert.equal(norm.type, 'media');
  assert.equal(norm.media.mediaType, 'movie');
  assert.equal(norm.media.creators[0], '某导演');
  assert.equal(norm.media.score, 7.5);
  assert.equal(norm.occurredAt, '2026-01-01', '旧字段 watch_date 仍映射到 occurredAt');
}

console.log('media-domain.test: 全部通过（7 组）');
