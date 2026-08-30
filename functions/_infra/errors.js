// 统一响应信封与错误模型（ARCH-002）
// 规则见 docs/architecture/README.md 第 4 节：
//   成功 { success:true, data }
//   失败 { success:false, error:{ code, message, requestId, retryable } }
// 仅用于 **新 /api/v1/** 接口；既有 /api/* 旧接口保持原样（勿迁移）。

export const ErrorCode = {
  AUTH_REQUIRED: 'AUTH_REQUIRED',
  VALIDATION_ERROR: 'VALIDATION_ERROR',
  NOT_FOUND: 'NOT_FOUND',
  CONFLICT: 'CONFLICT',
  PROVIDER_ERROR: 'PROVIDER_ERROR',
  MEDIA_PROVIDER_TIMEOUT: 'MEDIA_PROVIDER_TIMEOUT',
  RATE_LIMITED: 'RATE_LIMITED',
  INTERNAL: 'INTERNAL',
};

const JSON_TYPE = 'application/json; charset=utf-8';

export function newRequestId() {
  const buf = crypto.getRandomValues(new Uint8Array(8));
  return 'req_' + [...buf].map(b => b.toString(16).padStart(2, '0')).join('');
}

// 成功响应
export function ok(data, { status = 200, headers = {} } = {}) {
  return new Response(JSON.stringify({ success: true, data }), {
    status,
    headers: { 'Content-Type': JSON_TYPE, 'Access-Control-Allow-Origin': '*', ...headers },
  });
}

// 失败响应：code 必须来自 ErrorCode 或新增的稳定码；message 为用户可读中文
export function fail(code, message, { status = 400, retryable = false, headers = {}, requestId = null } = {}) {
  const rid = requestId || newRequestId();
  // 追踪日志：不含任何用户正文/凭据（方案第十四节）
  console.log(`[api] ${code} ${status} ${rid}`);
  return new Response(JSON.stringify({ success: false, error: { code, message, requestId: rid, retryable } }), {
    status,
    headers: { 'Content-Type': JSON_TYPE, 'Access-Control-Allow-Origin': '*', ...headers },
  });
}

// Application Service 业务错误：服务抛出，路由层捕获后转 fail()
export class ServiceError extends Error {
  constructor(code, message, { status = 400, retryable = false } = {}) {
    super(message);
    this.name = 'ServiceError';
    this.code = code;
    this.status = status;
    this.retryable = !!retryable;
  }
}

// 常用快捷失败
export const errors = {
  authRequired: () => fail(ErrorCode.AUTH_REQUIRED, '未登录或会话过期', { status: 401 }),
  validation: message => fail(ErrorCode.VALIDATION_ERROR, message, { status: 400 }),
  notFound: (what = '资源') => fail(ErrorCode.NOT_FOUND, what + '不存在', { status: 404 }),
  conflict: message => fail(ErrorCode.CONFLICT, message, { status: 409 }),
  provider: (message, retryable = true) => fail(ErrorCode.PROVIDER_ERROR, message, { status: 502, retryable }),
  internal: message => fail(ErrorCode.INTERNAL, message || '内部错误', { status: 500 }),
};
