// ARCH-004 单元测试：Memory 领域模型（归一化/校验/操作校验）
// 运行：node tests/unit/domain-memory.test.mjs
import assert from 'node:assert/strict';
import { normalizeMemory, validateMemory, canonicalType, validateOperation, SYNC_OP_KINDS } from '../../functions/_domain/memory.js';

// 1) 电影（media）旧字段归一化
const movie = normalizeMemory({
  id: 'abc', type: 'movie', title: '奥本海默', watch_date: '2026-08-28', watch_time: '23:26',
  rating: 8.8, genres: ['传记', '历史'], director: '诺兰', poster: 'p.jpg', created_at: '2026-08-28T15:00:00Z', updated_at: '2026-08-29T10:00:00Z',
});
assert.equal(movie.type, 'media');
assert.equal(movie.media.mediaType, 'movie');
assert.equal(movie.occurredAt, '2026-08-28');
assert.equal(movie.occurredTime, '23:26');
assert.equal(movie.media.score, 8.8);
assert.deepEqual(movie.media.creators, ['诺兰']);
assert.equal(movie.updatedAt, '2026-08-29T10:00:00Z');

// 2) 事件归一化：location → places，事件 → event
const ev = normalizeMemory({ id: 'e1', type: 'event', title: '搬家', event_date: '2026-07-28', location: '新家', mood: '平静' });
assert.equal(ev.type, 'event');
assert.equal(ev.occurredAt, '2026-07-28');
assert.deepEqual(ev.places, ['新家']);
assert.equal(ev.metadata.mood, '平静');

// 3) 速记/自定义 → note
assert.equal(canonicalType('quick'), 'note');
assert.equal(canonicalType('custom'), 'note');

// 4) 校验：缺 id / 缺 title+content / 坏时间
assert.equal(validateMemory({ id: 'x', title: 't' }).ok, true);
assert.equal(validateMemory({ id: 'x' }).ok, false);
assert.equal(validateMemory({ id: 'x', title: 't', occurredAt: 'bad-date' }).ok, false);

// 5) 同步操作校验
assert.equal(validateOperation({ op_id: 'o1', kind: 'upsert_memory', entity_id: 'm1' }).ok, true);
assert.equal(validateOperation({ op_id: 'o1', kind: 'hack', entity_id: 'm1' }).ok, false);
assert.equal(validateOperation({ kind: 'append_entry' }).ok, false);
assert.deepEqual(SYNC_OP_KINDS.includes('update_entry'), true);

console.log('domain-memory.test: 全部通过');
