// V1.22.0 桌宠属性层单测
// 用 node vm 加载 src/pet/pet-state.js（IIFE 挂 window.InnerOSPetState），
// 验证属性清洗/夹取/喂食公式（对齐桌面版 v10）/离开补偿/档位文案/主动说话选句/存档往返。
// 运行：node tests/unit/pet-state.test.mjs
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const src = readFileSync(join(__dirname, '../../src/pet/pet-state.js'), 'utf-8');

// 沙箱 localStorage：可注入初始数据、可模拟隐私模式抛错
function fakeStorage(seed) {
  const map = new Map(Object.entries(seed || {}));
  return {
    map,
    getItem(k) { return map.has(k) ? map.get(k) : null; },
    setItem(k, v) { map.set(k, String(v)); },
    removeItem(k) { map.delete(k); },
  };
}

function load({ storage, now } = {}) {
  const state = { storage: storage || fakeStorage(), now: now || Date.now() };
  const sandbox = {
    window: { localStorage: state.storage },
    console: { warn: () => {}, error: () => {} },
    Date: class extends Date { static now() { return state.now; } },
    JSON, Math, Number, Object, Array, isFinite, String, Boolean, isNaN, parseInt, parseFloat,
  };
  sandbox.globalThis = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(src, sandbox);
  return { S: sandbox.window.InnerOSPetState, ...state };
}

function C() { return load().S.Core; }

// vm 沙箱里造出来的对象/数组原型与测试进程不同，深比较前先克隆到本 realm
function plain(v) { return JSON.parse(JSON.stringify(v)); }

// 与 pet-config.js 的 state 段保持一致（改配置需同步这里）
const INITIAL = { mood: 80, hunger: 30, energy: 90, intimacy: 50 };
const CFG = {
  state: {
    storageKey: 'inneros_pet_state',
    initial: INITIAL,
    driftPerMinute: { mood: -0.15, hunger: 0.6, energy: -0.2, intimacy: 0 },
    idleRegen: { energy: 0.9 },
    offlineCapMinutes: 240,
    reward: {
      feed: { hunger: -30, mood: +5, intimacy: +2 },
      wave: { mood: +1, intimacy: +1 },
      jump: { mood: +2, energy: -2, intimacy: +1 },
    },
  },
  ambient: {
    hungryAt: 70,
    lowEnergyAt: 25,
    lines: { hungry: '有点饿了…', tired: '想歇一会儿…', idle: ['a', 'b', 'c'] },
    talk: ['你好呀', '今天也辛苦了'],
  },
};

// ---------- 1. 字段与中文标签 ----------
{
  const Core = C();
  assert.deepEqual(plain(Core.FIELDS), ['mood', 'hunger', 'energy', 'intimacy']);
  assert.equal(Core.LABELS.hunger, '饥饿');
  assert.equal(Core.LABELS.intimacy, '亲密');
}

// ---------- 2. clamp：保留一位小数、非法值回落下限、越界夹取 ----------
{
  const Core = C();
  assert.equal(Core.clamp(80.44, 0, 100), 80.4, '四舍五入到一位小数');
  assert.equal(Core.clamp(80.45, 0, 100), 80.5);
  assert.equal(Core.clamp(-5, 0, 100), 0);
  assert.equal(Core.clamp(140, 0, 100), 100);
  assert.equal(Core.clamp('60', 0, 100), 60, '数字字符串可接受');
  assert.equal(Core.clamp(NaN, 7, 100), 7, '非法值回落下限（调用方传默认值）');
  assert.equal(Core.clamp(undefined, 7, 100), 7);
  assert.equal(Core.clamp('', 7, 100), 7);
}

// ---------- 3. normalize：缺字段补默认、脏数据不传染 ----------
{
  const Core = C();
  assert.deepEqual(plain(Core.normalize(null, INITIAL)), INITIAL, '空存档 → 全部默认值');
  assert.deepEqual(plain(Core.normalize({}, INITIAL)), INITIAL);
  assert.deepEqual(plain(Core.normalize({ mood: 55 }, INITIAL)), { mood: 55, hunger: 30, energy: 90, intimacy: 50 });
  assert.deepEqual(
    plain(Core.normalize({ mood: 'abc', hunger: '', energy: null, intimacy: -20 }, INITIAL)),
    { mood: 80, hunger: 30, energy: 90, intimacy: 0 },
    '非法值回落默认，越界夹到 0'
  );
  assert.deepEqual(Core.normalize({ mood: 999 }, INITIAL).mood, 100, '越界夹到 100');
  assert.deepEqual(plain(Core.normalize('not-an-object', INITIAL)), INITIAL);
}

