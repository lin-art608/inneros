// 重置凭证与发送限流独立于注册 codes，防止跨用途使用。
export function createPasswordRepository(db) {
  const stmt = (sql, ...args) => db.prepare(sql).bind(...args);
  return {
    async ensureSchema() {
      await db.batch([
        db.prepare(`CREATE TABLE IF NOT EXISTS password_reset_codes (
          email TEXT PRIMARY KEY, token_hash TEXT NOT NULL, salt TEXT NOT NULL,
          expires_at INTEGER NOT NULL, created_at INTEGER NOT NULL,
          window_start INTEGER NOT NULL, send_count INTEGER NOT NULL,
          attempts INTEGER NOT NULL DEFAULT 0, consumed TEXT
        )`),
        db.prepare(`CREATE TABLE IF NOT EXISTS password_reset_limits (
          key TEXT PRIMARY KEY, window_start INTEGER NOT NULL, count INTEGER NOT NULL
        )`),
        stmt('DELETE FROM password_reset_limits WHERE window_start < ?', Date.now() - 86400000),
        stmt('DELETE FROM password_reset_codes WHERE created_at < ?', Date.now() - 86400000)
      ]);
    },
    async limit(key, now, maximum) {
      const result = await stmt(`INSERT INTO password_reset_limits(key, window_start, count) VALUES(?,?,1)
        ON CONFLICT(key) DO UPDATE SET
          count = CASE WHEN window_start <= ? THEN 1 ELSE count + 1 END,
          window_start = CASE WHEN window_start <= ? THEN excluded.window_start ELSE window_start END
        WHERE window_start <= ? OR count < ?`, key, now, now - 3600000, now - 3600000, now - 3600000, maximum).run();
      return result.meta.changes === 1;
    },
    async reserve({ email, tokenHash, salt, now }) {
      const result = await stmt(`INSERT INTO password_reset_codes
        (email, token_hash, salt, expires_at, created_at, window_start, send_count, attempts, consumed)
        VALUES(?,?,?,?,?,?,1,0,NULL)
        ON CONFLICT(email) DO UPDATE SET token_hash=excluded.token_hash, salt=excluded.salt,
          expires_at=excluded.expires_at, created_at=excluded.created_at,
          send_count=CASE WHEN window_start <= ? THEN 1 ELSE send_count + 1 END,
          window_start=CASE WHEN window_start <= ? THEN excluded.window_start ELSE window_start END,
          attempts=0, consumed=NULL
        WHERE created_at <= ? AND (window_start <= ? OR send_count < 5)`,
      email, tokenHash, salt, now + 600000, now, now,
      now - 3600000, now - 3600000, now - 60000, now - 3600000).run();
      return result.meta.changes === 1;
    },
    user: email => stmt('SELECT id FROM users WHERE email = ?', email).first(),
    code: email => stmt('SELECT * FROM password_reset_codes WHERE email = ?', email).first(),
    reject: (email, tokenHash) => stmt(`UPDATE password_reset_codes SET attempts = attempts + 1
      WHERE email = ? AND token_hash = ? AND consumed IS NULL AND attempts < 5`, email, tokenHash).run(),
    invalidate: (email, tokenHash) => stmt(`UPDATE password_reset_codes SET consumed = '发送失败'
      WHERE email = ? AND token_hash = ?`, email, tokenHash).run(),
    async consumeAndReset({ email, tokenHash, now, hash, salt, claim }) {
      // batch 为事务：唯一 claim 抢占凭证，后续写入均以此次抢占成功为前提。
      const results = await db.batch([
        stmt(`UPDATE password_reset_codes SET consumed = ?
          WHERE email = ? AND token_hash = ? AND expires_at > ? AND attempts < 5 AND consumed IS NULL`,
        claim, email, tokenHash, now),
        stmt(`UPDATE users SET pass_hash = ?, pass_salt = ? WHERE email = ? AND EXISTS
          (SELECT 1 FROM password_reset_codes WHERE email = ? AND consumed = ?)`, hash, salt, email, email, claim),
        stmt(`DELETE FROM sessions WHERE user_id IN (SELECT id FROM users WHERE email = ?) AND EXISTS
          (SELECT 1 FROM password_reset_codes WHERE email = ? AND consumed = ?)`, email, email, claim)
      ]);
      return results[0].meta.changes === 1 && results[1].meta.changes === 1;
    }
  };
}
