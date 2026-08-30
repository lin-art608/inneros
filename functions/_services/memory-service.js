// Application Service：Memory 业务编排（ARCH-007）
// 依赖注入：repository（D1/IndexedDB 访问）+ domain（归一化/校验）。
// 禁止：DOM、Cookie、Cloudflare Request、SQL、直接 fetch 第三方。
// 承载的真实业务：写入前校验、业务错误语义（NOT_FOUND/VALIDATION_ERROR）、
//                读取→领域归一化、墓碑时间戳生成。不是 repository 的机械包装。
// ARCH-009：统一抛 ServiceError（复用 _infra/errors.js，不自建第二套 Error 类）。

import { ErrorCode, ServiceError } from '../_infra/errors.js';

export function createMemoryService({ repository, domain }) {
  const nowIso = () => new Date().toISOString();
  const { normalizeMemory, validateMemory } = domain;

  function businessError(code, message, status = 400) {
    return new ServiceError(code, message, { status });
  }

  return {
    // 用例：列出当前账户的记忆（领域归一化输出）
    async listMemories({ userId, limit = 100, offset = 0 }) {
      const rows = await repository.listByUser(userId, { limit, offset });
      const items = rows.map(m => normalizeMemory({ id: m.id, ...m.data, updated_at: m.updated_at }));
      return { items, limit, offset, hasMore: rows.length === limit };
    },

    // 用例：读取单条（含领域归一化；不存在 → NOT_FOUND 语义错误）
    async getMemory({ userId, id }) {
      const row = await repository.getById(userId, id);
      if (!row || row.deleted) {
        throw businessError(ErrorCode.NOT_FOUND, '记忆不存在', 404);
      }
      return normalizeMemory({ id: row.id, ...safeParse(row.data), updated_at: row.updated_at });
    },

    // 用例：创建记忆——先领域校验，后落库（updated_at 由服务端生成，客户端不可伪造时间线）
    async createMemory({ userId, id, input }) {
      const clean = { ...input, id };
      const v = validateMemory(clean);
      if (!v.ok) throw businessError(ErrorCode.VALIDATION_ERROR, v.errors[0], 400);
      const updatedAt = nowIso();
      const data = { ...clean };
      delete data.id;
      const r = await repository.upsertNewer({ userId, id, kind: 'memory', data, updatedAt, deleted: false });
      return normalizeMemory({ id, ...clean, updated_at: updatedAt, conflict: r.conflict });
    },

    // 用例：追加内容条目——内容与照片至少其一；空追加拒绝
    async appendEntry({ userId, memoryId, entry }) {
      const content = String(entry.content || '').trim();
      const photos = Array.isArray(entry.photos) ? entry.photos : [];
      if (!content && photos.length === 0) {
        throw businessError(ErrorCode.VALIDATION_ERROR, '追加内容不能为空', 400);
      }
      const full = { ...entry, content: String(entry.content || ''), created_at: entry.created_at || nowIso() };
      await repository.appendEntry({ userId, memoryId, entry: full });
      return full;
    },

    // 用例：删除记忆（墓碑，时间戳服务端生成）
    async deleteMemory({ userId, id }) {
      await repository.tombstone({ userId, id, updatedAt: nowIso() });
      return { deleted: true };
    },

    // 用例：修改追加内容（禁止清空为纯空白）
    async updateEntryContent({ userId, entryId, content }) {
      const val = String(content || '');
      if (!val.trim()) throw businessError(ErrorCode.VALIDATION_ERROR, '内容不能为空', 400);
      await repository.updateEntryContent({ userId, entryId, content: val });
      return { ok: true };
    },
  };
}

function safeParse(s) { try { return JSON.parse(s); } catch (e) { return {}; } }
