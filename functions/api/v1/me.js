// GET /api/v1/me —— 新版信封示范端点（ARCH-002）
// 复用既有会话机制（_lib.requireUser），响应走统一 envelope（errors.ok / errors.authRequired）。
// 新 API 一律：鉴权 → 校验 → 调用（后续接 Application Service）→ ok()/fail()；本端点不含业务规则。

import { ensureSchema, requireUser } from '../../_lib.js';
import { ok, errors } from '../../_infra/errors.js';

export async function onRequestGet(context) {
  const db = context.env.DB;
  if (!db) return errors.internal('D1 数据库未绑定');
  await ensureSchema(db);
  const user = await requireUser(db, context.request);
  if (!user) return errors.authRequired();
  return ok({ user: { id: user.id, email: user.email } });
}
