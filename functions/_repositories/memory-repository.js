// Memory Repository（ARCH-005）——D1 访问集中层
// 规则：只做 CRUD/查询/分页；业务规则在 Domain/Service。
// 所有函数首参为 db（依赖注入），便于 wrangler 本地与单测替换。

import { ensureSchema } from '../_lib.js';

export function createMemoryRepository(db) {
  async function ensure() { await ensureSchema(db); }

  return {
    async ensureSchema() { await ensure(); },

    // ---- 查询 ----
    async getById(userId, id) {
      const r = await db.prepare('SELECT id, user_id, kind, data, deleted, updated_at, conflict FROM memories WHERE id = ? AND user_id = ?')
        .bind(id, userId).first();
      return r || null;
    },

    async exists(userId, id) {
      const r = await db.prepare('SELECT 1 FROM memories WHERE id = ? AND user_id = ?').bind(id, userId).first();
      return !!r;
    },

    // 账户列表/详情（v1 API）：deleted=0 的正式记录，按更新时间倒序
    async listByUser(userId, { limit = 100, offset = 0 } = {}) {
      const r = await db.prepare(
        `SELECT id, kind, data, updated_at, conflict FROM memories
         WHERE user_id = ? AND deleted = 0 ORDER BY updated_at DESC LIMIT ? OFFSET ?`
      ).bind(userId, limit, offset).all();
      return r.results.map(m => ({ ...m, data: safeParse(m.data) }));
    },

    async countByUser(userId) {
      const r = await db.prepare('SELECT COUNT(*) AS n FROM memories WHERE user_id = ? AND deleted = 0').bind(userId).first();
      return r ? r.n : 0;
    },

    // ---- 写入（新者胜 + 败方保留，业务规则与既有同步语义一致）----
    async upsertNewer({ userId, id, kind, data, updatedAt, deleted }) {
      const dataStr = JSON.stringify(data || {});
      const ex = await this.getById(userId, id);
      if (!ex) {
        await db.prepare('INSERT INTO memories(id, user_id, kind, data, deleted, updated_at) VALUES(?,?,?,?,?,?)')
          .bind(id, userId, kind || 'memory', dataStr, deleted ? 1 : 0, updatedAt).run();
        return { applied: true, conflict: false };
      }
      if (updatedAt > ex.updated_at) {
        let finalData = data || {};
        let conflict = 0;
        if (ex.data !== dataStr) {
          const exData = safeParse(ex.data);
          finalData = { ...(data || {}), _conflicts: [...(exData._conflicts || []), { data: exData, updated_at: ex.updated_at }] };
          conflict = 1;
        }
        await db.prepare('UPDATE memories SET data = ?, deleted = ?, updated_at = ?, conflict = ? WHERE id = ? AND user_id = ?')
          .bind(JSON.stringify(finalData), deleted ? 1 : 0, updatedAt, conflict, id, userId).run();
        return { applied: true, conflict: conflict === 1 };
      }
      if (updatedAt < ex.updated_at) {
        const exData = safeParse(ex.data);
        if (JSON.stringify(exData) !== JSON.stringify(data || {})) {
          await db.prepare('UPDATE memories SET data = ?, conflict = 1 WHERE id = ? AND user_id = ?')
            .bind(JSON.stringify({ ...exData, _conflicts: [...(exData._conflicts || []), { data: data || {}, updated_at: updatedAt }] }), id, userId).run();
          return { applied: false, conflict: true };
        }
      }
      return { applied: false, conflict: false };
    },

    // ARCH-008.1：写入方法统一支持 collect（语句收集器）。
    // 传入 collect 数组时只生成 prepared statement 不执行，由 SyncService 连同 operation 记录
    // 交给 db.batch() 一次提交（D1 batch 是事务，保证 apply + record 原子）。
    // 不传 collect 则立即执行——这样普通读写路径完全不受影响。

    async tombstone({ userId, id, updatedAt, collect }) {
      const stmt = db.prepare('UPDATE memories SET deleted = 1, updated_at = ? WHERE id = ? AND user_id = ? AND updated_at <= ?')
        .bind(updatedAt, id, userId, updatedAt);
      if (collect) { collect.push(stmt); return; }
      await stmt.run();
    },

    // ---- 子条目 ----
    // INSERT OR IGNORE 保证"存在即跳过"：既是幂等的，也能作为单条语句参与 batch
    async ensureShell({ userId, id, updatedAt, collect }) {
      const stmt = db.prepare('INSERT OR IGNORE INTO memories(id, user_id, kind, data, deleted, updated_at) VALUES(?,?,?,?,0,?)')
        .bind(id, userId, 'memory', '{}', updatedAt);
      if (collect) { collect.push(stmt); return; }
      await stmt.run();
    },
    async appendEntry({ userId, memoryId, entry, collect }) {
      await this.ensureShell({ userId, id: memoryId, updatedAt: entry.created_at, collect });
      const stmt = db.prepare('INSERT OR IGNORE INTO memory_entries(id, memory_id, user_id, content, photo_ids, created_at) VALUES(?,?,?,?,?,?)')
        .bind(entry.id, memoryId, userId, entry.content || '', JSON.stringify(entry.photo_ids || []), entry.created_at);
      if (collect) { collect.push(stmt); return; }
      await stmt.run();
    },
    async updateEntryContent({ userId, entryId, content, collect }) {
      const stmt = db.prepare('UPDATE memory_entries SET content = ? WHERE id = ? AND user_id = ?')
        .bind(String(content || ''), entryId, userId);
      if (collect) { collect.push(stmt); return; }
      await stmt.run();
    },
    async deleteEntry({ userId, entryId, collect }) {
      const stmt = db.prepare('UPDATE memory_entries SET deleted = 1 WHERE id = ? AND user_id = ?')
        .bind(entryId, userId);
      if (collect) { collect.push(stmt); return; }
      await stmt.run();
    },

    // ---- 附件（ARCH-008.1：修复此前缺失导致 upsert_attachment 操作永远失败的问题）----
    // 契约来自 app.js enqueueAttachments()：payload = { memory_id, bytes, hash, mime, data(不带 data: 前缀的 base64), created_at }，
    // op.entity_id = 附件 UUID，表结构见 _lib.js（不修改 D1 schema）。
    // 幂等：id 为主键，冲突时更新内容但保留原 created_at；WHERE user_id = excluded.user_id 保证越权写入被忽略。
    async upsertAttachment({ userId, id, memoryId, bytes, hash, mime, data, createdAt, collect }) {
      const stmt = db.prepare(
        `INSERT INTO attachments(id, memory_id, user_id, bytes, hash, mime, data, created_at)
         VALUES(?,?,?,?,?,?,?,?)
         ON CONFLICT(id) DO UPDATE SET
           memory_id = excluded.memory_id,
           bytes = excluded.bytes,
           hash = excluded.hash,
           mime = excluded.mime,
           data = excluded.data
         WHERE attachments.user_id = excluded.user_id`
      ).bind(id, String(memoryId || ''), userId, Number(bytes) || 0, String(hash || ''),
             String(mime || ''), String(data || ''), createdAt || new Date().toISOString());
      if (collect) { collect.push(stmt); return; }
      await stmt.run();
    },

    // 注意：操作日志与设备游标（opExists/record/listSince/maxSeq/updateCursor）
    // 已于 ARCH-008 迁出到 _repositories/operation-repository.js 与 device-repository.js。
    // upsertNewer 需要先读后写（冲突判定），无法作为纯语句参与 batch，
    // 因此不支持 collect——对应操作由 SyncService 走"顺序执行 + 幂等重试"路径。
  };
}

function safeParse(s) { try { return JSON.parse(s); } catch (e) { return {}; } }
