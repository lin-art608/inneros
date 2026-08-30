// ARCH-008.2 集成测试：真实 Route → SyncService → Repository → (内存 D1)
// 运行：node tests/integration/sync-route.test.mjs
// 目的（方案第八节）：证明 /api/sync/push、/api/sync/pull 的真实 API 入口走的是 SyncService，
// 而不是路由内的旧同步编排；单测（fake repository）证明不了这一点。
//
// 原理：直接调用 functions/api/sync/[action].js 导出的 onRequestPost / onRequestGet，
// 传入真实 Request 对象 + 内存 D1 仿真层。仿真层按 SQL 模式逐条处理，
// 遇到未识别的 SQL 立即抛错——这样 D1 schema/查询漂移会让测试大声失败，而不是静默通过。

import assert from 'node:assert/strict';
import { onRequestPost, onRequestGet } from '../../functions/api/sync/[action].js';

const SESSION_COOKIE = 'inneros_session';

// ---------- 内存 D1 仿真层 ----------
function createD1() {
  const users = new Map();       // id → {id, email}
  const sessions = new Map();    // token → {user_id, expires_at}
  const devices = new Map();     // key: `${user_id}:${device_id}`
  const memories = new Map();    // id → {user_id, kind, data(JSON字符串), deleted, updated_at, conflict}
  const entries = new Map();     // id → {memory_id, user_id, content, created_at, deleted}
  const attachments = new Map(); // id → {user_id, memory_id, bytes, hash, mime, data, created_at}
  const operations = [];         // {seq, op_id, user_id, device_id, kind, entity_id, payload(JSON字符串), created_at}
  let seqCounter = 0;
  const executedSql = [];

  const norm = s => s.replace(/\s+/g, ' ').trim();

  async function exec(n, p) {
    executedSql.push(n);
    // schema（ensureSchema 里的 CREATE 语句）→ 忽略
    if (n.startsWith('CREATE ')) return {};

    // 会话鉴权（requireUser）
    if (n.startsWith('SELECT u.id, u.email FROM sessions s JOIN users u')) {
      const s = sessions.get(p[0]);
      if (!s || String(s.expires_at) <= String(p[1])) return { first: null };
      const u = users.get(s.user_id);
      return { first: u ? { id: u.id, email: u.email } : null };
    }

    // 设备（DeviceRepository）
    if (n.startsWith('INSERT OR IGNORE INTO devices')) {
      const key = p[1] + ':' + p[0];
      if (!devices.has(key)) devices.set(key, { id: p[0], user_id: p[1], name: p[2] || '', last_seq: 0 });
      return {};
    }
    if (n.startsWith('SELECT last_seq FROM devices')) {
      const d = devices.get(p[1] + ':' + p[0]);
      return { first: d ? { last_seq: d.last_seq } : null };
    }
    if (n.startsWith('UPDATE devices SET last_seq = ?')) {
      const d = devices.get(p[2] + ':' + p[1]); // bind(lastSeq, deviceId, userId)
      if (d) d.last_seq = p[0];
      return {};
    }

    // 操作日志（OperationRepository）
    if (n.startsWith('SELECT 1 FROM operations WHERE op_id = ? AND user_id = ?')) {
      return { first: operations.some(o => o.op_id === p[0] && o.user_id === p[1]) ? { 1: 1 } : null };
    }
    if (n.startsWith('INSERT INTO operations(')) {
      seqCounter += 1;
      operations.push({ seq: seqCounter, op_id: p[0], user_id: p[1], device_id: p[2], kind: p[3], entity_id: p[4] || '', payload: p[5] || '{}', created_at: p[6] });
      return {};
    }
    if (n.startsWith('SELECT seq, op_id, device_id, kind, entity_id, payload, created_at FROM operations')) {
      const hasDeviceFilter = n.includes('device_id != ?');
      const userId = p[0], cursor = p[1];
      const exclude = hasDeviceFilter ? p[2] : '';
      const limit = hasDeviceFilter ? p[3] : p[2];
      const rows = operations
        .filter(o => o.user_id === userId && o.seq > cursor && (!exclude || o.device_id !== exclude))
        .sort((a, b) => a.seq - b.seq)
        .slice(0, limit);
      return { results: rows.map(o => ({ ...o })) }; // payload 保持字符串，解析在 Repository
    }
    if (n.startsWith('SELECT COALESCE(MAX(seq), 0) AS m FROM operations')) {
      return { first: { m: operations.filter(o => o.user_id === p[0]).reduce((m, o) => Math.max(m, o.seq), 0) } };
    }

    // 记忆（MemoryRepository）
    if (n.startsWith('SELECT id, user_id, kind, data, deleted, updated_at, conflict FROM memories')) {
      const m = memories.get(p[0]);
      if (!m || m.user_id !== p[1]) return { first: null };
      return { first: { id: p[0], user_id: p[1], kind: m.kind, data: m.data, deleted: m.deleted, updated_at: m.updated_at, conflict: m.conflict } };
    }
    if (n.startsWith('INSERT INTO memories(')) {
      memories.set(p[0], { user_id: p[1], kind: p[2] || 'memory', data: p[3] || '{}', deleted: p[4] ? 1 : 0, updated_at: p[5], conflict: 0 });
      return {};
    }
    if (n.startsWith('INSERT OR IGNORE INTO memories(')) {
      if (!memories.has(p[0])) memories.set(p[0], { user_id: p[1], kind: p[2] || 'memory', data: p[3] || '{}', deleted: 0, updated_at: p[4], conflict: 0 });
      return {};
    }
    if (n.startsWith('UPDATE memories SET data = ?')) {
      const m = memories.get(p[4] !== undefined && n.includes('deleted = ?') ? p[4] : p[1]);
      // 两种形态：SET data,deleted,updated_at,conflict (bind 6 个) / SET data,conflict=1 (bind 3 个)
      if (n.includes('deleted = ?')) {
        const m2 = memories.get(p[4]); if (m2 && m2.user_id === p[5]) Object.assign(m2, { data: p[0], deleted: p[1] ? 1 : 0, updated_at: p[2], conflict: p[3] });
      } else {
        const m2 = memories.get(p[1]); if (m2 && m2.user_id === p[2]) m2.data = p[0], m2.conflict = 1;
      }
      return {};
    }
    if (n.startsWith('UPDATE memories SET deleted = 1')) {
      const m = memories.get(p[1]);
      if (m && m.user_id === p[2] && String(m.updated_at) <= String(p[3])) { m.deleted = 1; m.updated_at = p[0]; } // 墓碑：updated_at <= 才生效
      return {};
    }

    // 子条目
    if (n.startsWith('INSERT OR IGNORE INTO memory_entries(')) {
      if (!entries.has(p[0])) entries.set(p[0], { memory_id: p[1], user_id: p[2], content: p[3] || '', created_at: p[5], deleted: 0 });
      return {};
    }
    if (n.startsWith('UPDATE memory_entries SET content = ?')) {
      const e = entries.get(p[1]); if (e && e.user_id === p[2]) e.content = p[0];
      return {};
    }
    if (n.startsWith('UPDATE memory_entries SET deleted = 1')) {
      const e = entries.get(p[1]); if (e && e.user_id === p[2]) e.deleted = 1;
      return {};
    }

    // 附件（ARCH-008.1 upsertAttachment：主键幂等 + userId 隔离，保留原 created_at）
    if (n.startsWith('INSERT INTO attachments(')) {
      const ex = attachments.get(p[0]);
      if (ex && ex.user_id !== p[2]) return {};                       // 越权写入被忽略
      if (ex) Object.assign(ex, { memory_id: p[1], bytes: p[3], hash: p[4], mime: p[5], data: p[6] });
      else attachments.set(p[0], { user_id: p[2], memory_id: p[1], bytes: p[3], hash: p[4], mime: p[5], data: p[6], created_at: p[7] });
      return {};
    }

    throw new Error('集成测试未识别的 SQL（D1 schema/查询已漂移，请同步更新仿真层）：' + n);
  }

  function makeStmt(sql) {
    const n = norm(sql);
    let params = [];
    const stmt = {
      sql: n,
      bind(...p) { params = p; return stmt; },
      async first() { const r = await exec(n, params); return (r && r.first) || null; },
      async all() { const r = await exec(n, params); return { results: (r && r.results) || [] }; },
      async run() { await exec(n, params); return {}; },
      async _exec() { await exec(n, params); },
    };
    return stmt;
  }

  return {
    tables: { users, sessions, devices, memories, entries, attachments, operations: () => operations.slice() },
    prepare: sql => makeStmt(sql),
    async batch(stmts) { for (const s of stmts) await s._exec(); return []; }, // D1 batch 即事务；这里按序执行
    // 测试种子
    seedUser(id, email) { users.set(id, { id, email }); },
    seedSession(token, userId, expiresAt) { sessions.set(token, { user_id: userId, expires_at: expiresAt }); },
  };
}

