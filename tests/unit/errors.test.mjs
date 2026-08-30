// ARCH-002 单元测试：统一错误模型信封结构
// 运行：node tests/unit/errors.test.mjs （零依赖，node:assert）
import assert from 'node:assert/strict';
import { ok, fail, errors, newRequestId, ErrorCode } from '../../functions/_infra/errors.js';

// 1) 成功信封
const okRes = ok({ hello: 'world' });
const okBody = await okRes.json();
assert.equal(okRes.status, 200);
assert.equal(okBody.success, true);
assert.deepEqual(okBody.data, { hello: 'world' });

// 2) 失败信封：code/message/requestId/retryable 齐全
const errRes = fail(ErrorCode.VALIDATION_ERROR, '参数不对', { status: 400, retryable: false });
const errBody = await errRes.json();
assert.equal(errRes.status, 400);
assert.equal(errBody.success, false);
assert.equal(errBody.error.code, 'VALIDATION_ERROR');
assert.equal(errBody.error.message, '参数不对');
assert.equal(errBody.error.retryable, false);
assert.match(errBody.error.requestId, /^req_[0-9a-f]{16}$/);

// 3) requestId 每次不同
assert.notEqual(newRequestId(), newRequestId());

// 4) 快捷失败：authRequired 固定 401 + AUTH_REQUIRED
const authRes = errors.authRequired();
assert.equal(authRes.status, 401);
assert.equal((await authRes.json()).error.code, 'AUTH_REQUIRED');

// 5) provider 失败默认可重试
const provRes = errors.provider('上游超时');
assert.equal((await provRes.json()).error.retryable, true);

console.log('errors.test: 5/5 通过');
