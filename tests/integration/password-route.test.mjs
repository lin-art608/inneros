// Node 22.13+ 内置 SQLite 验证真实 SQL、事务与路由；不访问真实邮箱或用户。
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { onRequestPost } from '../../functions/api/v1/auth/[action].js';
import { ensureSchema, hashPassword } from '../../functions/_lib.js';
import { createPasswordRepository } from '../../functions/_repositories/password-repository.js';
import { createPasswordService } from '../../functions/_services/password-service.js';

const sqlite = new DatabaseSync(':memory:');
const db = {
  prepare(sql) {
    let args = [];
    const statement = {
      bind(...values) { args = values; return statement; },
      async first() { return sqlite.prepare(sql).get(...args) || null; },
      async run() {
        const result = sqlite.prepare(sql).run(...args);
        return { meta: { changes: Number(result.changes), last_row_id: Number(result.lastInsertRowid) } };
      }
    };
    return statement;
  },
  async batch(statements) {
    sqlite.exec('BEGIN');
    try {
      const results = [];
      for (const statement of statements) results.push(await statement.run());
      sqlite.exec('COMMIT'); return results;
    } catch (error) { sqlite.exec('ROLLBACK'); throw error; }
  }
};
// 测试中 batch 序列化，保持 D1 事务语义，防止并发 BEGIN 嵌套。
const rawBatch = db.batch.bind(db);
let queue = Promise.resolve();
db.batch = statements => {
  const task = queue.then(() => rawBatch(statements));
  queue = task.catch(() => {}); return task;
};
await ensureSchema(db);
const salt = '1'.repeat(32), originalHash = await hashPassword('original-password', salt);
sqlite.prepare('INSERT INTO users(email, pass_hash, pass_salt, created_at) VALUES(?,?,?,?)')
  .run('owner@example.test', originalHash, salt, new Date().toISOString());
sqlite.prepare('INSERT INTO users(email, pass_hash, pass_salt, created_at) VALUES(?,?,?,?)')
  .run('other@example.test', originalHash, salt, new Date().toISOString());
