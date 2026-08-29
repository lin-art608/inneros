// 共享工具库（下划线开头：Pages Functions 路由忽略此文件）
// 多账户云同步 v2 —— V1.2 §12 合规：D1 免费档、无密钥进代码、无付费服务

// 建表语句：首次使用自动执行（IF NOT EXISTS 幂等），用户无需在控制台手写 SQL
const SCHEMA_STATEMENTS = [
  `CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    email TEXT UNIQUE NOT NULL,
    pass_hash TEXT NOT NULL,
    pass_salt TEXT NOT NULL,
    created_at TEXT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS sessions (
    token TEXT PRIMARY KEY,
    user_id INTEGER NOT NULL,
    expires_at TEXT NOT NULL,
    created_at TEXT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS devices (
    id TEXT PRIMARY KEY,
    user_id INTEGER NOT NULL,
    name TEXT DEFAULT '',
    last_seq INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS memories (
    id TEXT PRIMARY KEY,
    user_id INTEGER NOT NULL,
    kind TEXT NOT NULL DEFAULT 'memory',
    data TEXT NOT NULL DEFAULT '{}',
    deleted INTEGER NOT NULL DEFAULT 0,
    updated_at TEXT NOT NULL,
    conflict INTEGER NOT NULL DEFAULT 0
  )`,
  `CREATE TABLE IF NOT EXISTS memory_entries (
    id TEXT PRIMARY KEY,
    memory_id TEXT NOT NULL,
    user_id INTEGER NOT NULL,
    content TEXT DEFAULT '',
    photo_ids TEXT DEFAULT '[]',
    created_at TEXT NOT NULL,
    deleted INTEGER NOT NULL DEFAULT 0
  )`,
  `CREATE TABLE IF NOT EXISTS attachments (
    id TEXT PRIMARY KEY,
    memory_id TEXT NOT NULL,
    user_id INTEGER NOT NULL,
    bytes INTEGER DEFAULT 0,
    hash TEXT DEFAULT '',
    mime TEXT DEFAULT '',
    data TEXT DEFAULT '',
    created_at TEXT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS operations (
    seq INTEGER PRIMARY KEY AUTOINCREMENT,
    op_id TEXT UNIQUE NOT NULL,
    user_id INTEGER NOT NULL,
    device_id TEXT NOT NULL,
    kind TEXT NOT NULL,
    entity_id TEXT DEFAULT '',
    payload TEXT DEFAULT '{}',
    created_at TEXT NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS idx_memories_user ON memories(user_id, updated_at)`,
  `CREATE INDEX IF NOT EXISTS idx_operations_user_seq ON operations(user_id, seq)`,
  `CREATE INDEX IF NOT EXISTS idx_entries_memory ON memory_entries(memory_id)`,
];

let schemaReady = false;
export async function ensureSchema(db) {
  if (schemaReady) return;
  await db.batch(SCHEMA_STATEMENTS.map(sql => db.prepare(sql)));
  schemaReady = true;
}

// ---- 响应 ----
export function json(obj, status = 200, extraHeaders = {}) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Access-Control-Allow-Origin': '*', ...extraHeaders },
  });
}
export const SESSION_COOKIE = 'inneros_session';
const SESSION_DAYS = 90;

// ---- 密码哈希（PBKDF2-SHA256, 10 万次迭代，每用户独立盐）----
const enc = new TextEncoder();
function bytesToHex(buf) { return [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, '0')).join(''); }
function hexToBytes(hex) { const a = new Uint8Array(hex.length / 2); for (let i = 0; i < a.length; i++) a[i] = parseInt(hex.substr(i * 2, 2), 16); return a; }

export function randomHex(bytes = 32) { return bytesToHex(crypto.getRandomValues(new Uint8Array(bytes))); }

export async function hashPassword(password, saltHex) {
  const key = await crypto.subtle.importKey('raw', enc.encode(password), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt: hexToBytes(saltHex), iterations: 100000 }, key, 256);
  return bytesToHex(bits);
}

// ---- 会话 ----
export function getCookie(request, name) {
  const raw = request.headers.get('Cookie') || '';
  for (const part of raw.split(/;\s*/)) {
    const i = part.indexOf('=');
    if (i > 0 && part.slice(0, i).trim() === name) return decodeURIComponent(part.slice(i + 1));
  }
  return null;
}

export async function createSession(db, userId) {
  const token = randomHex(32);
  const expires = new Date(Date.now() + SESSION_DAYS * 86400e3).toISOString();
  await db.prepare('INSERT INTO sessions(token, user_id, expires_at, created_at) VALUES(?,?,?,?)')
    .bind(token, userId, expires, new Date().toISOString()).run();
  // 不加 Secure：兼容局域网 http 访问（192.168.x 手机调试）；SameSite=Lax 防 CSRF
  const cookie = `${SESSION_COOKIE}=${token}; HttpOnly; SameSite=Lax; Max-Age=${SESSION_DAYS * 86400}; Path=/`;
  return cookie;
}

export async function requireUser(db, request) {
  const token = getCookie(request, SESSION_COOKIE);
  if (!token) return null;
  const row = await db.prepare(
    `SELECT u.id, u.email FROM sessions s JOIN users u ON u.id = s.user_id
     WHERE s.token = ? AND s.expires_at > ?`
  ).bind(token, new Date().toISOString()).first();
  return row || null;
}

export function sessionCookieHeader(db, userId) { return createSession(db, userId); }

export const CLEAR_COOKIE = `${SESSION_COOKIE}=; HttpOnly; SameSite=Lax; Max-Age=0; Path=/`;
