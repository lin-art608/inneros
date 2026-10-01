import { ServiceError } from '../_infra/errors.js';
import { hashPassword, randomHex } from '../_lib.js';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const invalidCode = () => new ServiceError('RESET_CODE_INVALID', '验证码无效、已使用或已过期，请重新获取', { status: 400 });
export async function digest(value) {
  const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return [...new Uint8Array(bytes)].map(b => b.toString(16).padStart(2, '0')).join('');
}
function secureCode() {
  // 拒绝采样消除取模偏差，不使用 Math.random。
  let value;
  do { value = crypto.getRandomValues(new Uint32Array(1))[0]; } while (value >= 4294000000);
  return String(value % 1000000).padStart(6, '0');
}
function emailOf(value) {
  const email = typeof value === 'string' ? value.trim().toLowerCase() : '';
  if (email.length > 254 || !EMAIL_RE.test(email)) throw new ServiceError('VALIDATION_ERROR', '请填写有效邮箱地址');
  return email;
}

export function createPasswordService({ repository, mailer, now = Date.now, defer = null }) {
  async function rateLimit(ip, purpose, maximum) {
    const key = await digest(purpose + ':' + (ip || 'unknown'));
    if (!await repository.limit(key, now(), maximum)) {
      throw new ServiceError('RATE_LIMITED', '操作过于频繁，请一小时后再试', { status: 429, retryable: true });
    }
  }
  return {
    async sendCode({ email: input, ip }) {
      const email = emailOf(input);
      if (!mailer.available) throw new ServiceError('EMAIL_UNAVAILABLE', '邮件服务尚未配置，请联系站长后再试', { status: 503, retryable: true });
      await rateLimit(ip, 'send', 20);
      const code = secureCode(), salt = randomHex(16);
      const tokenHash = await digest(salt + ':' + code);
      if (!await repository.reserve({ email, salt, tokenHash, now: now() })) {
        throw new ServiceError('RATE_LIMITED', '请至少间隔 60 秒获取验证码，每小时最多 5 次', { status: 429, retryable: true });
      }
      const user = await repository.user(email);
      if (user) {
        const delivery = async () => {
          try {
            await mailer.send({ email, subject: 'InnerOS 修改密码验证码',
              text: `你的修改密码验证码是 ${code}，10 分钟内有效，最多尝试 5 次。\n如非本人操作，请忽略此邮件。请勿向他人提供验证码。` });
          } catch {
            await repository.invalidate(email, tokenHash);
            console.warn('[password-reset] EMAIL_DELIVERY_FAILED');
          }
        };
        // Cloudflare waitUntil 后台投递，HTTP 响应不因邮箱存在而等待邮件网络请求。
        if (defer) defer(Promise.resolve().then(delivery));
        else await delivery();
      }
      return { message: '若该邮箱已注册，验证码将发送到该邮箱。请检查收件箱及垃圾邮件；未收到可稍后重试。', ttl_minutes: 10, cooldown_seconds: 60 };
    },
    async reset({ email: input, code, password, confirmPassword, ip }) {
      const email = emailOf(input);
      if (typeof password !== 'string' || password.length < 6 || password.length > 128) {
        throw new ServiceError('VALIDATION_ERROR', '新密码需为 6–128 位');
      }
      if (password !== confirmPassword) throw new ServiceError('VALIDATION_ERROR', '两次输入的新密码不一致，请重新输入');
      await rateLimit(ip, 'verify', 60);
      const rec = await repository.code(email);
      if (!rec || rec.consumed || rec.expires_at <= now() || rec.attempts >= 5) throw invalidCode();
      const tokenHash = await digest(rec.salt + ':' + (typeof code === 'string' ? code.trim() : ''));
      if (!/^\d{6}$/.test(String(code).trim()) || tokenHash !== rec.token_hash) {
        await repository.reject(email, rec.token_hash);
        throw invalidCode();
      }
      const salt = randomHex(16), hash = await hashPassword(password, salt);
      const changed = await repository.consumeAndReset({ email, tokenHash, now: now(), hash, salt, claim: randomHex(32) });
      if (!changed) throw invalidCode();
      return { message: '密码已修改，请使用新密码重新登录。所有设备的旧登录已失效。' };
    },
    async notify(email) {
      try { await mailer.send({ email: emailOf(email), subject: 'InnerOS 密码已修改',
        text: '你的 InnerOS 密码已修改，所有设备的旧登录已失效。如非本人操作，请立即通过登录页的邮件验证再次重置密码。' }); }
      catch { console.warn('[password-reset] NOTIFICATION_FAILED'); }
    }
  };
}
