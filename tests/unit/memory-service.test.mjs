// ARCH-007 单元测试：Memory Service（注入 fake repository，无网络/D1）
// 运行：node tests/unit/memory-service.test.mjs
import assert from 'node:assert/strict';
import { createMemoryService } from '../../functions/_services/memory-service.js';
import * as domain from '../../functions/_domain/memory.js';

// 可记忆状态的 fake repository（模拟 D1 行为：upsert 新者胜/幂等 append）
function fakeRepo() {
  const memories = new Map();
  const entries = new Map(); // key: entryId → { memoryId, entry }
  return {
    memories, entries,
    async getById(userId, id) {
      const m = memories.get(id);
      if (!m || m.userId !== userId) return null;
      return { id, user_id: userId, kind: 'memory', data: JSON.stringify(m.data), deleted: 0, updated_at: m.updated_at }; // 与真 D1 一致：data 为 JSON 字符串
    },
    async listByUser(userId, { limit = 100, offset = 0 } = {}) {
      return [...memories.values()].filter(m => m.userId === userId && !m.deleted)
        .sort((a, b) => String(b.updated_at).localeCompare(String(a.updated_at)))
        .slice(offset, offset + limit)
        .map(m => ({ id: m.id, kind: m.kind, data: m.data, updated_at: m.updated_at }));
    },
    async upsertNewer({ userId, id, data, updatedAt, deleted }) {
      const ex = memories.get(id);
      if (ex && updatedAt < ex.updated_at) return { applied: false, conflict: false };
      memories.set(id, { userId, data, updated_at: updatedAt, deleted: !!deleted });
      return { applied: true, conflict: false };
    },
    async tombstone({ userId, id, updatedAt }) {
      const m = memories.get(id); if (m) { m.deleted = 1; m.updated_at = updatedAt; }
    },
    async appendEntry({ userId, memoryId, entry }) {
      entries.set(entry.id, { memoryId, entry });
    },
    async updateEntryContent({ userId, entryId, content }) {
      const e = entries.get(entryId); if (e) e.entry.content = content;
    },
  };
}

const svc = createMemoryService({ repository: fakeRepo(), domain });
const USER = 'u1';

// 1) 创建：正常输入 → 校验通过 → 归一化输出 + 落库
const created = await svc.createMemory({ userId: USER, id: 'm1', input: { type: 'movie', title: '奥本海默', content: '好看', rating: 8.8, occurredAt: '2026-08-28' } });
assert.equal(created.id, 'm1');
assert.equal(created.type, 'media');
assert.equal(created.rating, 8.8);

// 2) 创建：无标题无正文 → VALIDATION_ERROR 400
let caught = null;
try { await svc.createMemory({ userId: USER, id: 'm2', input: { type: 'movie' } }); } catch (e) { caught = e; }
assert.equal(caught.code, 'VALIDATION_ERROR');
assert.equal(caught.status, 400);

// 3) 读取：存在 → 归一化；不存在 → NOT_FOUND 404
const got = await svc.getMemory({ userId: USER, id: 'm1' });
assert.equal(got.title, '奥本海默');
let nf = null;
try { await svc.getMemory({ userId: USER, id: 'missing' }); } catch (e) { nf = e; }
assert.equal(nf.code, 'NOT_FOUND');
assert.equal(nf.status, 404);

// 4) 越权隔离：别的账号看不到
let other = null;
try { await svc.getMemory({ userId: 'someone-else', id: 'm1' }); } catch (e) { other = e; }
assert.equal(other.code, 'NOT_FOUND');

// 5) 追加：空内容+无照片 → 400
let emptyErr = null;
try { await svc.appendEntry({ userId: USER, memoryId: 'm1', entry: { id: 'e0', content: '  ' } }); } catch (e) { emptyErr = e; }
assert.equal(emptyErr.code, 'VALIDATION_ERROR');

// 6) 追加：正常 → 记录
await svc.appendEntry({ userId: USER, memoryId: 'm1', entry: { id: 'e1', content: '第二条感想' } });

// 7) 更新内容：空白拒绝；正常写入
let blank = null;
try { await svc.updateEntryContent({ userId: USER, entryId: 'e1', content: '   ' }); } catch (e) { blank = e; }
assert.equal(blank.code, 'VALIDATION_ERROR');
await svc.updateEntryContent({ userId: USER, entryId: 'e1', content: '第二条感想（已修订）' });

// 8) 删除：墓碑后列表不再出现
await svc.deleteMemory({ userId: USER, id: 'm1' });
const list = await svc.listMemories({ userId: USER });
assert.equal(list.items.length, 0);

// 9) 列表归一化：旧字段 watch_date → occurredAt
const legacyRepo = fakeRepo();
await legacyRepo.upsertNewer({ userId: USER, id: 'old1', data: { type: 'movie', title: '旧片', watch_date: '2026-01-01' }, updatedAt: '2026-01-01T00:00:00Z', deleted: false });
const legacySvc = createMemoryService({ repository: legacyRepo, domain });
const legacyList = await legacySvc.listMemories({ userId: USER });
assert.equal(legacyList.items[0].occurredAt, '2026-01-01');
assert.equal(legacyList.items[0].type, 'media');

console.log('memory-service.test: 全部通过');
