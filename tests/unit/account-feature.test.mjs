import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const elements = new Map(), buttons = new Map(), listeners = new Map(), calls = [];
function element(id) {
  const classes = new Set();
  return { id, value: '', type: id.includes('password') || id === 'reset-confirm' ? 'password' : 'text',
    hidden: id === 'reset-form', disabled: false, style: {}, textContent: '', attributes: {}, isConnected: true,
    classList: { add: c => classes.add(c), remove: c => classes.delete(c), toggle: (c, enabled) => enabled ? classes.add(c) : classes.delete(c) },
    focus() { document.activeElement = this; }, setAttribute(key, value) { this.attributes[key] = value; },
    querySelectorAll() { return [...elements.values()].filter(el => el.id.startsWith('reset-') && el.id !== 'reset-form'); }
  };
}
for (const id of ['login-email', 'login-password', 'reg-password', 'login-form', 'register-form',
  'tab-login', 'tab-register', 'auth-screen', 'reset-form', 'reset-email', 'reset-code', 'reset-password',
  'reset-confirm', 'reset-message', 'reset-submit', 'reset-close', 'reset-code-btn']) elements.set(id, element(id));
for (const id of ['login-password', 'reg-password', 'reset-password', 'reset-confirm']) buttons.set(id, element('toggle-' + id));
const tabs = element('auth-tabs');
const document = {
  activeElement: elements.get('login-email'), getElementById: id => elements.get(id),
  querySelector(selector) { return selector === '.auth-tabs' ? tabs : buttons.get(selector.match(/"([^"]+)"/)[1]); },
  addEventListener(event, handler) { listeners.set(event, handler); }
};
class ApiError extends Error {}
let fail = false, resetMessage;
const window = { InnerOSApi: { ApiError, async post(path, body, options) {
  calls.push({ path, body, options });
  if (fail) throw new ApiError('邮件暂不可用，请稍后重试');
  return { data: { message: '测试成功' } };
} } };
const context = vm.createContext({ window, document, AbortController, Date, setTimeout: () => 1, clearTimeout: () => {} });
vm.runInContext(fs.readFileSync('src/features/account.js', 'utf8'), context);
const feature = window.InnerOSAccount;
feature.configure({ getEmail: () => 'owner@example.test', onReset: message => { resetMessage = message; } });
feature.openFromSettings();
assert.equal(elements.get('reset-email').value, 'owner@example.test');
assert.equal(elements.get('reset-email').readOnly, true);
assert.equal(tabs.hidden, true);
feature.toggle('reset-password', buttons.get('reset-password'));
assert.equal(elements.get('reset-password').type, 'text');
feature.toggle('reset-password', buttons.get('reset-password'));
assert.equal(elements.get('reset-password').type, 'password');

// 测试输入仅存在于隔离 VM，不创建或修改真实账户。
elements.get('reset-code').value = '123456';
elements.get('reset-password').value = 'test-new-password';
elements.get('reset-confirm').value = 'mismatch';
await feature.submit({ preventDefault() {} });
assert.equal(calls.length, 0);
assert.match(elements.get('reset-message').textContent, /不一致/);
elements.get('reset-confirm').value = 'test-new-password';
await feature.submit({ preventDefault() {} });
assert.equal(calls[0].path, '/api/v1/auth/reset-password');
assert.equal(calls[0].body.email, 'owner@example.test');
assert.ok(calls[0].options.signal instanceof AbortSignal);
assert.equal(resetMessage, '测试成功');
assert.equal(elements.get('reset-password').value, '');
assert.equal(elements.get('reset-confirm').value, '');
assert.equal(elements.get('reset-form').hidden, true);
assert.equal(document.activeElement.id, 'login-password');

feature.openReset();
fail = true;
await feature.sendCode();
assert.match(elements.get('reset-message').textContent, /邮件暂不可用/);
assert.equal(elements.get('reset-code-btn').disabled, false);
fail = false;
await feature.sendCode();
assert.equal(elements.get('reset-code-btn').disabled, true);
assert.equal(calls.at(-1).path, '/api/v1/auth/send-reset-code');
elements.get('reset-password').value = 'test-only';
let prevented = false;
listeners.get('keydown')({ key: 'Escape', preventDefault() { prevented = true; }, stopImmediatePropagation() {} });
assert.equal(prevented, true);
assert.equal(elements.get('reset-password').value, '');
assert.equal(elements.get('reset-form').hidden, true);
assert.equal(document.activeElement.id, 'login-password');
console.log('账户面板：身份上下文、显示切换、校验、请求失败恢复、密码清理与焦点通过');
