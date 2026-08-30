// /api/admin/[action] —— 管理员后台（仅限站长本人）
// 鉴权：请求头 x-admin-key 必须等于环境变量 ADMIN_KEY（在 CF 后台设置，不进代码）。
// 未配置 ADMIN_KEY 时接口返回 503（功能关闭）。
// overview: 账户列表（邮箱/注册时间/记录数/会话数）；delete-user: 删除账户及其全部云端数据。

import { ensureSchema, json } from '../../_lib.js';

function checkAdmin(context) {
  const key = context.env.ADMIN_KEY;
  if (!key) return { err: json({ error: '管理功能未启用：需在 Cloudflare 环境变量设置 ADMIN_KEY' }, 503) };
  const got = context.request.headers.get('x-admin-key') || '';
  if (got !== key) return { err: json({ error: '管理密钥不对' }, 403) };
  return {};
}

export async function onRequestGet(context) {
  const { request, env } = context;
  if (context.params.action !== 'overview') return json({ error: 'unknown action' }, 404);
  const gate = checkAdmin(context);
  if (gate.err) return gate.err;
  const db = env.DB;
  if (!db) return json({ error: 'D1 未绑定' }, 500);
  await ensureSchema(db);
  const r = await db.prepare(`
    SELECT u.id, u.email, u.created_at,
      (SELECT COUNT(*) FROM memories m WHERE m.user_id = u.id AND m.deleted = 0) AS memories,
      (SELECT COUNT(*) FROM memory_entries e WHERE e.user_id = u.id) AS entries,
      (SELECT COUNT(*) FROM attachments a WHERE a.user_id = u.id) AS attachments,
      (SELECT COUNT(*) FROM sessions s WHERE s.user_id = u.id AND s.expires_at > ?) AS sessions
    FROM users u ORDER BY u.created_at DESC`).bind(new Date().toISOString()).all();
  return json({ ok: true, users: r.results });
}

export async function onRequestPost(context) {
  const { request, env } = context;
  if (context.params.action === 'reset-user') {
    // 清空该账户全部云端数据，但保留账户（注册信息/会话），用于"从零开始"
    const gate = checkAdmin(context);
    if (gate.err) return gate.err;
    const db = env.DB;
    if (!db) return json({ error: 'D1 未绑定' }, 500);
    await ensureSchema(db);
    let body = {};
    try { body = await request.json(); } catch (e) { return json({ error: 'bad json' }, 400); }
    const email = String(body.email || '').trim().toLowerCase();
    const u = await db.prepare('SELECT id FROM users WHERE email = ?').bind(email).first();
    if (!u) return json({ error: '账户不存在' }, 404);
    await db.batch([
      db.prepare('DELETE FROM memories WHERE user_id = ?').bind(u.id),
      db.prepare('DELETE FROM memory_entries WHERE user_id = ?').bind(u.id),
      db.prepare('DELETE FROM attachments WHERE user_id = ?').bind(u.id),
      db.prepare('DELETE FROM operations WHERE user_id = ?').bind(u.id),
      db.prepare('DELETE FROM devices WHERE user_id = ?').bind(u.id),
    ]);
    return json({ ok: true, email });
  }
  if (context.params.action !== 'delete-user') return json({ error: 'unknown action' }, 404);
  const gate = checkAdmin(context);
  if (gate.err) return gate.err;
  const db = env.DB;
  if (!db) return json({ error: 'D1 未绑定' }, 500);
  await ensureSchema(db);
  let body = {};
  try { body = await request.json(); } catch (e) { return json({ error: 'bad json' }, 400); }
  const email = String(body.email || '').trim().toLowerCase();
  const u = await db.prepare('SELECT id FROM users WHERE email = ?').bind(email).first();
  if (!u) return json({ error: '账户不存在' }, 404);
  const uid = u.id;
  // 逐表清除该账户全部云端数据 + 账户本身
  await db.batch([
    db.prepare('DELETE FROM memories WHERE user_id = ?').bind(uid),
    db.prepare('DELETE FROM memory_entries WHERE user_id = ?').bind(uid),
    db.prepare('DELETE FROM attachments WHERE user_id = ?').bind(uid),
    db.prepare('DELETE FROM operations WHERE user_id = ?').bind(uid),
    db.prepare('DELETE FROM devices WHERE user_id = ?').bind(uid),
    db.prepare('DELETE FROM sessions WHERE user_id = ?').bind(uid),
    db.prepare('DELETE FROM users WHERE id = ?').bind(uid),
  ]);
  return json({ ok: true, email });
}
