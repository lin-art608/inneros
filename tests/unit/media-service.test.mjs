// ARCH-007 单元测试：Media Service（provider 选择/错误映射；注入 fake provider）
// 运行：node tests/unit/media-service.test.mjs
import assert from 'node:assert/strict';
import { createMediaService } from '../../functions/_services/media-service.js';

// fake douban provider
function fakeDouban(impl = {}) {
  return {
    async search({ type, query }) { if (impl.searchFail) throw new Error('douban down'); return [{ externalId: '1', title: query + ' 电影', source: 'douban' }]; },
    async detail({ type, id }) { if (impl.detailFail) throw new Error('douban detail down'); return { externalId: id, title: '详情', source: 'douban' }; },
  };
}

// 1) movie → douban.search 被选中并标准化
{
  let seen = null;
  const svc = createMediaService({ providers: { douban: { async search(ctx) { seen = ctx; return [{ externalId: '9', title: 'x', source: 'douban' }]; } } } });
  const r = await svc.searchMedia({ type: 'movie', query: '  星际穿越  ' });
  assert.deepEqual(seen, { type: 'movie', query: '星际穿越' });
  assert.equal(r.items[0].title, 'x');
  assert.equal(r.source, 'douban');
}

// 2) book → 同样路由到 douban
{
  const svc = createMediaService({ providers: { douban: fakeDouban() } });
  const r = await svc.searchMedia({ type: 'book', query: '百年孤独' });
  assert.equal(r.items[0].title, '百年孤独 电影');
  assert.equal(r.source, 'douban-book');
}

// 3) query 空白 → VALIDATION_ERROR
{
  const svc = createMediaService({ providers: { douban: fakeDouban() } });
  let e = null;
  try { await svc.searchMedia({ type: 'movie', query: '   ' }); } catch (x) { e = x; }
  assert.equal(e.code, 'VALIDATION_ERROR');
  assert.equal(e.status, 400);
}

// 4) 未知类型（music 未接入）→ 明确拒绝，不落到 provider
{
  let called = false;
  const svc = createMediaService({ providers: { douban: { async search() { called = true; } } } });
  let e = null;
  try { await svc.searchMedia({ type: 'music', query: 'x' }); } catch (x) { e = x; }
  assert.equal(e.code, 'VALIDATION_ERROR');
  assert.ok(e.message.includes('music'));
  assert.equal(called, false);
}

// 5) provider 抛错 → PROVIDER_ERROR 502 且 retryable，原始错误不泄漏
{
  const svc = createMediaService({ providers: { douban: { async search() { throw new Error('secret internal douban crash with key abc123'); } } } });
  let e = null;
  try { await svc.searchMedia({ type: 'movie', query: 'x' }); } catch (x) { e = x; }
  assert.equal(e.code, 'PROVIDER_ERROR');
  assert.equal(e.retryable, true);
  assert.ok(!String(e.message).includes('abc123'), '第三方原始错误不得泄漏');
}

// 6) detail：正常 + 缺 id
{
  const svc = createMediaService({ providers: { douban: fakeDouban() } });
  const d = await svc.getDetail({ type: 'movie', id: '42' });
  assert.equal(d.externalId, '42');
  let e = null;
  try { await svc.getDetail({ type: 'movie', id: '' }); } catch (x) { e = x; }
  assert.equal(e.code, 'VALIDATION_ERROR');
}

console.log('media-service.test: 全部通过');
