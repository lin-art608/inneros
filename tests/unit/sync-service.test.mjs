// ARCH-008 单元测试：Sync Service（注入 fake repository，无网络/D1）
// 运行：node tests/unit/sync-service.test.mjs
// 覆盖：op_id 幂等、cursor 推进、upsert 冲突（新者胜+败方保留）、
//       删除墓碑优先（旧快照不复活）、append_entry 幂等、pull 排除本机、请求级校验。
import assert from 'node:assert/strict';
import { createSyncService } from '../../functions/_services/sync-service.js';
import * as domain from '../../functions/_domain/memory.js';

// ---- fake MemoryRepository：模拟 D1 语义（新者胜 / 墓碑 / append 幂等）----
function fakeMemoryRepo() {
  const memories = new Map(); // id → { userId, data, updated_at, deleted, conflict }
  const entries = new Map();  // entryId → { memoryId, content, created_at, deleted }
  const attachments = new Map();
  return {
    memories, entries, attachments,
    async getById(userId, id) {
      const m = memories.get(id);
      if (!m || m.userId !== userId) return null;
      return { id, user_id: userId, kind: 'memory', data: JSON.stringify(m.data), deleted: m.deleted, updated_at: m.updated_at };
    },
    async exists(userId, id) {
      const m = memories.get(id);
      return !!(m && m.userId === userId);
    },
    async ensureShell({ userId, id, updatedAt }) {
      if (!memories.has(id)) {
        memories.set(id, { userId, data: {}, updated_at: updatedAt, deleted: 0, conflict: 0 });
      }
    },
    async upsertNewer({ userId, id, data, updatedAt, deleted }) {
      const ex = memories.get(id);
      if (!ex) {
        memories.set(id, { userId, data: data || {}, updated_at: updatedAt, deleted: deleted ? 1 : 0, conflict: 0 });
        return { applied: true, conflict: false };
      }
      if (updatedAt > ex.updated_at) {
        let finalData = data || {};
        let conflict = 0;
        if (JSON.stringify(ex.data) !== JSON.stringify(data || {})) {
          finalData = { ...(data || {}), _conflicts: [...((ex.data || {})._conflicts || []), { data: ex.data, updated_at: ex.updated_at }] };
          conflict = 1;
        }
        ex.data = finalData;
        ex.updated_at = updatedAt;
        ex.deleted = deleted ? 1 : 0;
        ex.conflict = conflict;
        return { applied: true, conflict: conflict === 1 };
      }
      if (updatedAt < ex.updated_at && JSON.stringify(ex.data) !== JSON.stringify(data || {})) {
        // 旧数据落败：只进 _conflicts，不覆盖、不改 deleted（墓碑不被复活）
        ex.data = { ...ex.data, _conflicts: [...((ex.data || {})._conflicts || []), { data: data || {}, updated_at: updatedAt }] };
        ex.conflict = 1;
        return { applied: false, conflict: true };
      }
      return { applied: false, conflict: false };
    },
    async tombstone({ userId, id, updatedAt }) {
      const m = memories.get(id);
      if (!m || m.userId !== userId) return;
      if (String(m.updated_at) <= String(updatedAt)) { m.deleted = 1; m.updated_at = updatedAt; }
    },
    async appendEntry({ userId, memoryId, entry }) {
      await this.ensureShell({ userId, id: memoryId, updatedAt: entry.created_at });
      if (entries.has(entry.id)) return; // INSERT OR IGNORE → 幂等
      entries.set(entry.id, { memoryId, content: entry.content || '', created_at: entry.created_at, deleted: 0 });
    },
    async updateEntryContent({ userId, entryId, content }) {
      const e = entries.get(entryId);
      if (e) e.content = content;
    },
    async deleteEntry({ userId, entryId }) {
      const e = entries.get(entryId);
      if (e) e.deleted = 1;
    },
    async upsertAttachment({ userId, id, memoryId, data }) {
      attachments.set(id, { userId, memoryId, data });
    },
  };
}

