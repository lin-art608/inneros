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

    async tombstone({ userId, id, updatedAt }) {
      await db.prepare('UPDATE memories SET deleted = 1, updated_at = ? WHERE id = ? AND user_id = ? AND updated_at <= ?')
        .bind(updatedAt, id, userId, updatedAt).run();
    },

    // ---- 子条目 ----
    async ensureShell({ userId, id, updatedAt }) {
      const ex = await this.exists(userId, id);
      if (!ex) {
        await db.prepare('INSERT INTO memories(id, user_id, kind, data, deleted, updated_at) VALUES(?,?,?,?,0,?)')
          .bind(id, userId, 'memory', '{}', updatedAt).run();
      }
    },
    async appendEntry({ userId, memoryId, entry }) {
      await this.ensureShell({ userId, id: memoryId, updatedAt: entry.created_at });
      await db.prepare('INSERT OR IGNORE INTO memory_entries(id, memory_id, user_id, content, photo_ids, created_at) VALUES(?,?,?,?,?,?)')
        .bind(entry.id, memoryId, userId, entry.content || '', JSON.stringify(entry.photo_ids || []), entry.created_at).run();
    },
    async updateEntryContent({ userId, entryId, content }) {
      await db.prepare('UPDATE memory_entries SET content = ? WHERE id = ? AND user_id = ?')
        .bind(String(content || ''), entryId, userId).run();
    },
    async deleteEntry({ userId, entryId }) {
      await db.prepare('UPDATE memory_entries SET deleted = 1 WHERE id = ? AND user_id = ?')
        .bind(entryId, userId).run();
    },

    // 注意：操作日志与设备游标（opExists/record/listSince/maxSeq/updateCursor）
    // 已于 ARCH-008 迁出到 _repositories/operation-repository.js 与 device-repository.js，
    // 本 Repository 只负责 memory / memory_entries（attachments 待补，见 CHANGELOG 已知问题）。
  };
}

function safeParse(s) { try { return JSON.parse(s); } catch (e) { return {}; } }