// ---------- 请求构造 ----------
function makeCtx(request, action, db) {
  return { request, env: { DB: db }, params: { action } };
}
function makeRequest(method, url, { body, cookie } = {}) {
  const headers = new Headers();
  if (cookie) headers.set('Cookie', cookie);
  const init = { method, headers };
  if (body !== undefined) init.body = JSON.stringify(body);
  return new Request(url, init);
}
async function callRoute(db, method, action, { query = '', body, cookie } = {}) {
  // 注意：query 必须与 path 参数分离——CF Pages 里 params.action 只含路径段，
  // 把 '?xxx' 拼进 action 会导致路由 404（测试第一版踩过）。
  const full = `http://localhost:8788/api/sync/${action}${query ? '?' + query : ''}`;
  const request = makeRequest(method, full, { body, cookie });
  const ctx = makeCtx(request, action, db);
  const res = method === 'POST' ? await onRequestPost(ctx) : await onRequestGet(ctx);
  const json = await res.json();
  return { status: res.status, json };
}

const USER_ID = 1;
const COOKIE = `${SESSION_COOKIE}=tok-int-1`;
const FUTURE = new Date(Date.now() + 86400e3).toISOString();

function freshDb() {
  const db = createD1();
  db.seedUser(USER_ID, 'int@test.dev');
  db.seedSession('tok-int-1', USER_ID, FUTURE);
  return db;
}