// ---- fake OperationRepository：op_id UNIQUE（重复写入抛错，用来抓幂等漏洞）----
function fakeOperationRepo() {
  const ops = [];
  let seq = 0;
  return {
    ops,
    async opExists(userId, opId) { return ops.some(o => o.op_id === opId && o.user_id === userId); },
    async record({ opId, userId, deviceId, kind, entityId, payload, createdAt }) {
      if (ops.some(o => o.op_id === opId)) throw new Error('UNIQUE constraint failed: operations.op_id');
      seq += 1;
      ops.push({ seq, op_id: opId, user_id: userId, device_id: deviceId, kind, entity_id: entityId || '', payload: payload || {}, created_at: createdAt });
    },
    async listSince({ userId, cursor = 0, excludeDeviceId = '', limit = 500 }) {
      return ops
        .filter(o => o.user_id === userId && o.seq > cursor && (!excludeDeviceId || o.device_id !== excludeDeviceId))
        .sort((a, b) => a.seq - b.seq)
        .slice(0, limit);
    },
    async maxSeq(userId) {
      return ops.filter(o => o.user_id === userId).reduce((m, o) => Math.max(m, o.seq), 0);
    },
  };
}

// ---- fake DeviceRepository ----
function fakeDeviceRepo() {
  const devices = new Map(); // deviceId → { userId, name, last_seq }
  return {
    devices,
    async ensureDevice({ deviceId, userId, name = '' }) {
      if (!devices.has(deviceId)) devices.set(deviceId, { userId, name, last_seq: 0 });
    },
    async getCursor(userId, deviceId) {
      const d = devices.get(deviceId);
      return d && d.userId === userId ? d.last_seq : 0;
    },
    async updateCursor({ userId, deviceId, lastSeq }) {
      const d = devices.get(deviceId);
      if (d && d.userId === userId) d.last_seq = lastSeq;
    },
  };
}

function build() {
  const memory = fakeMemoryRepo();
  const operations = fakeOperationRepo();
  const devices = fakeDeviceRepo();
  const svc = createSyncService({
    memoryRepository: memory, operationRepository: operations, deviceRepository: devices, domain,
  });
  return { svc, memory, operations, devices };
}

const USER = 'u1';
const DEV_A = 'device-A';
const DEV_B = 'device-B';

// 1) 基础 push：upsert_memory + append_entry 正常应用
{
  const { svc, memory, devices } = build();
  const r = await svc.push({
    userId: USER, deviceId: DEV_A, deviceName: '手机',
    operations: [
      { op_id: 'op1', kind: 'upsert_memory', entity_id: 'm1', payload: { data: { title: '奥本海默' }, updated_at: '2026-08-30T10:00:00Z' }, created_at: '2026-08-30T10:00:00Z' },
      { op_id: 'op2', kind: 'append_entry', entity_id: 'm1', payload: { memory_id: 'm1', entry: { id: 'e1', content: '好看', created_at: '2026-08-30T10:01:00Z' } }, created_at: '2026-08-30T10:01:00Z' },
    ],
  });
  assert.equal(r.applied, 2);
  assert.equal(r.skipped, 0);
  assert.deepEqual(r.errors, []);
  assert.equal(r.lastSeq, 2);
  assert.equal(memory.memories.get('m1').data.title, '奥本海默');
  assert.equal(memory.entries.size, 1);
  // 设备游标被推进到全库最新 seq
  assert.equal(devices.devices.get(DEV_A).last_seq, 2);
}

// 2) 幂等：同一批 op_id 重放 → 全部 skipped，不重复写入
{
  const { svc, memory } = build();
  const ops = [
    { op_id: 'op1', kind: 'upsert_memory', entity_id: 'm1', payload: { data: { title: 'X' }, updated_at: '2026-08-30T10:00:00Z' }, created_at: '2026-08-30T10:00:00Z' },
    { op_id: 'op2', kind: 'append_entry', entity_id: 'm1', payload: { memory_id: 'm1', entry: { id: 'e1', content: 'a', created_at: '2026-08-30T10:01:00Z' } }, created_at: '2026-08-30T10:01:00Z' },
  ];
  const first = await svc.push({ userId: USER, deviceId: DEV_A, operations: ops });
  const second = await svc.push({ userId: USER, deviceId: DEV_A, operations: ops });
  assert.equal(first.applied, 2);
  assert.equal(second.applied, 0);
  assert.equal(second.skipped, 2);
  assert.equal(memory.entries.size, 1); // append 幂等：没有产生第二条
}

