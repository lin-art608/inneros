// /api/sync/[action] —— push（本机操作批量上报）| pull（增量回放）
// 操作日志协议：每笔本地改动是一个 operation，op_id 全局唯一 → 幂等；
// 服务端按 seq 单调编号，各设备用 last_seq 游标增量拉取其他设备的操作。
// 冲突规则：追加条目永不冲突；元数据新者胜但败方数据保留进 _conflicts 并标 conflict=1；
//          删除墓碑优先（updated_at >= 才生效），删除不会被旧快照复活。

import { ensureSchema, json, requireUser } from '../../_lib.js';
import { createMemoryRepository } from '../../_repositories/memory-repository.js';

const MAX_OPS_PER_PUSH = 200;
const MAX_OPS_PER_PULL = 500;

export async function onRequestPost(context) {
  const { request, env } = context;
  const db = env.DB;
  if (!db) return json({ error: 'D1 数据库未绑定' }, 500);
  const user = await requireUser(db, request);
  if (!user) return json({ error: '未登录或会话过期' }, 401);
  await ensureSchema(db);

  const action = context.params.action;
  if (action !== 'push') return json({ error: 'unknown action' }, 404);

  let body;
  try { body = await request.json(); } catch (e) { return json({ error: 'bad json' }, 400); }
  const deviceId = String(body.device_id || '');
  const deviceName = String(body.device_name || '').slice(0, 60);
  const ops = Array.isArray(body.operations) ? body.operations.slice(0, MAX_OPS_PER_PUSH) : [];
  if (!deviceId) return json({ error: '缺少 device_id' }, 400);
  if (ops.length === 0) return json({ error: 'operations 为空' }, 400);

  // 注册/更新设备
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

  return json({ ok: true, applied, skipped, errors, last_seq: lastSeq });
}

export async function onRequestGet(context) {
  const { request, env } = context;
  const db = env.DB;
  if (!db) return json({ error: 'D1 数据库未绑定' }, 500);
  const user = await requireUser(db, request);
  if (!user) return json({ error: '未登录或会话过期' }, 401);
  await ensureSchema(db);

  const action = context.params.action;
  if (action !== 'pull') return json({ error: 'unknown action' }, 404);
  const url = new URL(request.url);
  const cursor = Math.max(0, parseInt(url.searchParams.get('cursor') || '0', 10) || 0);
  const deviceId = url.searchParams.get('device_id') || '';

  if (deviceId) {
    await db.prepare('INSERT OR IGNORE INTO devices(id, user_id, name, last_seq, created_at) VALUES(?,?,?,0,?)')
      .bind(deviceId, user.id, String(url.searchParams.get('device_name') || '').slice(0, 60), new Date().toISOString()).run();
  }

  // 排除本机已应用的操作（device_id 相同），其余按 seq 回放
  const rows = deviceId
    ? await db.prepare('SELECT seq, op_id, device_id, kind, entity_id, payload, created_at FROM operations WHERE user_id = ? AND seq > ? AND device_id != ? ORDER BY seq LIMIT ?')
        .bind(user.id, cursor, deviceId, MAX_OPS_PER_PULL).all()
    : await db.prepare('SELECT seq, op_id, device_id, kind, entity_id, payload, created_at FROM operations WHERE user_id = ? AND seq > ? ORDER BY seq LIMIT ?')
        .bind(user.id, cursor, MAX_OPS_PER_PULL).all();
  const maxRow = await db.prepare('SELECT COALESCE(MAX(seq), 0) AS m FROM operations WHERE user_id = ?').bind(user.id).first();
  const ops = rows.results.map(r => ({ ...r, payload: safeParse(r.payload) }));
  return json({ ok: true, ops, last_seq: maxRow.m, has_more: rows.results.length === MAX_OPS_PER_PULL });
}

// ---- 单个操作的落地：业务规则在 repository（ARCH-005），此处仅分发 ----
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