const MEM_OP = { op_id: 'r-op1', kind: 'upsert_memory', entity_id: 'r-mem1',
  payload: { data: { type: 'movie', title: '沙丘2', rating: 8.1 }, updated_at: '2026-08-30T20:00:00Z' }, created_at: '2026-08-30T20:00:00Z' };
const ENTRY_OP = { op_id: 'r-op2', kind: 'append_entry', entity_id: 'r-mem1',
  payload: { memory_id: 'r-mem1', entry: { id: 'r-ent1', content: '好看', created_at: '2026-08-30T20:01:00Z' } }, created_at: '2026-08-30T20:01:00Z' };
const ATT_OP = { op_id: 'r-op3', kind: 'upsert_attachment', entity_id: 'r-att1',
  payload: { memory_id: 'r-mem1', bytes: 2048, hash: '2048-abc', mime: 'image/jpeg', data: 'QUJD', created_at: '2026-08-30T20:02:00Z' }, created_at: '2026-08-30T20:02:00Z' };

// 1) Route push 集成：真实入口 → SyncService → Repository → D1
{
  const db = freshDb();
  const { status, json } = await callRoute(db, 'POST', 'push', { cookie: COOKIE, body: { device_id: 'dev-A', device_name: '手机', operations: [MEM_OP, ENTRY_OP, ATT_OP] } });
  assert.equal(status, 200, 'push 应 200');
  assert.equal(json.ok, true);
  assert.equal(json.applied, 3, '记忆+条目+附件应全部应用（证明真实入口支持 attachment sync）');
  assert.equal(json.skipped, 0);
  assert.deepEqual(json.errors, []);
  assert.equal(json.last_seq, 3);
  // D1 侧真实落库断言（不是 mock 返回值）
  const mem = db.tables.memories.get('r-mem1');
  assert.ok(mem && JSON.parse(mem.data).title === '沙丘2', '记忆应真实写入 D1 仿真层');
  const ent = db.tables.entries.get('r-ent1');
  assert.ok(ent && ent.content === '好看', '条目应真实写入');
  const att = db.tables.attachments.get('r-att1');
  assert.ok(att && att.mime === 'image/jpeg' && att.data === 'QUJD' && att.user_id === USER_ID, '附件应真实写入且 userId 隔离正确');
  assert.equal(db.tables.operations().length, 3, '3 条 operation 应被记录（游标源）');
}

