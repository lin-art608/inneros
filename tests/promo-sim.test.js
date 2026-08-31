// 虚拟时钟模拟器 v2：真选择器引擎 + 场景轨迹日志 + 墙揭示验证
const fs = require('fs');
const html = fs.readFileSync(process.argv[2], 'utf8');
const code = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)][0][1];

let vnow = 0;
const timers = []; let tid = 0;
global.setTimeout = (fn, ms) => { timers.push({ id: ++tid, at: vnow + (ms || 0), fn }); return tid; };
global.clearTimeout = (id) => { const i = timers.findIndex(t => t.id === id); if (i >= 0) timers.splice(i, 1); };
global.setInterval = (fn, ms) => { const id = ++tid; timers.push({ id, at: vnow + (ms || 0), fn, every: ms || 0 }); return id; };
global.clearInterval = global.clearTimeout;
global.performance = { now: () => vnow };
let rafCb = null;
global.requestAnimationFrame = (cb) => { rafCb = cb; return 1; };

function makeStyle() { return new Proxy({}, { get: (t, k) => (k in t ? t[k] : ''), set: (t, k, v) => { t[k] = v; return true; } }); }
function classes(el) { return String(el.className || '').trim().split(/\s+/).filter(Boolean); }

function makeEl(tag) {
  const el = {
    tagName: (tag || 'div').toUpperCase(), style: makeStyle(), children: [],
    innerHTML: '', textContent: '', className: '', id: '', parentNode: null,
    classList: { _s: null,
      add(...c) { sync(); c.forEach(x => el.classList._s.add(x)); },
      remove(...c) { sync(); c.forEach(x => el.classList._s.delete(x)); },
      toggle(c, f) { sync(); if (f === undefined) { el.classList._s.has(c) ? el.classList._s.delete(c) : el.classList._s.add(c); } else if (f) el.classList._s.add(c); else el.classList._s.delete(c); },
      contains(c) { sync(); return el.classList._s.has(c); } },
    appendChild(c) { c.parentNode = el; el.children.push(c); return c; },
    removeChild(c) { const i = el.children.indexOf(c); if (i >= 0) el.children.splice(i, 1); c.parentNode = null; },
    insertBefore(c, ref) { c.parentNode = el; const i = el.children.indexOf(ref); if (i < 0) el.children.push(c); else el.children.splice(i, 0, c); return c; },
    replaceChild(nu, old) { const i = el.children.indexOf(old); if (i >= 0) { el.children[i] = nu; nu.parentNode = el; old.parentNode = null; } return old; },
    matches(sel) { return matchSel(el, sel, el); },
    closest(sel) { return null; },
    querySelector(sel) { const r = walk(el, sel, 1); return r[0] || makeEl('div'); },
    querySelectorAll(sel) { const r = walk(el, sel, Infinity); r.item = i => r[i] || null; return r; },
    addEventListener() {},
    getBoundingClientRect() { return { left: 0, top: 0, width: 1200, height: 700, right: 1200, bottom: 700 }; },
    cloneNode(deep) { const n = makeEl(el.tagName.toLowerCase()); n.className = el.className; n.id = el.id; n.innerHTML = el.innerHTML; if (deep) n.children = el.children.map(c => c.cloneNode(true)); return n; },
    remove() { if (el.parentNode) el.parentNode.removeChild(el); },
    setAttribute() {}, getContext() { return null; }, focus() {},
    offsetWidth: 1200, offsetHeight: 700,
  };
  function sync() { if (!el.classList._s) { el.classList._s = new Set(classes(el)); } else { el.className = [...el.classList._s].join(' '); } }
  return el;
}
function matchSel(el, sel) {
  // 支持: #id / .class / tag / #id .class / .a.b
  const parts = sel.trim().split(/\s+/);
  if (parts.length > 1) return false; // 组合选择器由 walk 的祖先链处理
  const p = parts[0];
  if (p[0] === '#') return el.id === p.slice(1);
  if (p[0] === '.') return classes(el).includes(p.slice(1));
  return el.tagName === p.toUpperCase();
}
function hasAncestorMatch(el, rest) {
  const parts = rest.trim().split(/\s+/);
  let cur = el.parentNode; let pi = parts.length - 1;
  while (cur && pi >= 0) {
    if (matchSimple(cur, parts[pi])) pi--;
    cur = cur.parentNode;
  }
  return pi < 0;
}
function matchSimple(el, p) {
  if (p[0] === '#') return el.id === p.slice(1);
  if (p[0] === '.') return classes(el).includes(p.slice(1));
  return el.tagName === p.toUpperCase();
}
function matchFull(el, sel) {
  const parts = sel.trim().split(/\s+/);
  const last = parts[parts.length - 1];
  if (!matchSimple(el, last)) return false;
  if (parts.length === 1) return true;
  return hasAncestorChain(el, parts.slice(0, -1));
}
function hasAncestorChain(el, chain) {
  let cur = el.parentNode, pi = chain.length - 1;
  while (cur && pi >= 0) { if (matchSimple(cur, chain[pi])) pi--; cur = cur.parentNode; }
  return pi < 0;
}
function walk(root, sel, limit) {
  const out = [];
  (function rec(n) {
    if (out.length >= limit) return;
    for (const c of n.children) {
      if (matchFull(c, sel)) { out.push(c); if (out.length >= limit) return; }
      rec(c);
    }
  })(root);
  return out;
}