// 3) 未知 kind / 缺字段 → 只该条失败，整批不中断
{
  const { svc } = build();
  const r = await svc.push({
    userId: USER, deviceId: DEV_A,
    operations: [
      { op_id: 'bad1', kind: 'no_such_kind', entity_id: 'x', payload: {} },
      { op_id: 'bad2', kind: 'upsert_memory', entity_id: '', payload: {} }, // 缺 entity_id
      { op_id: 'ok1', kind: 'upsert_memory', entity_id: 'm9', payload: { data: { title: '正常' }, updated_at: '2026-08-30T11:00:00Z' } },
    ],
  });
  assert.equal(r.applied, 1);
  assert.equal(r.errors.length, 2);
}

// 4) 冲突：新者胜，败方数据保留进 _conflicts（不丢）
{
  const { svc, memory } = build();
  await svc.push({ userId: USER, deviceId: DEV_A, operations: [
    { op_id: 'n1', kind: 'upsert_memory', entity_id: 'm2', payload: { data: { title: '新值' }, updated_at: '2026-08-30T12:00:00Z' } },
  ]});
  await svc.push({ userId: USER, deviceId: DEV_B, operations: [
    { op_id: 'n2', kind: 'upsert_memory', entity_id: 'm2', payload: { data: { title: '旧值' }, updated_at: '2026-08-30T11:00:00Z' } },
  ]});
  const row = memory.memories.get('m2');
  assert.equal(row.data.title, '新值');                 // 新者胜
  assert.equal(row.data._conflicts.length, 1);          // 败方保留
  assert.equal(row.data._conflicts[0].data.title, '旧值');
  assert.equal(row.conflict, 1);
}

// 5) 墓碑优先：删除后，更早的旧快照不能复活记录
{
  const { svc, memory } = build();
  await svc.push({ userId: USER, deviceId: DEV_A, operations: [
    { op_id: 'd0', kind: 'upsert_memory', entity_id: 'm3', payload: { data: { title: '待删' }, updated_at: '2026-08-30T09:00:00Z' } },
  ]});
  await svc.push({ userId: USER, deviceId: DEV_A, operations: [
    { op_id: 'd1', kind: 'delete_memory', entity_id: 'm3', payload: { updated_at: '2026-08-30T13:00:00Z' } },
  ]});
  assert.equal(memory.memories.get('m3').deleted, 1);
  // 另一台设备用更早的快照回推 → 不能复活
  await svc.push({ userId: USER, deviceId: DEV_B, operations: [
    { op_id: 'd2', kind: 'upsert_memory', entity_id: 'm3', payload: { data: { title: '旧快照' }, updated_at: '2026-08-30T10:00:00Z' } },
  ]});
  assert.equal(memory.memories.get('m3').deleted, 1);
}

// 6) pull：排除本机；cursor 增量；hasMore 标记
{
  const { svc } = build();
  const ops = [1, 2, 3].map(i => ({
    op_id: 'p' + i, kind: 'upsert_memory', entity_id: 'm' + i,
    payload: { data: { title: 'T' + i }, updated_at: '2026-08-30T1' + i + ':00:00Z' },
  }));
  await svc.push({ userId: USER, deviceId: DEV_A, operations: ops });

  const bySame = await svc.pull({ userId: USER, cursor: 0, deviceId: DEV_A });
  assert.equal(bySame.ops.length, 0);            // 排除来源设备
  const byOther = await svc.pull({ userId: USER, cursor: 0, deviceId: DEV_B });
  assert.equal(byOther.ops.length, 3);           // 其他设备可回放
  assert.equal(byOther.lastSeq, 3);
  assert.equal(byOther.hasMore, false);
  const inc = await svc.pull({ userId: USER, cursor: 2, deviceId: DEV_B });
  assert.equal(inc.ops.length, 1);               // cursor 增量：只返回 seq>2
  assert.equal(inc.ops[0].seq, 3);
}

// 7) 请求级校验：缺 device_id / operations 为空 → 抛错（路由转 400，与旧行为一致）
{
  const { svc } = build();
  let e1 = null; try { await svc.push({ userId: USER, deviceId: '', operations: [] }); } catch (e) { e1 = e; }
  assert.equal(e1.message, '缺少 device_id');
  let e2 = null; try { await svc.push({ userId: USER, deviceId: DEV_A, operations: [] }); } catch (e) { e2 = e; }
  assert.equal(e2.message, 'operations 为空');
}

console.log('sync-service.test: 全部通过');
