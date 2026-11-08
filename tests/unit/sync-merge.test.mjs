// V1.32 同步合并纯逻辑单测：防止「旧快照覆盖新条目」与「upsert 夹带照片原图」回归。
// 运行：node tests/unit/sync-merge.test.mjs
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const sandbox = { window: {} };
sandbox.globalThis = sandbox;
vm.createContext(sandbox);
vm.runInContext(readFileSync(join(here, '../../src/features/sync-merge.js'), 'utf8'), sandbox);
const M = sandbox.window.InnerOSSyncMerge;
assert.ok(M && typeof M.mergeMemory === 'function', '模块必须挂到 window.InnerOSSyncMerge');

// 1) 上传快照：entries / photos / data URL 一律不进 upsert
{
  const rec = {
    id: 'm1', type: 'diary', title: '雨天', created_at: '2026-09-01T10:00:00Z', updated_at: '2026-09-01T10:00:00Z',
    entries: [{ id: 'e1', content: '很长很长', photos: ['data:image/jpeg;base64,AAAA'] }],
    photos: ['data:image/jpeg;base64,BBBB'],
    poster: 'https://img.example/p.jpg',
    cover: 'data:image/png;base64,CCCC',
    _conflicts: [{ data: { title: '旧' } }],
  };
  const slim = M.slimMemory(rec);
  assert.equal(slim.entries, undefined, 'entries 不能进 upsert');
  assert.equal(slim.photos, undefined, '记录级 photos 不能进 upsert');
  assert.equal(slim._conflicts, undefined, '_conflicts 不能进 upsert');
  assert.equal(slim.cover, undefined, 'data URL 字段必须剔除');
  assert.equal(slim.title, '雨天');
  assert.equal(slim.poster, 'https://img.example/p.jpg', '正常 URL 保留');
  assert.ok(JSON.stringify(slim).length < 300, '快照必须足够小（不含 base64）');
}

// 2) 远端旧快照不能抹掉本地条目（事故根因回归）
{
  const local = { id: 'm1', type: 'diary', title: '雨天', entries: [{ id: 'e1' }, { id: 'e2' }], updated_at: '2026-09-02T00:00:00Z' };
  const incoming = { type: 'diary', title: '雨天（新）', entries: [{ id: 'e1' }] };
  const merged = M.mergeMemory(local, incoming, '2026-09-02T00:00:00Z');
  assert.equal(merged.entries.length, 2, '本地较新的篇章必须保留');
  assert.deepEqual(merged.entries.map(e => e.id), ['e1', 'e2']);
  assert.equal(merged.title, '雨天（新）', '元数据按远端更新');
}

// 3) 本地没有记录：允许用远端快照兜底
{
  const merged = M.mergeMemory(null, { type: 'movie', title: '沙丘2', entries: [{ id: 'e1', content: '好看' }] }, '2026-09-01T00:00:00Z');
  assert.equal(merged.id, undefined);
  assert.equal(merged.entries.length, 1);
  assert.equal(merged.updated_at, '2026-09-01T00:00:00Z');
}

// 4) 本地比远端新（尚未推送成功）：不被旧元数据覆盖
{
  const local = { id: 'm1', title: '新标题', entries: [{ id: 'e1' }], updated_at: '2026-09-05T00:00:00Z' };
  const merged = M.mergeMemory(local, { title: '旧标题' }, '2026-09-01T00:00:00Z');
  assert.equal(merged.title, '新标题', '本地更新时不回退');
  assert.equal(merged.entries.length, 1);
}

// 5) 篇章只增不减 + 幂等
{
  let r = M.appendEntry([], { id: 'e1', content: '初记' });
  assert.equal(r.changed, true);
  r = M.appendEntry(r.entries, { id: 'e1', content: '重复' });
  assert.equal(r.changed, false, '同 id 追加必须幂等');
  assert.equal(r.entries.length, 1);
  assert.equal(r.entries[0].content, '初记', '幂等时不能改写已有内容');
}

// 6) update_entry 必须生效（旧客户端完全没处理这种操作）
{
  const r = M.updateEntry([{ id: 'e1', content: '旧' }, { id: 'e2', content: '别的' }], 'e1', '新');
  assert.equal(r.changed, true);
  assert.equal(r.entries[0].content, '新');
  assert.equal(r.entries[1].content, '别的', '只改目标篇章');
  assert.equal(M.updateEntry(r.entries, 'e9', 'x').changed, false);
}

// 7) delete_entry
{
  const r = M.removeEntry([{ id: 'e1' }, { id: 'e2' }], 'e1');
  assert.equal(r.changed, true);
  assert.deepEqual(r.entries.map(e => e.id), ['e2']);
  assert.equal(M.removeEntry([{ id: 'e2' }], 'e1').changed, false);
}

// 8) 附件挂回：按 photo_id 匹配、幂等、无引用时返回 false（调用方暂存重试）
{
  const mem = { id: 'm1', entries: [{ id: 'e1', photo_ids: ['a1'], photos: [] }, { id: 'e2', photo_ids: [], photos: [] }] };
  assert.equal(M.attachPhoto(mem, 'a1', 'data:image/jpeg;base64,AA'), true);
  assert.deepEqual(mem.entries[0].photos, ['data:image/jpeg;base64,AA']);
  assert.equal(M.attachPhoto(mem, 'a1', 'data:image/jpeg;base64,AA'), true, '重复挂载幂等');
  assert.equal(mem.entries[0].photos.length, 1, '同一张照片不能重复');
  assert.equal(M.attachPhoto(mem, 'a9', 'data:image/jpeg;base64,BB'), false, '没有引用该附件的篇章');
}

console.log('sync-merge.test: 全部通过');