// ---------- 4. applyDelta：不改原对象 + 夹回 0~100 ----------
{
  const Core = C();
  const base = { mood: 80, hunger: 30, energy: 90, intimacy: 50 };
  const after = Core.applyDelta(base, { hunger: -30, mood: 5, intimacy: 2 });
  assert.deepEqual(plain(after), { mood: 85, hunger: 0, energy: 90, intimacy: 52 });
  assert.deepEqual(plain(base), { mood: 80, hunger: 30, energy: 90, intimacy: 50 }, '原对象不被修改（纯函数）');
  assert.equal(Core.applyDelta(base, { mood: 999 }).mood, 100);
  assert.deepEqual(plain(Core.applyDelta(base, { unknown: 50 })), base, '非属性字段被忽略');
  assert.deepEqual(plain(Core.applyDelta(base, {})), base, '空 delta 等于归一化');
  assert.equal(Core.applyDelta({ mood: 10 }, { mood: -50 }).mood, 0, '缺字段先补默认再加');
}

// ---------- 5. offlineMinutes：非法/未来返回 0，超上限截断 ----------
{
  const Core = C();
  const now = Date.parse('2026-09-15T12:00:00Z');
  assert.equal(Core.offlineMinutes(now - 30 * 60000, now, 240), 30);
  assert.equal(Core.offlineMinutes(now - 600 * 60000, now, 240), 240, '久别归来按上限截断');
  assert.equal(Core.offlineMinutes(now - 600 * 60000, now, 0), 600, '无上限时如实计算');
  assert.equal(Core.offlineMinutes(now + 60000, now, 240), 0, '未来时间（系统改表）返回 0');
  assert.equal(Core.offlineMinutes(0, now, 240), 0, '从未存过档');
  assert.equal(Core.offlineMinutes(null, now, 240), 0);
  assert.equal(Core.offlineMinutes('abc', now, 240), 0);
  assert.equal(Core.offlineMinutes(now - 59 * 1000, now, 240), 0, '不足一分钟按 0 计');
}

// ---------- 6. applyDrift：按分钟流逝 + 附加速率叠加 ----------
{
  const Core = C();
  const drift = { mood: -0.15, hunger: 0.6, energy: -0.2, intimacy: 0 };
  const d = Core.applyDrift(INITIAL, 60, drift, null);
  assert.equal(d.hunger, 66, '60 分钟涨 36 点饥饿');
  assert.equal(d.mood, 71);
  assert.equal(d.energy, 78);
  assert.deepEqual(plain(Core.applyDrift(INITIAL, 0, drift, null)), INITIAL, '0 分钟不变');
  const withRegen = Core.applyDrift(Object.assign({}, INITIAL, { energy: 40 }), 60, drift, { energy: 0.9 });
  assert.equal(withRegen.energy, 82, '待机回体力与流逝叠加（-0.2+0.9=+0.7/min）');
  assert.equal(Core.applyDrift({ hunger: 99 }, 60, drift, null).hunger, 100, '流逝也夹在 100 内');
}

// ---------- 7. levelText：档位边界（饥饿是越低越好） ----------
{
  const Core = C();
  assert.equal(Core.levelText('mood', 100), '心情不错');
  assert.equal(Core.levelText('mood', 70), '心情不错', '边界含等号');
  assert.equal(Core.levelText('mood', 69.9), '还行');
  assert.equal(Core.levelText('mood', 40), '还行');
  assert.equal(Core.levelText('mood', 0), '有点低落');
  assert.equal(Core.levelText('hunger', 70), '饿扁了');
  assert.equal(Core.levelText('hunger', 39), '不饿');
  assert.equal(Core.levelText('energy', 25), '有点累');
  assert.equal(Core.levelText('intimacy', 70), '形影不离');
  assert.equal(Core.levelText('unknown', 50), '', '未知字段返回空串');
}

// ---------- 8. barTone：饥饿取反（高=糟），其余低=糟 ----------
{
  const Core = C();
  assert.equal(Core.barTone('hunger', 70), 'is-bad');
  assert.equal(Core.barTone('hunger', 69), 'is-warn');
  assert.equal(Core.barTone('hunger', 39), '');
  assert.equal(Core.barTone('mood', 20), 'is-bad');
  assert.equal(Core.barTone('mood', 30), 'is-warn');
  assert.equal(Core.barTone('mood', 50), '');
  assert.equal(Core.barTone('energy', 100), '');
}