// 2) Route pull 集成：排除本机 + 其他设备可见
{
  const db = freshDb();
  await callRoute(db, 'POST', 'push', { cookie: COOKIE, body: { device_id: 'dev-A', operations: [MEM_OP, ENTRY_OP, ATT_OP] } });
  const self = await callRoute(db, 'GET', 'pull', { query: 'cursor=0&device_id=dev-A', cookie: COOKIE });
  assert.equal(self.json.ok, true);
  assert.equal(self.json.ops.length, 0, 'pull 必须排除来源设备');
  const other = await callRoute(db, 'GET', 'pull', { query: 'cursor=0&device_id=dev-B&device_name=' + encodeURIComponent('笔记本'), cookie: COOKIE });
  assert.equal(other.json.ops.length, 3, '其他设备应拉到 3 条');
  assert.equal(other.json.last_seq, 3);
  assert.equal(other.json.has_more, false);
  assert.deepEqual(other.json.ops.map(o => o.kind), ['upsert_memory', 'append_entry', 'upsert_attachment']);
}

// 3) Route 幂等：同一批 op_id 重放 → 全部 skipped，D1 不重复写入
{
  const db = freshDb();
  const ops = [MEM_OP, ENTRY_OP, ATT_OP];
  const first = await callRoute(db, 'POST', 'push', { cookie: COOKIE, body: { device_id: 'dev-A', operations: ops } });
  const again = await callRoute(db, 'POST', 'push', { cookie: COOKIE, body: { device_id: 'dev-A', operations: ops } });
  assert.equal(first.json.applied, 3);
  assert.equal(again.json.applied, 0, '重放不应再应用');
  assert.equal(again.json.skipped, 3, '重放应全部跳过（op_id 幂等）');
  assert.equal(db.tables.operations().length, 3, 'operation 不应重复');
  assert.equal(db.tables.entries.size, 1, 'append_entry 幂等：不产生第二条');
  assert.equal(db.tables.attachments.size, 1, 'attachment 幂等：不产生第二条');
}

// 4) Cursor/seq：push 后按 cursor 增量 pull
{
  const db = freshDb();
  await callRoute(db, 'POST', 'push', { cookie: COOKIE, body: { device_id: 'dev-A', operations: [MEM_OP, ENTRY_OP, ATT_OP] } });
  const page1 = await callRoute(db, 'GET', 'pull', { query: 'cursor=0&device_id=dev-B', cookie: COOKIE });
  const seqs = page1.json.ops.map(o => o.seq);
  assert.deepEqual(seqs, [1, 2, 3]);
  const page2 = await callRoute(db, 'GET', 'pull', { query: 'cursor=2&device_id=dev-B', cookie: COOKIE });
  assert.deepEqual(page2.json.ops.map(o => o.seq), [3], 'cursor=2 应只返回 seq>2');
}

