// ARCH-008 / ARCH-008.1 单元测试：Sync Service（注入 fake repository，无网络/D1）
// 运行：node tests/unit/sync-service.test.mjs
// 覆盖：op_id 幂等、cursor 推进、upsert 冲突（新者胜+败方保留）、
//       删除墓碑优先（旧快照不复活）、append_entry 幂等、pull 排除本机、请求级校验、
//       Attachment Sync 与幂等、非法操作 code、失败边界（batch 回滚后业务不生效）。
import assert from 'node:assert/strict';
import { createSyncService } from '../../functions/_services/sync-service.js';
import * as domain from '../../functions/_domain/memory.js';

// ---- fake MemoryRepository：模拟 D1 语义（新者胜 / 墓碑 / append 幂等 / attachment upsert）----
// collect 非空时"只生成写入函数不执行"，由 OperationRepository 在事务里统一执行（模拟 db.batch）。
function fakeMemoryRepo() {
  const memories = new Map();
  const entries = new Map();
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
    async ensureShell({ userId, id, updatedAt, collect }) {
      const write = async () => {
        if (!memories.has(id)) memories.set(id, { userId, data: {}, updated_at: updatedAt, deleted: 0, conflict: 0 });
      };
      if (collect) { collect.push(write); return; }
      await write();
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
    async tombstone({ userId, id, updatedAt, collect }) {
      const write = async () => {
        const m = memories.get(id);
        if (!m || m.userId !== userId) return;
        if (String(m.updated_at) <= String(updatedAt)) { m.deleted = 1; m.updated_at = updatedAt; }
      };
      if (collect) { collect.push(write); return; }
      await write();
    },
    async appendEntry({ userId, memoryId, entry, collect }) {
      await this.ensureShell({ userId, id: memoryId, updatedAt: entry.created_at, collect });
      const write = async () => {
        if (entries.has(entry.id)) return; // INSERT OR IGNORE → 幂等
        entries.set(entry.id, { memoryId, content: entry.content || '', created_at: entry.created_at, deleted: 0 });
      };
      if (collect) { collect.push(write); return; }
      await write();
    },
    async updateEntryContent({ userId, entryId, content, collect }) {
      const write = async () => { const e = entries.get(entryId); if (e) e.content = content; };
      if (collect) { collect.push(write); return; }
      await write();
    },
    async deleteEntry({ userId, entryId, collect }) {
      const write = async () => { const e = entries.get(entryId); if (e) e.deleted = 1; };
      if (collect) { collect.push(write); return; }
      await write();
    },
    // ARCH-008.1：附件 upsert（主键幂等 + userId 隔离）
    async upsertAttachment({ userId, id, memoryId, bytes, hash, mime, data, createdAt, collect }) {
      const write = async () => {
        const ex = attachments.get(id);
        if (ex && ex.userId !== userId) return; // 越权写入被忽略（对应 SQL 的 WHERE user_id = excluded.user_id）
        if (ex) { Object.assign(ex, { memoryId, bytes, hash, mime, data }); return; } // 幂等：保留原 created_at
        attachments.set(id, { userId, memoryId, bytes, hash, mime, data, created_at: createdAt });
      };
      if (collect) { collect.push(write); return; }
      await write();
    },
  };
}

