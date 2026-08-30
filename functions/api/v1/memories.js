// GET /api/v1/memories?limit=&offset= —— 当前账户的记忆列表（ARCH-005 Repository 落地示范）
// 只读端点：鉴权 → Repository 查询 → 标准归一化输出（normalizeMemory），统一信封。

import { ensureSchema, requireUser } from '../../_lib.js';
import { ok, fail, errors } from '../../_infra/errors.js';
import { createMemoryRepository } from '../../_repositories/memory-repository.js';
import { createMemoryService } from '../../_services/memory-service.js';
import * as domain from '../../_domain/memory.js';

// Route 职责：parse → auth → service → ok/fail（ARCH-007：业务编排已入 Service）
function buildService(db) {
  return createMemoryService({ repository: createMemoryRepository(db), domain });
}

function toFail(e) {
  const status = e.status || 500;
  return fail(e.code || 'INTERNAL', e.message || '内部错误', { status });
}

export async function onRequestGet(context) {
  const db = context.env.DB;
  if (!db) return errors.internal('D1 数据库未绑定');
  await ensureSchema(db);
  const user = await requireUser(db, context.request);
  if (!user) return errors.authRequired();

  const url = new URL(context.request.url);
  const limit = Math.min(200, Math.max(1, parseInt(url.searchParams.get('limit') || '100', 10) || 100));
  const offset = Math.max(0, parseInt(url.searchParams.get('offset') || '0', 10) || 0);

  try {
    const service = buildService(db);
    const result = await service.listMemories({ userId: user.id, limit, offset });
    return ok(result);
  } catch (e) {
    return toFail(e);
  }
}

// POST /api/v1/memories —— 创建记忆（服务端生成 id 与 updated_at；领域校验在 Service）
export async function onRequestPost(context) {
  const db = context.env.DB;
  if (!db) return errors.internal('D1 数据库未绑定');
  await ensureSchema(db);
  const user = await requireUser(db, context.request);
  if (!user) return errors.authRequired();

  let body = {};
  try { body = await context.request.json(); } catch (e) { return errors.validation('请求体必须是 JSON'); }

  try {
    const service = buildService(db);
    const memory = await service.createMemory({
      userId: user.id,
      id: crypto.randomUUID(),
      input: { type: String(body.type || 'note'), title: body.title, content: body.content, rating: body.rating, tags: body.tags, occurredAt: body.occurredAt },
    });
    return ok({ memory }, 201);
  } catch (e) {
    return toFail(e);
  }
}
