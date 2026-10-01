import { ensureSchema, CLEAR_COOKIE } from '../../../_lib.js';
import { ok, fail, errors, ServiceError } from '../../../_infra/errors.js';
import { createPasswordRepository } from '../../../_repositories/password-repository.js';
import { createPasswordService } from '../../../_services/password-service.js';
import { createEmailAdapter } from '../../../_adapters/email-adapter.js';

export async function onRequestPost(context) {
  const action = context.params.action;
  if (!['send-reset-code', 'reset-password'].includes(action)) return errors.notFound('接口');
  if (!context.env.DB) return errors.internal('账户服务暂不可用，请稍后再试');
  let body;
  try { body = await context.request.json(); }
  catch { return errors.validation('请求格式不正确，请刷新后再试'); }
  if (!body || Array.isArray(body) || typeof body !== 'object') return errors.validation('请求格式不正确');
  try {
    await ensureSchema(context.env.DB);
    const repository = createPasswordRepository(context.env.DB);
    await repository.ensureSchema();
    const service = createPasswordService({ repository, mailer: createEmailAdapter(context.env),
      defer: context.waitUntil ? promise => context.waitUntil(promise) : null });
    const input = { ...body, ip: context.request.headers.get('CF-Connecting-IP') || 'unknown' };
    const headers = { 'Cache-Control': 'no-store' };
    if (action === 'send-reset-code') return ok(await service.sendCode(input), { headers });
    const result = await service.reset(input);
    if (context.waitUntil) context.waitUntil(service.notify(body.email));
    return ok(result, { headers: { ...headers, 'Set-Cookie': CLEAR_COOKIE } });
  } catch (error) {
    if (error instanceof ServiceError) return fail(error.code, error.message, {
      status: error.status, retryable: error.retryable, headers: { 'Cache-Control': 'no-store' }
    });
    return errors.internal('账户服务暂时出现问题，请稍后再试');
  }
}