// ---- fake OperationRepository：op_id UNIQUE；prepend 语句与 record 同事务执行 ----
function fakeOperationRepo() {
  const ops = [];
  let seq = 0;
  let failNextRecord = false; // 注入"事务提交失败"，用于验证业务不残留
  return {
    ops,
    failNext() { failNextRecord = true; },
    async opExists(userId, opId) { return ops.some(o => o.op_id === opId && o.user_id === userId); },
    async record({ opId, userId, deviceId, kind, entityId, payload, createdAt, prepend = null }) {
      if (ops.some(o => o.op_id === opId)) throw new Error('UNIQUE constraint failed: operations.op_id');
      if (failNextRecord) {
        // 模拟 db.batch 提交失败 → 事务整体回滚，prepend 里的业务语句一律不执行
        failNextRecord = false;
        throw new Error('D1 batch commit failed');
      }
      for (const s of (prepend || [])) await s();
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
  const devices = new Map();
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
  assert.equal(memory.entries.size, 1);
}

// 3) 未知 kind / 缺字段 → 只该条失败，整批不中断，且带稳定 code
{
  const { svc } = build();
  const r = await svc.push({
    userId: USER, deviceId: DEV_A,
    operations: [
      { op_id: 'bad1', kind: 'no_such_kind', entity_id: 'x', payload: {} },
      { op_id: 'bad2', kind: 'upsert_memory', entity_id: '', payload: {} },
      { op_id: 'ok1', kind: 'upsert_memory', entity_id: 'm9', payload: { data: { title: '正常' }, updated_at: '2026-08-30T11:00:00Z' } },
    ],
  });
  assert.equal(r.applied, 1);
  assert.equal(r.errors.length, 2);
  assert.equal(r.errors[0].code, 'VALIDATION_ERROR');
  assert.equal(r.errors[1].code, 'VALIDATION_ERROR');
}

// 4) 冲突：新者胜，败方数据保留进 _conflicts
{
  const { svc, memory } = build();
  await svc.push({ userId: USER, deviceId: DEV_A, operations: [
    { op_id: 'n1', kind: 'upsert_memory', entity_id: 'm2', payload: { data: { title: '新值' }, updated_at: '2026-08-30T12:00:00Z' } },
  ]});
  await svc.push({ userId: USER, deviceId: DEV_B, operations: [
    { op_id: 'n2', kind: 'upsert_memory', entity_id: 'm2', payload: { data: { title: '旧值' }, updated_at: '2026-08-30T11:00:00Z' } },
  ]});
  const row = memory.memories.get('m2');
  assert.equal(row.data.title, '新值');
  assert.equal(row.data._conflicts.length, 1);
  assert.equal(row.data._conflicts[0].data.title, '旧值');
}

// 5) 墓碑优先：删除后，更早的旧快照不能复活
{
  const { svc, memory } = build();
  await svc.push({ userId: USER, deviceId: DEV_A, operations: [
    { op_id: 'd0', kind: 'upsert_memory', entity_id: 'm3', payload: { data: { title: '待删' }, updated_at: '2026-08-30T09:00:00Z' } },
  ]});
  await svc.push({ userId: USER, deviceId: DEV_A, operations: [
    { op_id: 'd1', kind: 'delete_memory', entity_id: 'm3', payload: { updated_at: '2026-08-30T13:00:00Z' } },
  ]});
  assert.equal(memory.memories.get('m3').deleted, 1);
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
  assert.equal(bySame.ops.length, 0);
  const byOther = await svc.pull({ userId: USER, cursor: 0, deviceId: DEV_B });
  assert.equal(byOther.ops.length, 3);
  assert.equal(byOther.hasMore, false);
  const inc = await svc.pull({ userId: USER, cursor: 2, deviceId: DEV_B });
  assert.equal(inc.ops.length, 1);
  assert.equal(inc.ops[0].seq, 3);
}

// 7) 请求级校验：抛 ServiceError（稳定 code + status），不是裸 Error
{
  const { svc } = build();
  let e1 = null; try { await svc.push({ userId: USER, deviceId: '', operations: [] }); } catch (e) { e1 = e; }
  assert.equal(e1.code, 'VALIDATION_ERROR');
  assert.equal(e1.status, 400);
  let e2 = null; try { await svc.push({ userId: USER, deviceId: DEV_A, operations: [] }); } catch (e) { e2 = e; }
  assert.equal(e2.code, 'VALIDATION_ERROR');
}

// 8) ARCH-008.1 Attachment Sync：字段完整落库（payload 契约来自 app.js enqueueAttachments）
{
  const { svc, memory } = build();
  const r = await svc.push({ userId: USER, deviceId: DEV_A, operations: [
    { op_id: 'att1', kind: 'upsert_attachment', entity_id: 'att-uuid-1',
      payload: { memory_id: 'm1', bytes: 12345, hash: '12345-abc', mime: 'image/jpeg', data: 'BASE64DATA', created_at: '2026-08-30T15:00:00Z' } },
  ]});
  assert.equal(r.applied, 1, 'upsert_attachment 应正常应用（此前因缺方法而失败）');
  assert.deepEqual(r.errors, []);
  const att = memory.attachments.get('att-uuid-1');
  assert.ok(att, '附件应落库');
  assert.equal(att.memoryId, 'm1');
  assert.equal(att.mime, 'image/jpeg');
  assert.equal(att.data, 'BASE64DATA');
  assert.equal(att.bytes, 12345);
  assert.equal(att.userId, USER);
}

// 9) ARCH-008.1 附件幂等：同 op 重放 skipped；不同 op 同附件 id → 覆盖更新但只有一条
{
  const { svc, memory } = build();
  const op = { op_id: 'att2', kind: 'upsert_attachment', entity_id: 'att-uuid-2',
    payload: { memory_id: 'm1', bytes: 10, hash: 'h1', mime: 'image/png', data: 'AAA', created_at: '2026-08-30T15:00:00Z' } };
  const first = await svc.push({ userId: USER, deviceId: DEV_A, operations: [op] });
  const again = await svc.push({ userId: USER, deviceId: DEV_A, operations: [op] });
  assert.equal(first.applied, 1);
  assert.equal(again.applied, 0);
  assert.equal(again.skipped, 1, '同一 op_id 重放必须跳过');
  const reupload = await svc.push({ userId: USER, deviceId: DEV_A, operations: [
    { ...op, op_id: 'att3', payload: { ...op.payload, data: 'BBB', bytes: 20 } },
  ]});
  assert.equal(reupload.applied, 1);
  assert.equal(memory.attachments.size, 1, '同一附件 id 重复写入不应产生多条');
  assert.equal(memory.attachments.get('att-uuid-2').data, 'BBB');
  assert.equal(memory.attachments.get('att-uuid-2').created_at, '2026-08-30T15:00:00Z', '幂等更新应保留原 created_at');
}

// 10) ARCH-008.1 附件越权：别的账号的附件 id 不能被覆盖
{
  const { svc, memory } = build();
  await svc.push({ userId: USER, deviceId: DEV_A, operations: [
    { op_id: 'att4', kind: 'upsert_attachment', entity_id: 'att-x', payload: { memory_id: 'm1', data: 'ORIGINAL', mime: 'image/jpeg', created_at: '2026-08-30T15:00:00Z' } },
  ]});
  await svc.push({ userId: 'attacker', deviceId: DEV_B, operations: [
    { op_id: 'att5', kind: 'upsert_attachment', entity_id: 'att-x', payload: { memory_id: 'm1', data: 'HIJACKED', mime: 'image/jpeg', created_at: '2026-08-30T16:00:00Z' } },
  ]});
  assert.equal(memory.attachments.get('att-x').data, 'ORIGINAL', '越权写入必须被忽略');
}

// 11) ARCH-008.1 失败边界：事务提交失败 → 业务不残留，且该条进 errors（code=OPERATION_FAILED）
{
  const { svc, memory, operations } = build();
  operations.failNext();
  const r = await svc.push({ userId: USER, deviceId: DEV_A, operations: [
    { op_id: 'f1', kind: 'append_entry', entity_id: 'mz',
      payload: { memory_id: 'mz', entry: { id: 'ez', content: '不该生效', created_at: '2026-08-30T17:00:00Z' } } },
  ]});
  assert.equal(r.applied, 0, '提交失败不应计入 applied');
  assert.equal(r.errors.length, 1);
  assert.equal(r.errors[0].code, 'OPERATION_FAILED');
  assert.equal(memory.entries.size, 0, '事务回滚后不能残留业务数据（无半截状态）');
  assert.equal(operations.ops.length, 0, 'operation 也不应被记录');
  // 失败后重放同一 op：因未记录 op_id，可安全重试并最终生效
  const retry = await svc.push({ userId: USER, deviceId: DEV_A, operations: [
    { op_id: 'f1', kind: 'append_entry', entity_id: 'mz',
      payload: { memory_id: 'mz', entry: { id: 'ez', content: '重试生效', created_at: '2026-08-30T17:00:00Z' } } },
  ]});
  assert.equal(retry.applied, 1, '未记录 op_id 时重放应能生效');
  assert.equal(memory.entries.size, 1);
}

// 12) ARCH-008.1 附件缺 memory_id → 业务校验失败，带 VALIDATION_ERROR 而非脏数据入库
{
  const { svc, memory } = build();
  const r = await svc.push({ userId: USER, deviceId: DEV_A, operations: [
    { op_id: 'att6', kind: 'upsert_attachment', entity_id: 'att-y', payload: { data: 'NO_MEMORY' } },
  ]});
  assert.equal(r.applied, 0);
  assert.equal(r.errors[0].code, 'OPERATION_FAILED');
  assert.equal(memory.attachments.size, 0, '缺少 memory_id 不应写入附件');
}

console.log('sync-service.test: 全部通过（12 组）');