const seedSessions = () => {
  sqlite.exec('DELETE FROM sessions');
  for (const [token, id] of [['device-a', 1], ['device-b', 1], ['other-device', 2]]) {
    sqlite.prepare('INSERT INTO sessions VALUES(?,?,?,?)').run(token, id, '2099-01-01', '2026-01-01');
  }
};
seedSessions();
const deliveries = [], background = [];
const originalFetch = globalThis.fetch;
globalThis.fetch = async (url, options) => {
  assert.equal(url, 'https://api.resend.com/emails');
  deliveries.push(JSON.parse(options.body));
  return new Response('{}', { status: 200 });
};
const call = async (action, body, { ip = '192.0.2.1', env = {}, raw = false } = {}) => {
  const response = await onRequestPost({
    request: new Request(`https://inneros.pages.dev/api/v1/auth/${action}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', 'CF-Connecting-IP': ip },
      body: raw ? body : JSON.stringify(body)
    }),
    params: { action }, env: { DB: db, EMAIL_API_KEY: 'test-only-not-a-real-secret', ...env },
    waitUntil: promise => background.push(promise)
  });
  return { response, status: response.status, body: await response.json() };
};
const codeFor = email => deliveries.filter(mail => mail.to[0] === email && mail.subject.includes('验证码')).at(-1).text.match(/\d{6}/)[0];
const unlockSend = email => sqlite.prepare('UPDATE password_reset_codes SET created_at = created_at - 61000 WHERE email = ?').run(email);
const resetBody = (code, email = 'owner@example.test') => ({ email, code, password: 'new-password', confirmPassword: 'new-password' });

try {
  assert.equal((await call('send-reset-code', { email: 'bad' })).status, 400);
  assert.equal((await call('send-reset-code', '{', { raw: true })).status, 400);
  assert.equal((await call('send-reset-code', { email: 'owner@example.test' }, { env: { EMAIL_API_KEY: '' } })).status, 503);
  const sent = await call('send-reset-code', { email: ' OWNER@example.test ' });
  assert.equal(sent.status, 200);
  assert.equal(sent.response.headers.get('Cache-Control'), 'no-store');
  const unknown = await call('send-reset-code', { email: 'unknown@example.test' });
  assert.deepEqual(unknown.body, sent.body);
  assert.equal(deliveries.length, 1);
  const record = sqlite.prepare('SELECT * FROM password_reset_codes WHERE email = ?').get('owner@example.test');
  const code = codeFor('owner@example.test');
  assert.notEqual(record.token_hash, code);
  assert.equal((await call('send-reset-code', { email: 'owner@example.test' })).status, 429);
  assert.equal((await call('reset-password', { ...resetBody(code), confirmPassword: 'mismatch' })).status, 400);

  const candidates = await Promise.all([call('reset-password', resetBody(code)), call('reset-password', resetBody(code))]);
  assert.deepEqual(candidates.map(result => result.status).sort(), [200, 400]);
  const success = candidates.find(result => result.status === 200);
  assert.match(success.response.headers.get('Set-Cookie'), /Max-Age=0/);
  const user = sqlite.prepare('SELECT * FROM users WHERE email = ?').get('owner@example.test');
  assert.equal(user.pass_hash, await hashPassword('new-password', user.pass_salt));
  assert.notEqual(user.pass_salt, salt);
  assert.equal(sqlite.prepare('SELECT count(*) AS n FROM sessions WHERE user_id=1').get().n, 0);
  assert.equal(sqlite.prepare('SELECT count(*) AS n FROM sessions WHERE user_id=2').get().n, 1);
  assert.equal(sqlite.prepare('SELECT pass_hash FROM users WHERE id=2').get().pass_hash, originalHash);
  assert.equal((await call('reset-password', resetBody(code))).status, 400);

  // 每张凭证最多 5 次错误；正确验证码在锁定后也不可用。
  unlockSend('owner@example.test');
  await call('send-reset-code', { email: 'owner@example.test' });
  const lockedCode = codeFor('owner@example.test');
  const wrongCode = lockedCode === '000000' ? '111111' : '000000';
  for (let i = 0; i < 5; i++) assert.equal((await call('reset-password', resetBody(wrongCode))).status, 400);
  assert.equal((await call('reset-password', resetBody(lockedCode))).status, 400);
  assert.equal(sqlite.prepare('SELECT attempts FROM password_reset_codes WHERE email=?').get('owner@example.test').attempts, 5);

  // 过期与重新发送失效。
  unlockSend('owner@example.test');
  await call('send-reset-code', { email: 'owner@example.test' });
  const expiredCode = codeFor('owner@example.test');
  sqlite.prepare('UPDATE password_reset_codes SET expires_at=0 WHERE email=?').run('owner@example.test');
  assert.equal((await call('reset-password', resetBody(expiredCode))).status, 400);
  // 注册 codes 不可作为重置凭证。
  sqlite.prepare('INSERT INTO codes VALUES(?,?,?,?)').run('register@example.test', '123456', '2099-01-01', '2026-01-01');
  assert.equal((await call('reset-password', resetBody('123456', 'register@example.test'))).status, 400);

  // 邮件服务失败不泄漏上游响应、邮箱是否存在；失败凭证不得生效。
  globalThis.fetch = async () => new Response('private-provider-details', { status: 403 });
  const failedMail = await call('send-reset-code', { email: 'other@example.test' });
  await Promise.allSettled(background);
  assert.deepEqual(failedMail.body, sent.body);
  assert.equal(sqlite.prepare('SELECT consumed FROM password_reset_codes WHERE email=?').get('other@example.test').consumed, '发送失败');

  // 实际 SQL batch 中途失败必须回滚凭证与密码修改。
  const repository = createPasswordRepository(db);
  let clock = Date.now() + 3600001;
  let lastCode;
  const service = createPasswordService({ repository, now: () => clock,
    mailer: { available: true, send: async mail => { lastCode = mail.text.match(/\d{6}/)[0]; } } });
  await service.sendCode({ email: 'owner@example.test', ip: 'transaction-test' });
  const before = sqlite.prepare('SELECT pass_hash FROM users WHERE id=1').get().pass_hash;
  seedSessions();
  sqlite.exec(`CREATE TRIGGER reset_failure BEFORE DELETE ON sessions BEGIN SELECT RAISE(ABORT, '测试事务回滚'); END;`);
  await assert.rejects(() => service.reset({ ...resetBody(lastCode), ip: 'transaction-test' }), /测试事务回滚/);
  assert.equal(sqlite.prepare('SELECT consumed FROM password_reset_codes WHERE email=?').get('owner@example.test').consumed, null);
  assert.equal(sqlite.prepare('SELECT pass_hash FROM users WHERE id=1').get().pass_hash, before);
  assert.equal(sqlite.prepare('SELECT count(*) AS n FROM sessions WHERE user_id=1').get().n, 2);
  sqlite.exec('DROP TRIGGER reset_failure');
  await service.reset({ ...resetBody(lastCode), ip: 'transaction-test' });

  // 发送每小时最多 5 次；重发的旧凭证失效，且未注册邮箱同样限流。
  for (let i = 0; i < 5; i++) {
    await service.sendCode({ email: 'quota@example.test', ip: 'quota-test' }); clock += 61000;
  }
  await assert.rejects(() => service.sendCode({ email: 'quota@example.test', ip: 'quota-test' }), error => error.code === 'RATE_LIMITED');
  for (let i = 0; i < 20; i++) await service.sendCode({ email: `ip${i}@example.test`, ip: 'ip-limit-test' });
  await assert.rejects(() => service.sendCode({ email: 'ip21@example.test', ip: 'ip-limit-test' }), error => error.code === 'RATE_LIMITED');
  // HTTP 响应不等待实际邮件网络请求，避免按邮件耗时判断邮箱是否存在。
  let releaseDelivery;
  globalThis.fetch = () => new Promise(resolve => { releaseDelivery = () => resolve(new Response('{}')); });
  unlockSend('other@example.test');
  const scheduled = await Promise.race([
    call('send-reset-code', { email: 'other@example.test' }),
    new Promise(resolve => setTimeout(() => resolve({ status: '等待邮件网络' }), 1000))
  ]);
  assert.equal(scheduled.status, 200);
  releaseDelivery();
} finally {
  await Promise.allSettled(background);
  globalThis.fetch = originalFetch;
  sqlite.close();
}
console.log('密码重置路由：验证、限流、单次消费、会话隔离通过');