const cache = {};
const document = {
  getElementById(id) { if (!cache[id]) { cache[id] = makeEl('div'); cache[id].id = id; document.body.appendChild(cache[id]); } return cache[id]; },
  createElement(t) { return makeEl(t); },
  querySelectorAll(sel) { const r = walk(document.body, sel, Infinity); r.item = i => r[i] || null; return r; },
  querySelector(sel) { return walk(document.body, sel, 1)[0] || makeEl('div'); },
  addEventListener() {}, body: makeEl('body'), documentElement: makeEl('html'),
};
global.addEventListener = () => {};
global.document = document;
global.window = { innerWidth: 1600, innerHeight: 900, addEventListener() {}, AudioContext: null, webkitAudioContext: null };
global.innerWidth = 1600; global.innerHeight = 900;
global.alert = () => {}; global.location = { protocol: 'file:' };
global.navigator = { userAgent: 'node-stub' };
global.AudioContext = function () { throw new Error('AudioContext in stub'); };
global.webkitAudioContext = global.AudioContext;

try {
  new Function('window', 'document', 'navigator', 'location', code)(global.window, document, global.navigator, global.location);
  console.log('>>> boot OK');
} catch (e) { console.log('>>> BOOT 崩溃:', e.message, '\n' + (e.stack || '').split('\n').slice(1, 4).join('\n')); process.exit(1); }

// ---- 跑 90 秒，记录场景轨迹 + 墙揭示数 ----
const sceneLog = [];
let lastActive = '';
const FRAME = 16.7; let frames = 0;
try {
  for (vnow = 0; vnow <= 92000; vnow += FRAME) {
    for (let i = timers.length - 1; i >= 0; i--) {
      const t = timers[i];
      if (t.at <= vnow) { if (t.every) t.at = vnow + t.every; else timers.splice(i, 1); t.fn(); }
    }
    if (rafCb) { const cb = rafCb; rafCb = null; cb(vnow); }
    frames++;
    const act = Object.entries(cache).filter(([k, v]) => v.classList.contains('active')).map(([k]) => k).join(',');
    if (act !== lastActive) {
      sceneLog.push((vnow / 1000).toFixed(1) + 's → ' + (act || '(无)'));
      lastActive = act;
      // 墙揭示验证
      if (act === 's5' || act === 's6') {
        const gridId = act === 's5' ? 'photo-grid' : 'poster-grid';
        const tiles = walk(cache[gridId] || makeEl(), '.tile', Infinity);
        setTimeout(() => {
          const on = tiles.filter(t => t.classList.contains('on')).length;
          const flip = tiles.filter(t => t.classList.contains('flip')).length;
          console.log(`    [${gridId}] tiles=${tiles.length} on=${on} flip=${flip}`);
        }, act === 's5' ? 4500 : 4500);
      }
    }
  }
} catch (e) {
  console.log('>>> !!! 崩溃 @', (vnow / 1000).toFixed(2) + 's:', e.constructor.name + ':', e.message);
  console.log((e.stack || '').split('\n').slice(0, 6).join('\n'));
  process.exit(1);
}
console.log('>>> 90s 模拟完成，帧数', frames, '无崩溃');
console.log('场景轨迹:');
sceneLog.forEach(l => console.log('  ' + l));
