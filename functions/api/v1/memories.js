// GET /api/v1/memories?limit=&offset= —— 当前账户的记忆列表（ARCH-005 Repository 落地示范）
// 只读端点：鉴权 → Repository 查询 → 标准归一化输出（normalizeMemory），统一信封。

import { ensureSchema, requireUser } from '../../_lib.js';
import { ok, errors } from '../../_infra/errors.js';
import { createMemoryRepository } from '../../_repositories/memory-repository.js';
import { normalizeMemory } from '../../_domain/memory.js';

export async function onRequestGet(context) {
  const db = context.env.DB;
  if (!db) return errors.internal('D1 数据库未绑定');
  await ensureSchema(db);
  const user = await requireUser(db, context.request);
  if (!user) return errors.authRequired();

  const url = new URL(context.request.url);
  const limit = Math.min(200, Math.max(1, parseInt(url.searchParams.get('limit') || '100', 10) || 100));
  const offset = Math.max(0, parseInt(url.searchParams.get('offset') || '0', 10) || 0);

  const repo = createMemoryRepository(db);
  const rows = await repo.listByUser(user.id, { limit, offset });
  const items = rows.map(m => normalizeMemory({ id: m.id, ...m.data, updated_at: m.updated_at }));

  return ok({ items, limit, offset, hasMore: rows.length === limit });
}