// 5) Conflict/tombstone：现有同步规则无回归
{
  const db = freshDb();
  // 新者胜 + 败方保留
  await callRoute(db, 'POST', 'push', { cookie: COOKIE, body: { device_id: 'dev-A', operations: [
    { op_id: 'c1', kind: 'upsert_memory', entity_id: 'r-mem9', payload: { data: { title: '新值' }, updated_at: '2026-08-30T12:00:00Z' } },
  ]}});
  await callRoute(db, 'POST', 'push', { cookie: COOKIE, body: { device_id: 'dev-B', operations: [
    { op_id: 'c2', kind: 'upsert_memory', entity_id: 'r-mem9', payload: { data: { title: '旧值' }, updated_at: '2026-08-30T11:00:00Z' } },
  ]}});
  const m = db.tables.memories.get('r-mem9');
  assert.equal(JSON.parse(m.data).title, '新值', '新者胜');
  assert.equal(JSON.parse(m.data)._conflicts.length, 1, '败方保留进 _conflicts');
  assert.equal(m.conflict, 1);
  // 墓碑：删除后旧快照不复活
  await callRoute(db, 'POST', 'push', { cookie: COOKIE, body: { device_id: 'dev-A', operations: [
    { op_id: 'c3', kind: 'delete_memory', entity_id: 'r-mem9', payload: { updated_at: '2026-08-30T13:00:00Z' } },
  ]}});
  await callRoute(db, 'POST', 'push', { cookie: COOKIE, body: { device_id: 'dev-B', operations: [
    { op_id: 'c4', kind: 'upsert_memory', entity_id: 'r-mem9', payload: { data: { title: '僵尸' }, updated_at: '2026-08-30T12:30:00Z' } },
  ]}});
  assert.equal(db.tables.memories.get('r-mem9').deleted, 1, '删除不被旧快照复活');
}

// 6) Error envelope：Route 层的错误结构（旧协议 {error}，统一 status 语义）
{
  const db = freshDb();
  const noAuth = await callRoute(db, 'POST', 'push', { body: { device_id: 'x', operations: [MEM_OP] } });
  assert.equal(noAuth.status, 401);
  assert.equal(noAuth.json.error, '未登录或会话过期');
  const noDevice = await callRoute(db, 'POST', 'push', { cookie: COOKIE, body: { operations: [MEM_OP] } });
  assert.equal(noDevice.status, 400);
  assert.equal(noDevice.json.error, '缺少 device_id');
  const emptyOps = await callRoute(db, 'POST', 'push', { cookie: COOKIE, body: { device_id: 'dev-A', operations: [] } });
  assert.equal(emptyOps.status, 400);
  assert.equal(emptyOps.json.error, 'operations 为空');
  const badJson = await callRoute(db, 'POST', 'push', { cookie: COOKIE, query: 'probe=1' });
  assert.equal(badJson.status, 400);
  const unknown = await callRoute(db, 'POST', 'nope', { cookie: COOKIE, body: {} });
  assert.equal(unknown.status, 404);
  assert.equal(unknown.json.error, 'unknown action');
  // 单条操作错误：带稳定 code，且不影响整批
  const badOp = await callRoute(db, 'POST', 'push', { cookie: COOKIE, body: { device_id: 'dev-A', operations: [
    { op_id: 'bad1', kind: 'no_such_kind', entity_id: 'x', payload: {} },
    MEM_OP,
  ]}});
  assert.equal(badOp.json.applied, 1, '单条失败不影响整批');
  assert.equal(badOp.json.errors.length, 1);
  assert.equal(badOp.json.errors[0].code, 'VALIDATION_ERROR', '单条错误带稳定 code');
}

// 7) 坏 JSON 请求体
{
  const db = freshDb();
  const request = new Request('http://localhost:8788/api/sync/push', {
    method: 'POST', headers: { 'Cookie': COOKIE, 'Content-Type': 'application/json' }, body: '{not-json',
  });
  const res = await onRequestPost(makeCtx(request, 'push', db));
  assert.equal(res.status, 400);
  assert.equal((await res.json()).error, 'bad json');
}

console.log('sync-route 集成测试: 全部通过（7 组，真实 Route → SyncService → 内存 D1）');
