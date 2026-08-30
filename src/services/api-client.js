// InnerOS 前端统一 API Client（ARCH-003）
// 规则（docs/architecture/README.md 第 5 节）：
//   新增的前后端调用一律走 InnerOSApi；旧代码里散落的 fetch 在触碰到对应模块时顺手迁移。
// 兼容两种响应：
//   新信封 { success, data | error:{code,message,requestId,retryable} }
//   旧接口裸 JSON / {error}
// 失败抛 ApiError（code/message/retryable/requestId/status），调用方 catch 后走统一 toast。
// 说明：项目无打包器，采用经典脚本 + 单一命名空间 InnerOSApi（有意为之的服务命名，
// 非跨模块状态通信；未来引入构建体系时可平移为 ES Module）。
(function () {
  'use strict';

  class ApiError extends Error {
    constructor(info) {
      super(info.message || info.code || '请求失败');
      this.name = 'ApiError';
      this.code = info.code || 'INTERNAL';
      this.retryable = !!info.retryable;
      this.requestId = info.requestId || null;
      this.status = info.status || 0;
      this.raw = info.raw !== undefined ? info.raw : null;
    }
  }

  async function request(path, opts) {
    opts = opts || {};
    const init = {
      method: opts.method || 'GET',
      credentials: 'same-origin',
      headers: Object.assign({ 'Content-Type': 'application/json' }, opts.headers),
    };
    if (opts.body !== undefined) init.body = JSON.stringify(opts.body);
    const res = await fetch(path, init);

    let data = null;
    try { data = await res.json(); } catch (e) { data = null; }

    // 新版信封
    if (data && typeof data.success === 'boolean') {
      if (data.success) return { ok: res.ok, status: res.status, data: data.data };
      throw new ApiError({
        code: (data.error && data.error.code) || 'INTERNAL',
        message: (data.error && data.error.message) || ('HTTP ' + res.status),
        retryable: !!(data.error && data.error.retryable),
        requestId: (data.error && data.error.requestId) || null,
        status: res.status,
        raw: data,
      });
    }

    // 旧接口兼容：4xx/5xx + {error} 或裸错误文本
    if (!res.ok) {
      throw new ApiError({
        code: 'LEGACY_HTTP',
        message: (data && data.error) || ('HTTP ' + res.status),
        status: res.status,
        raw: data,
      });
    }
    return { ok: true, status: res.status, data };
  }

  window.InnerOSApi = Object.freeze({
    ApiError: ApiError,
    request: request,
    get: function (path, opts) { return request(path, opts); },
    post: function (path, body, opts) { return request(path, Object.assign({ method: 'POST', body: body }, opts)); },
  });
})();
