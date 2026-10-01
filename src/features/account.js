// 账户密码交互：不保存明文密码，重置与设置入口共用邮件验证流程。
(function (global) {
  'use strict';
  let hooks = {}, fromSettings = false, returnFocus = null, cooldownUntil = 0, cooldownTimer = null;
  const byId = id => document.getElementById(id);
  const passwordIds = ['login-password', 'reg-password', 'reset-password', 'reset-confirm'];

  function clearPasswords() {
    for (const id of ['reset-password', 'reset-confirm', 'reset-code']) byId(id).value = '';
    for (const id of ['reset-password', 'reset-confirm']) {
      byId(id).type = 'password';
      const button = document.querySelector(`[data-password-target="${id}"]`);
      button.textContent = '显示'; button.setAttribute('aria-pressed', 'false');
    }
  }
  function toggle(id, button) {
    if (!passwordIds.includes(id)) return;
    const input = byId(id), visible = input.type === 'password';
    input.type = visible ? 'text' : 'password';
    button.textContent = visible ? '隐藏' : '显示';
    button.setAttribute('aria-pressed', String(visible));
    input.focus();
  }
  function message(text, error = false) {
    const el = byId('reset-message');
    el.textContent = text; el.classList.toggle('is-error', error);
  }
  function updateCooldown() {
    const left = Math.max(0, Math.ceil((cooldownUntil - Date.now()) / 1000));
    const button = byId('reset-code-btn');
    button.disabled = left > 0;
    button.textContent = left > 0 ? `${left} 秒后重试` : '获取验证码';
    if (left > 0) cooldownTimer = setTimeout(updateCooldown, 1000);
  }
  function open(settings = false) {
    fromSettings = settings; returnFocus = document.activeElement;
    clearPasswords(); message('验证码仅发送到注册邮箱，10 分钟内有效。');
    const email = settings ? hooks.getEmail?.() : byId('login-email').value;
    byId('reset-email').value = email || '';
    byId('reset-email').readOnly = settings;
    byId('reset-close').textContent = settings ? '取消修改' : '返回登录';
    byId('login-form').style.display = 'none';
    byId('register-form').style.display = 'none';
    document.querySelector('.auth-tabs').hidden = true;
    byId('reset-form').hidden = false;
    byId('auth-screen').style.display = 'flex';
    clearTimeout(cooldownTimer); updateCooldown();
    byId(settings ? 'reset-code' : 'reset-email').focus();
  }
  function close() {
    clearPasswords(); byId('reset-form').hidden = true;
    document.querySelector('.auth-tabs').hidden = false;
    byId('login-form').style.display = 'block';
    byId('register-form').style.display = 'none';
    byId('tab-login').classList.add('active'); byId('tab-register').classList.remove('active');
    if (fromSettings) byId('auth-screen').style.display = 'none';
    (returnFocus?.isConnected ? returnFocus : byId('login-email')).focus();
    fromSettings = false;
  }
  async function request(path, body) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15000);
    try { return await global.InnerOSApi.post(path, body, { signal: controller.signal }); }
    finally { clearTimeout(timeout); }
  }
  function errorText(error) {
    return error instanceof global.InnerOSApi.ApiError ? error.message : '网络暂时不可用，请检查连接后重试';
  }
  async function sendCode() {
    const email = byId('reset-email').value.trim();
    if (!email) { message('请先填写注册邮箱', true); byId('reset-email').focus(); return; }
    const button = byId('reset-code-btn');
    if (button.disabled) return;
    button.disabled = true; button.textContent = '发送中…'; message('正在发送验证码…');
    try {
      const result = await request('/api/v1/auth/send-reset-code', { email });
      message(result.data.message);
      cooldownUntil = Date.now() + 60000; clearTimeout(cooldownTimer); updateCooldown();
    } catch (error) {
      message(errorText(error), true); button.disabled = false; button.textContent = '获取验证码';
    }
  }
  async function submit(event) {
    event.preventDefault();
    const email = byId('reset-email').value.trim(), code = byId('reset-code').value.trim();
    const password = byId('reset-password').value, confirmPassword = byId('reset-confirm').value;
    if (!/^\d{6}$/.test(code)) return message('请输入邮件中的 6 位验证码', true);
    if (password.length < 6 || password.length > 128) return message('新密码需为 6–128 位', true);
    if (password !== confirmPassword) return message('两次输入的新密码不一致，请重新输入', true);
    const button = byId('reset-submit');
    if (button.disabled) return;
    button.disabled = true; message('正在验证并修改密码…');
    try {
      const result = await request('/api/v1/auth/reset-password', { email, code, password, confirmPassword });
      fromSettings = false; close();
      byId('login-email').value = email; byId('login-password').value = '';
      byId('reg-password').value = '';
      hooks.onReset?.(result.data.message);
      byId('login-password').focus();
    } catch (error) { message(errorText(error), true); }
    finally { button.disabled = false; }
  }
  document.addEventListener('keydown', event => {
    if (!byId('reset-form').hidden && event.key === 'Tab') {
      const controls = [...byId('reset-form').querySelectorAll('input,button')].filter(el => !el.disabled);
      const first = controls[0], last = controls[controls.length - 1];
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    }
    if (event.key === 'Escape' && !byId('reset-form').hidden && !byId('reset-submit').disabled) {
      event.preventDefault(); event.stopImmediatePropagation(); close();
    }
  });
  global.InnerOSAccount = Object.freeze({ configure: options => { hooks = options; },
    openReset: () => open(false), openFromSettings: () => open(true), close, toggle, sendCode, submit });
})(window);
