import { ServiceError } from '../_infra/errors.js';

export function createEmailAdapter(env, fetchImpl = fetch) {
  return {
    available: !!env.EMAIL_API_KEY,
    async send({ email, subject, text }) {
      try {
        const response = await fetchImpl('https://api.resend.com/emails', {
          method: 'POST', signal: AbortSignal.timeout(10000),
          headers: { Authorization: 'Bearer ' + env.EMAIL_API_KEY, 'Content-Type': 'application/json' },
          body: JSON.stringify({ from: env.EMAIL_FROM || 'InnerOS <noreply@inneros.asia>', to: [email], subject, text })
        });
        if (!response.ok) throw new Error('邮件发送失败');
      } catch {
        // 第三方错误正文可能包含收件人、密钥等，不进入日志或前端。
        throw new ServiceError('EMAIL_UNAVAILABLE', '邮件暂时发送失败，请稍后重新获取验证码', { status: 503, retryable: true });
      }
    }
  };
}
