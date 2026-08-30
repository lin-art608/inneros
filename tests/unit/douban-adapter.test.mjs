// ARCH-006 单元测试：豆瓣 Adapter 标准映射（纯函数，不发网络请求）
// 运行：node tests/unit/douban-adapter.test.mjs
import assert from 'node:assert/strict';
import { mapSuggestItem, mapMovieDetail, mapBookDetail } from '../../functions/_adapters/douban-adapter.js';

// 1) suggest → 标准搜索条目
const item = mapSuggestItem({ id: 35593344, title: '奥本海默', sub_title: 'Oppenheimer', img: 'https://img/p.jpg', year: '2023', url: 'https://movie.douban.com/subject/35593344/' });
assert.equal(item.externalId, '35593344');
assert.equal(item.title, '奥本海默');
assert.equal(item.originalTitle, 'Oppenheimer');
assert.equal(item.poster, 'https://img/p.jpg');
assert.equal(item.year, '2023');
assert.equal(item.source, 'douban');
assert.deepEqual(item.creators, []);

// 2) 电影详情 → 标准详情（rexxar 原始字段不泄漏到顶层）
const movie = mapMovieDetail({
  id: 35593344, title: '奥本海默', original_title: 'Oppenheimer',
  cover_url: 'https://img/c.jpg', pubdate: ['2023-08-30(中国大陆)'], year: 2023,
  directors: [{ name: '克里斯托弗·诺兰' }], actors: [{ name: '基里安·墨菲' }],
  genres: ['传记', '历史'], rating: { value: 8.8 }, intro: '简介正文',
  durations: ['180分钟'], card_subtitle: '副标题',
}, '35593344');
assert.equal(movie.title, '奥本海默');
assert.deepEqual(movie.creators, ['克里斯托弗·诺兰', '基里安·墨菲']);
assert.equal(movie.score, 8.8);
assert.equal(movie.providerMetadata.runtime, 180);
assert.equal(movie.providerMetadata.subtitle, '副标题');
assert.equal(movie.description, '简介正文');
assert.ok(!('card_subtitle' in movie), '原始字段不得泄漏到顶层');

// 3) 书籍详情 → 标准详情（press 缺失时回退 card_subtitle 解析）
const book = mapBookDetail({
  id: 6082808, title: '百年孤独', author: ['[哥伦比亚] 加西亚·马尔克斯'], translator: ['范晔'],
  cover_url: 'https://img/b.jpg', pubdate: ['2011-6'], rating: { value: 9.3 }, intro: '魔幻现实主义代表作',
  pages: ['360'], card_subtitle: '[哥伦比亚] 加西亚·马尔克斯 / 南海出版公司 / 2011-6 / 39.50元',
}, '6082808');
assert.equal(book.externalId, '6082808');
assert.equal(book.providerMetadata.publisher, '南海出版公司');
assert.equal(book.providerMetadata.pageCount, 360);
assert.equal(book.providerMetadata.translator, '范晔');
assert.equal(book.score, 9.3);

console.log('douban-adapter.test: 全部通过');