// ---------- 9. statsRows：面板行结构 ----------
{
  const Core = C();
  const rows = Core.statsRows({ mood: 80, hunger: 75, energy: 20, intimacy: 50 });
  assert.equal(rows.length, 4);
  assert.deepEqual(plain(rows.map(r => r.key)), ['mood', 'hunger', 'energy', 'intimacy'], '展示顺序固定');
  assert.deepEqual(plain(rows.map(r => r.label)), ['心情', '饥饿', '体力', '亲密']);
  assert.deepEqual(plain(rows[1]), { key: 'hunger', label: '饥饿', value: 75, text: '饿扁了', tone: 'is-bad' });
  assert.equal(rows[2].tone, 'is-bad', '体力低=糟');
  assert.equal(Core.statsRows({})[0].value, 0, '缺字段当 0 处理，不抛错');
}

// ---------- 10. 主动说话选句优先级：饿了 > 没体力 > 随机闲话 ----------
{
  const Core = C();
  const amb = CFG.ambient;
  assert.equal(
    Core.pickAmbientLine({ hunger: 80, energy: 5 }, amb, () => 0),
    '有点饿了…', '又饿又累时先说饿（对齐桌面版 _bg_tick）'
  );
  assert.equal(Core.pickAmbientLine({ hunger: 70, energy: 90 }, amb, () => 0), '有点饿了…', '阈值含等号');
  assert.equal(Core.pickAmbientLine({ hunger: 10, energy: 25 }, amb, () => 0), '想歇一会儿…');
  assert.equal(Core.pickAmbientLine({ hunger: 10, energy: 90 }, amb, () => 0), 'a');
  assert.equal(Core.pickAmbientLine({ hunger: 10, energy: 90 }, amb, () => 0.99), 'c', '闲话按随机数取句');
  assert.equal(Core.pickAmbientLine({ hunger: 10, energy: 90 }, amb, () => 1), 'a', '随机数为 1 时回到首句（不越界）');
  assert.equal(Core.pickAmbientLine({}, { lines: {} }, () => 0), '', '无台词返回空串');
}

// ---------- 11. pickLine：空列表安全 ----------
{
  const Core = C();
  assert.equal(Core.pickLine(['x', 'y'], () => 0), 'x');
  assert.equal(Core.pickLine(['x', 'y'], () => 0.9), 'y');
  assert.equal(Core.pickLine([], () => 0), '');
  assert.equal(Core.pickLine(null, () => 0), '');
}

// ---------- 12. createPetState：首次打开 = 桌面版默认值 ----------
{
  const { S } = load();
  const st = S.createPetState(CFG);
  assert.deepEqual(plain(st.load()), { mood: 80, hunger: 30, energy: 90, intimacy: 50 });
  assert.equal(st.rows().length, 4);
}

// ---------- 13. feed()：与桌面版 State.feed() 完全一致（饥饿-30/心情+5/亲密+2） ----------
{
  const { S } = load();
  const st = S.createPetState(CFG);
  st.load();
  assert.deepEqual(plain(st.feed()), { mood: 85, hunger: 0, energy: 90, intimacy: 52 }, '饥饿 30 被喂到 0（夹取），其余按公式');
  assert.deepEqual(plain(st.feed()), { mood: 90, hunger: 0, energy: 90, intimacy: 54 }, '再喂只涨心情/亲密，饥饿不再下探');
  assert.deepEqual(plain(st.award('wave')), { mood: 91, hunger: 0, energy: 90, intimacy: 55 }, '挥手 +1/+1');
  assert.deepEqual(plain(st.award('jump')), { mood: 93, hunger: 0, energy: 88, intimacy: 56 }, '跳跃 -2 体力');
  assert.deepEqual(plain(st.award('unknown')), { mood: 93, hunger: 0, energy: 88, intimacy: 56 }, '未知动作不加值也不抛错');
}

// ---------- 14. 存档往返：save → 重新 createPetState → load 拿回同值 ----------
{
  const storage = fakeStorage();
  const now = Date.parse('2026-09-15T12:00:00Z');
  const a = load({ storage, now }).S.createPetState(CFG);
  a.load();
  a.feed();
  a.save();
  const saved = JSON.parse(storage.getItem('inneros_pet_state'));
  assert.deepEqual(plain(saved.data), { mood: 85, hunger: 0, energy: 90, intimacy: 52 });
  assert.equal(saved.savedAt, now, 'savedAt 用于计算离开时长');
  // 立刻重开（0 分钟流逝）：数值原样恢复
  const b = load({ storage, now }).S.createPetState(CFG);
  assert.deepEqual(plain(b.load()), { mood: 85, hunger: 0, energy: 90, intimacy: 52 });
}

