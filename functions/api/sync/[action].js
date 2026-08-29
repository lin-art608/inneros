// /api/sync/[action] —— push（本机操作批量上报）| pull（增量回放）
// 操作日志协议：每笔本地改动是一个 operation，op_id 全局唯一 → 幂等；
// 服务端按 seq 单调编号，各设备用 last_seq 游标增量拉取其他设备的操作。
// 冲突规则：追加条目永不冲突；元数据新者胜但败方数据保留进 _conflicts 并标 conflict=1；
//          删除墓碑优先（updated_at >= 才生效），删除不会被旧快照复活。

import { ensureSchema, json, requireUser } from '../../_lib.js';

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

  return json({ ok: true, applied, skipped, errors, last_seq: maxRow.m });
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

// ---- 单个操作的落地 ----
async function applyOp(db, userId, kind, entityId, payload) {
  const now = new Date().toISOString();
  if (kind === 'upsert_memory') {
    // payload: { kind:'memory'|'team', data:{...}, updated_at, deleted }
    const dataStr = JSON.stringify(payload.data || {});
    const updatedAt = String(payload.updated_at || now);
    const ex = await db.prepare('SELECT data, updated_at FROM memories WHERE id = ? AND user_id = ?').bind(entityId, userId).first();
    if (!ex) {
      await db.prepare('INSERT INTO memories(id, user_id, kind, data, deleted, updated_at) VALUES(?,?,?,?,?,?)')
        .bind(entityId, userId, payload.kind || 'memory', dataStr, payload.deleted ? 1 : 0, updatedAt).run();
      return;
    }
    if (updatedAt > ex.updated_at) {
      // 新者胜；败方若内容不同则保留进 _conflicts（双版本可查，不静默丢弃）
      let finalData = payload.data || {};
      let conflict = 0;
      if (ex.data !== dataStr) {
        const exData = safeParse(ex.data);
        finalData = { ...(payload.data || {}), _conflicts: [...(exData._conflicts || []), { data: exData, updated_at: ex.updated_at }] };
        conflict = 1;
      }
      await db.prepare('UPDATE memories SET data = ?, deleted = ?, updated_at = ?, conflict = ? WHERE id = ? AND user_id = ?')
        .bind(JSON.stringify(finalData), payload.deleted ? 1 : 0, updatedAt, conflict, entityId, userId).run();
    } else if (updatedAt < ex.updated_at) {
      // 来的是旧版本：把旧版本内容存进 _conflicts 保留，不覆盖已有较新数据
      const exData = safeParse(ex.data);
      if (exData !== payload.data && JSON.stringify(exData) !== JSON.stringify(payload.data || {})) {
        const conflicts = [...(payload.data?._conflicts || []), { data: payload.data || {}, updated_at: updatedAt }];
        await db.prepare('UPDATE memories SET data = ?, conflict = 1 WHERE id = ? AND user_id = ?')
          .bind(JSON.stringify({ ...exData, _conflicts: [...(exData._conflicts || []), ...conflicts] }), entityId, userId).run();
      }
    }
    return;
  }

  if (kind === 'append_entry') {
    // payload: { memory_id, entry:{ id, content, photo_ids, created_at } }
    const entry = payload.entry || {};
    const entryId = String(entry.id || '');
    const memoryId = String(payload.memory_id || entityId);
    if (!entryId || !memoryId) throw new Error('append_entry 缺少 entry.id/memory_id');
    // 确保父记忆存在（客户端保证先 push upsert_memory；容错兜底建空壳）
    const memExists = await db.prepare('SELECT 1 FROM memories WHERE id = ? AND user_id = ?').bind(memoryId, userId).first();
    if (!memExists) {
      await db.prepare('INSERT INTO memories(id, user_id, kind, data, deleted, updated_at) VALUES(?,?,?,?,0,?)')
        .bind(memoryId, userId, 'memory', '{}', entry.created_at || now).run();
    }
    // 只追加：同 id 重复推送直接跳过（幂等），永不覆盖已有内容
    await db.prepare('INSERT OR IGNORE INTO memory_entries(id, memory_id, user_id, content, photo_ids, created_at) VALUES(?,?,?,?,?,?)')
      .bind(entryId, memoryId, userId, String(entry.content || ''), JSON.stringify(entry.photo_ids || []), entry.created_at || now).run();
    return;
  }

  if (kind === 'delete_memory') {
    // 墓碑优先：updated_at >= 现有才生效，删除不会被旧快照复活
    await db.prepare('UPDATE memories SET deleted = 1, updated_at = ? WHERE id = ? AND user_id = ? AND updated_at <= ?')
      .bind(String(payload.updated_at || now), entityId, userId, String(payload.updated_at || now)).run();
    return;
  }

  if (kind === 'delete_entry') {
    await db.prepare('UPDATE memory_entries SET deleted = 1 WHERE id = ? AND user_id = ?')
      .bind(entityId, userId).run();
    return;
  }

  if (kind === 'upsert_attachment') {
    // payload: { memory_id, bytes, hash, mime, data(base64), created_at }
    await db.prepare(`INSERT INTO attachments(id, memory_id, user_id, bytes, hash, mime, data, created_at)
      VALUES(?,?,?,?,?,?,?,?)
      ON CONFLICT(id) DO UPDATE SET data = excluded.data, bytes = excluded.bytes, hash = excluded.hash, mime = excluded.mime`)
      .bind(entityId, String(payload.memory_id || ''), userId, payload.bytes || 0, payload.hash || '', payload.mime || '', String(payload.data || ''), payload.created_at || now).run();
    return;
  }

  throw new Error('未知操作类型 ' + kind);
}

function safeParse(s) { try { return JSON.parse(s); } catch (e) { return {}; } }
