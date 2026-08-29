// WebDAV 云同步代理（V1.2 §12 合规：不购买服务、不提交密钥）
// 思路：用户使用自己的免费 WebDAV 网盘（推荐坚果云 https://dav.jianguoyun.com/dav/，
// 注册免费；或自建/InfiniCloud 等），本函数只做请求转发：
//   - 凭据（地址/账号/应用密码）仅保存在用户浏览器 localStorage，随每个请求传入；
//   - 服务端（CF Worker / 本地 server.py）不存储任何凭据与数据；
//   - 数据是用户自己的 JSON 快照（entries + teams），存在用户自己的网盘里。
// 支持 op: test（PROPFIND 探测）/ get（读快照）/ put（写快照，父目录不存在时自动 MKCOL 一次）。

const JSON_HDR = { 'Content-Type': 'application/json; charset=utf-8', 'Access-Control-Allow-Origin': '*' };

function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), { status, headers: { ...JSON_HDR, 'Cache-Control': 'no-cache' } });
}

function authHeader(user, pass) {
  // WebDAV Basic Auth；btoa 处理非 ASCII（用户名可能含中文/邮箱一般安全）
  return 'Basic ' + btoa(unescape(encodeURIComponent(`${user}:${pass}`)));
}

export async function onRequestPost(context) {
  let body;
  try { body = await context.request.json(); } catch (e) { return json({ error: 'bad json' }, 400); }
  const op = body.op || '';
  const url = (body.url || '').trim();
  const user = body.user || '';
  const pass = body.pass || '';
  if (!url || !/^https:\/\//.test(url)) return json({ error: '需要 https:// 开头的 WebDAV 地址' }, 400);

  const headers = {
    'Authorization': authHeader(user, pass),
    'User-Agent': 'InnerOS-Sync/1.0',
  };

  try {
    if (op === 'test') {
      const res = await fetch(url, { method: 'PROPFIND', headers: { ...headers, 'Depth': '0' } });
      return json({ ok: res.ok, status: res.status });
    }

    if (op === 'get') {
      const res = await fetch(url, { method: 'GET', headers });
      if (res.status === 404) return json({ exists: false });
      if (!res.ok) return json({ error: `GET ${res.status}` }, res.status);
      const text = await res.text();
      try { return json({ exists: true, snapshot: JSON.parse(text) }); }
      catch (e) { return json({ error: '云端文件不是合法 JSON' }, 422); }
    }

    if (op === 'put') {
      const payload = body.data;
      if (typeof payload !== 'string') return json({ error: 'data 需为 JSON 字符串' }, 400);
      let res = await fetch(url, { method: 'PUT', headers: { ...headers, 'Content-Type': 'application/json' }, body: payload });
      // 409 = 父目录不存在：尝试 MKCOL 一级父目录后重试一次
      if (res.status === 409) {
        const parent = url.replace(/\/[^/]*\/?$/, '/');
        if (parent !== url && /^https:\/\//.test(parent)) {
          await fetch(parent, { method: 'MKCOL', headers }).catch(() => {});
          res = await fetch(url, { method: 'PUT', headers: { ...headers, 'Content-Type': 'application/json' }, body: payload });
        }
      }
      return json({ ok: res.ok, status: res.status }, res.ok ? 200 : res.status);
    }

    return json({ error: 'unknown op' }, 400);
  } catch (e) {
    return json({ error: String(e && e.message || e) }, 502);
  }
}