// ---------- 15. 离开补偿：30 分钟后回来按流逝结算 ----------
{
  const storage = fakeStorage();
  const t0 = Date.parse('2026-09-15T12:00:00Z');
  const a = load({ storage, now: t0 }).S.createPetState(CFG);
  a.load();
  a.save();
  const b = load({ storage, now: t0 + 30 * 60000 }).S.createPetState(CFG);
  const back = b.load();
  assert.equal(back.hunger, 48, '30 分钟 +18 饥饿（0.6/min）');
  assert.equal(back.mood, 75.5, '30 分钟 -4.5 心情');
  assert.equal(back.energy, 84);
  assert.equal(back.intimacy, 50, '亲密不随时间变');
}

// ---------- 16. 离开补偿上限：离开一整年也只按 240 分钟算 ----------
{
  const storage = fakeStorage();
  const t0 = Date.parse('2026-09-15T12:00:00Z');
  load({ storage, now: t0 }).S.createPetState(CFG).save();
  const later = load({ storage, now: t0 + 365 * 24 * 60 * 60000 }).S.createPetState(CFG);
  assert.equal(later.load().hunger, 100, '按上限 240 分钟结算后夹在 100（不会变成天文数字）');
}

// ---------- 17. 系统时间被改到过去：离开时长为 0，不倒退数值 ----------
{
  const storage = fakeStorage();
  const t0 = Date.parse('2026-09-15T12:00:00Z');
  const st = load({ storage, now: t0 }).S.createPetState(CFG);
  st.load(); st.save();
  const past = load({ storage, now: t0 - 3600e3 }).S.createPetState(CFG);
  assert.deepEqual(plain(past.load()), INITIAL, '未来存档不产生负流逝');
}

// ---------- 18. 兼容旧格式与损坏存档 ----------
{
  // 裸数值旧格式（没有 {data,savedAt} 外壳）
  const bare = fakeStorage({ inneros_pet_state: JSON.stringify({ mood: 60, hunger: 20, energy: 70, intimacy: 65 }) });
  const st = load({ storage: bare, now: Date.parse('2026-09-15T12:00:00Z') }).S.createPetState(CFG);
  assert.deepEqual(plain(st.load()), { mood: 60, hunger: 20, energy: 70, intimacy: 65 }, '裸数值存档可读，且不补算离开时长');
  // 损坏 JSON：回落默认值，不能让桌宠挂掉
  const broken = fakeStorage({ inneros_pet_state: '{not json' });
  const st2 = load({ storage: broken }).S.createPetState(CFG);
  assert.deepEqual(plain(st2.load()), INITIAL);
  // 半损坏：非法字段逐个回落默认
  const partial = fakeStorage({ inneros_pet_state: JSON.stringify({ data: { mood: '??', hunger: 88 }, savedAt: 0 }) });
  assert.deepEqual(plain(load({ storage: partial }).S.createPetState(CFG).load()), { mood: 80, hunger: 88, energy: 90, intimacy: 50 });
}

// ---------- 19. localStorage 不可用（隐私模式/配额满）也不抛错 ----------
{
  const thrower = {
    getItem() { throw new Error('SecurityError'); },
    setItem() { throw new Error('QuotaExceededError'); },
  };
  const st = load({ storage: thrower }).S.createPetState(CFG);
  assert.deepEqual(plain(st.load()), INITIAL, '读失败回落默认值');
  st.feed();
  st.save(); // 写失败静默忽略
  assert.equal(st.get().mood, 85, '写盘失败不影响内存中的数值');
}

// ---------- 20. 结算与主动说话用同一份内存数据 ----------
{
  const { S } = load();
  const st = S.createPetState(CFG);
  st.load();
  st.drift(100, null); // 100 分钟 → 饥饿 +60 = 90（越过 70 阈值）
  assert.equal(st.get().hunger, 90);
  assert.equal(st.ambientLine(() => 0), '有点饿了…', '网页版持续流逝让"饿了"这句真正会出现');
  assert.equal(st.talkLine(() => 0), '你好呀');
  assert.equal(st.rows()[1].tone, 'is-bad', '面板同步表现饥饿状态');
}

console.log('✓ pet-state 全部断言通过');
