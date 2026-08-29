// /api/auth/[action] —— register | login | logout | me
// 邮箱+密码（PBKDF2-SHA256 10 万次迭代），httpOnly 会话 Cookie（90 天）
// 首次请求自动建表（IF NOT EXISTS 幂等），用户无需在 D1 控制台执行 SQL

import { ensureSchema, json, randomHex, hashPassword, getCookie, createSession, requireUser, CLEAR_COOKIE, SESSION_COOKIE } from '../../_lib.js';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export async function onRequestPost(context) {
  const { request, env } = context;
  const db = env.DB;
  if (!db) return json({ error: 'D1 数据库未绑定（CF 后台绑定变量名 DB）' }, 500);
  const action = context.params.action;
  let body = {};
  try { body = await request.json(); } catch (e) { /* 空 body 允许（logout） */ }

  await ensureSchema(db);

  if (action === 'register') {
    const email = String(body.email || '').trim().toLowerCase();
    const password = String(body.password || '');
    if (!EMAIL_RE.test(email)) return json({ error: '邮箱格式不对' }, 400);
    if (password.length < 6) return json({ error: '密码至少 6 位' }, 400);
    const exists = await db.prepare('SELECT 1 FROM users WHERE email = ?').bind(email).first();
    if (exists) return json({ error: '该邮箱已注册' }, 409);
    const salt = randomHex(16);
    const hash = await hashPassword(password, salt);
    const result = await db.prepare('INSERT INTO users(email, pass_hash, pass_salt, created_at) VALUES(?,?,?,?)')
      .bind(email, hash, salt, new Date().toISOString()).run();
    const userId = result.meta.last_row_id;
    const cookie = await createSession(db, userId);
    return json({ ok: true, email }, 200, { 'Set-Cookie': cookie });
  }

  if (action === 'login') {
    const email = String(body.email || '').trim().toLowerCase();
    const password = String(body.password || '');
    const user = await db.prepare('SELECT id, pass_hash, pass_salt FROM users WHERE email = ?').bind(email).first();
    if (!user) return json({ error: '邮箱或密码不对' }, 401);
    const hash = await hashPassword(password, user.pass_salt);
    if (hash !== user.pass_hash) return json({ error: '邮箱或密码不对' }, 401);
    const cookie = await createSession(db, user.id);
    return json({ ok: true, email }, 200, { 'Set-Cookie': cookie });
  }

  if (action === 'logout') {
    const token = getCookie(request, SESSION_COOKIE);
    if (token) await db.prepare('DELETE FROM sessions WHERE token = ?').bind(token).run();
    return json({ ok: true }, 200, { 'Set-Cookie': CLEAR_COOKIE });
  }

  return json({ error: 'unknown action' }, 404);
}

export async function onRequestGet(context) {
  const { request, env } = context;
  const db = env.DB;
  if (!db) return json({ error: 'D1 数据库未绑定' }, 500);
  const action = context.params.action;
  if (action !== 'me') return json({ error: 'unknown action' }, 404);
  await ensureSchema(db);
  const user = await requireUser(db, request);
  if (!user) return json({ error: '未登录或会话过期' }, 401);
  return json({ ok: true, email: user.email, user_id: user.id });
}
