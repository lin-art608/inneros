s = open('functions/api/sync/[action].js', encoding='utf-8').read()

old = """import { ensureSchema, json, requireUser } from '../../_lib.js';"""
new = """import { ensureSchema, json, requireUser } from '../../_lib.js';
import { createMemoryRepository } from '../../_repositories/memory-repository.js';"""
assert old in s, 'import'
s = s.replace(old, new, 1)

old = """  // 注册/更新设备
  await db.prepare('INSERT OR IGNORE INTO devices(id, user_id, name, last_seq, created_at) VALUES(?,?,?,0,?)')
    .bind(deviceId, user.id, deviceName, new Date().toISOString()).run();

  let applied = 0, skipped = 0;
  const errors = [];
  for (const op of ops) {
    const opId = String(op.op_id || '');
    const kind = String(op.kind || '');
    const entityId = String(op.entity_id || '');
    const createdAt = String(op.created_at || new Date().toISOString());
    if (!opId || !kind) { errors.push({ op_id: opId, error: '缺少 op_id/kind' }); continue; }
    try {
      // 幂等：同一 op_id 只应用一次
      const dup = await db.prepare('SELECT 1 FROM operations WHERE op_id = ? AND user_id = ?').bind(opId, user.id).first();
      if (dup) { skipped++; continue; }
      await applyOp(db, user.id, kind, entityId, op.payload || {});
      await db.prepare('INSERT INTO operations(op_id, user_id, device_id, kind, entity_id, payload, created_at) VALUES(?,?,?,?,?,?,?)')
        .bind(opId, user.id, deviceId, kind, entityId, JSON.stringify(op.payload || {}), createdAt).run();
      applied++;
    } catch (e) {
      errors.push({ op_id: opId, error: String(e.message || e).slice(0, 200) });
    }
  }

  // 推进该设备游标到全库最新 seq
  const maxRow = await db.prepare('SELECT COALESCE(MAX(seq), 0) AS m FROM operations WHERE user_id = ?').bind(user.id).first();
  await db.prepare('UPDATE devices SET last_seq = ? WHERE id = ? AND user_id = ?').bind(maxRow.m, deviceId, user.id).run();

  return json({ ok: true, applied, skipped, errors, last_seq: maxRow.m });"""
new = """  // 注册/更新设备
  await db.prepare('INSERT OR IGNORE INTO devices(id, user_id, name, last_seq, created_at) VALUES(?,?,?,0,?)')
    .bind(deviceId, user.id, deviceName, new Date().toISOString()).run();

  const repo = createMemoryRepository(db);
  let applied = 0, skipped = 0;
  const errors = [];
  for (const op of ops) {
    const opId = String(op.op_id || '');
    const kind = String(op.kind || '');
    const entityId = String(op.entity_id || '');
    const createdAt = String(op.created_at || new Date().toISOString());
    if (!opId || !kind) { errors.push({ op_id: opId, error: '缺少 op_id/kind' }); continue; }
    try {
      // 幂等：同一 op_id 只应用一次
      if (await repo.opExists(user.id, opId)) { skipped++; continue; }
      await applyOp(repo, user.id, kind, entityId, op.payload || {});
      await repo.recordOperation({ opId, userId: user.id, deviceId, kind, entityId, payload: op.payload || {}, createdAt });
      applied++;
    } catch (e) {
      errors.push({ op_id: opId, error: String(e.message || e).slice(0, 200) });
    }
  }

  // 推进该设备游标到全库最新 seq
  const lastSeq = await repo.maxSeq(user.id);
  await repo.updateDeviceCursor(user.id, deviceId);

  return json({ ok: true, applied, skipped, errors, last_seq: lastSeq });"""
assert old in s, 'push body'
s = s.replace(old, new, 1)

# applyOp 整体替换（函数为文件最后一个，直接截断到文件尾）
i = s.find('// ---- 单个操作的落地 ----')
assert i > 0, 'applyOp start'
new_fn = """// ---- 单个操作的落地：业务规则在 repository（ARCH-005），此处仅分发 ----
async function applyOp(repo, userId, kind, entityId, payload) {
  const now = new Date().toISOString();
  switch (kind) {
    case 'upsert_memory':
      await repo.upsertNewer({ userId, id: entityId, kind: payload.kind || 'memory', data: payload.data || {}, updatedAt: String(payload.updated_at || now), deleted: !!payload.deleted });
      return;
    case 'append_entry': {
      const entry = payload.entry || {};
      const memoryId = String(payload.memory_id || entityId);
      if (!entry.id || !memoryId) throw new Error('append_entry 缺少 entry.id/memory_id');
      await repo.appendEntry({ userId, memoryId, entry: { id: entry.id, content: entry.content || '', photo_ids: entry.photo_ids || [], created_at: entry.created_at || now } });
      return;
    }
    case 'delete_memory':
      await repo.tombstone({ userId, id: entityId, updatedAt: String(payload.updated_at || now) });
      return;
    case 'delete_entry':
      await repo.deleteEntry({ userId, entryId: entityId });
      return;
    case 'update_entry': {
      const entry = (payload || {}).entry || {};
      if (!entry.id) throw new Error('update_entry 缺少 entry.id');
      await repo.updateEntryContent({ userId, entryId: entry.id, content: entry.content || '' });
      return;
    }
    case 'upsert_attachment': {
      const p = payload || {};
      await repo.upsertAttachment({ userId, id: entityId, memoryId: String(p.memory_id || ''), bytes: p.bytes || 0, hash: p.hash || '', mime: p.mime || '', data: String(p.data || ''), createdAt: p.created_at || now });
      return;
    }
    default:
      throw new Error('未知操作类型 ' + kind);
  }
}

function safeParse(x) { try { return JSON.parse(x); } catch (e) { return {}; } }
"""
s = s[:i] + new_fn
open('functions/api/sync/[action].js', 'w', encoding='utf-8', newline='').write(s)
print('sync refactor OK')
