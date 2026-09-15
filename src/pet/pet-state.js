// 桌宠状态层（阶段 5）——属性数值：心情 mood / 饥饿 hunger / 体力 energy / 亲密 intimacy
// 对齐桌面版 v10（pet_v10_lite.pyw 的 State 类）：
//   默认值 {80, 30, 90, 50}；feed() = 饥饿-30 / 心情+5 / 亲密+2（各自夹在 0~100）。
//   localStorage 相当于桌面版的 pet_save.json；差异是网页版关闭标签页期间也会按上限补算流逝。
// 本文件不碰 DOM、不发请求；纯逻辑挂 InnerOSPetState.Core 供 node vm 单测。
(function () {
  'use strict';

  const FIELDS = ['mood', 'hunger', 'energy', 'intimacy'];
  const LABELS = { mood: '心情', hunger: '饥饿', energy: '体力', intimacy: '亲密' };

  // 档位文案（饥饿是越低越好，其余越高越好）
  const LEVELS = {
    mood: [[70, '心情不错'], [40, '还行'], [0, '有点低落']],
    hunger: [[70, '饿扁了'], [40, '有点饿'], [0, '不饿']],
    energy: [[70, '精力充沛'], [40, '还行'], [0, '有点累']],
    intimacy: [[70, '形影不离'], [40, '越来越熟'], [0, '刚认识']],
  };

  function isNum(v) { return typeof v === 'number' && isFinite(v); }

  function clamp(v, lo, hi) {
    const n = Number(v);
    if (!isFinite(n)) return lo;
    return Math.round(Math.max(lo, Math.min(hi, n)) * 10) / 10;
  }

  // 载入清洗：缺字段 / 空串 / 非数字 / 越界 一律回落默认值并夹到 0~100
  function normalize(raw, initial) {
    const src = (raw && typeof raw === 'object') ? raw : {};
    const base = (initial && typeof initial === 'object') ? initial : {};
    const out = {};
    FIELDS.forEach(function (f) {
      const v = src[f];
      const ok = isNum(v) || (typeof v === 'string' && v !== '' && isFinite(Number(v)));
      out[f] = clamp(ok ? v : (isNum(base[f]) ? base[f] : 0), 0, 100);
    });
    return out;
  }

  // 增减后夹回 0~100（不改原对象）
  function applyDelta(data, delta) {
    const out = normalize(data, data);
    Object.keys(delta || {}).forEach(function (k) {
      if (FIELDS.indexOf(k) === -1) return;
      out[k] = clamp(out[k] + Number(delta[k] || 0), 0, 100);
    });
    return out;
  }

  // 离线/离开时长（分钟）：非法或未来时间返回 0，超过上限按上限截断
  function offlineMinutes(savedAt, now, capMinutes) {
    const t = Number(savedAt);
    if (!isFinite(t) || t <= 0) return 0;
    const mins = Math.floor((Number(now) - t) / 60000);
    if (!isFinite(mins) || mins <= 0) return 0;
    const cap = Number(capMinutes);
    return (isFinite(cap) && cap > 0) ? Math.min(mins, cap) : mins;
  }

  // 按分钟数自然流逝：drift 为每分钟基础变化，extra 为附加速率（如待机回体力）
  function applyDrift(data, minutes, drift, extra) {
    const mins = Math.max(0, Number(minutes) || 0);
    if (!mins) return normalize(data, data);
    const rate = {};
    Object.keys(drift || {}).forEach(function (k) { rate[k] = Number(drift[k] || 0); });
    Object.keys(extra || {}).forEach(function (k) { rate[k] = (rate[k] || 0) + Number(extra[k] || 0); });
    const delta = {};
    Object.keys(rate).forEach(function (k) { delta[k] = rate[k] * mins; });
    return applyDelta(data, delta);
  }

  function levelText(field, value) {
    const rows = LEVELS[field] || [];
    const v = clamp(value, 0, 100);
    for (let i = 0; i < rows.length; i++) if (v >= rows[i][0]) return rows[i][1];
    return '';
  }

  // 数值条色调：饥饿高=糟，其余低=糟
  function barTone(field, value) {
    const v = clamp(value, 0, 100);
    if (field === 'hunger') return v >= 70 ? 'is-bad' : (v >= 40 ? 'is-warn' : '');
    return v <= 25 ? 'is-bad' : (v <= 45 ? 'is-warn' : '');
  }

  function statsRows(data) {
    return FIELDS.map(function (f) {
      const v = clamp(data[f], 0, 100);
      return { key: f, label: LABELS[f], value: v, text: levelText(f, v), tone: barTone(f, v) };
    });
  }

  // 主动说话选句：饿了 > 没体力 > 随机闲话（对齐桌面版 _bg_tick 的判定）
  function pickAmbientLine(data, cfg, rand) {
    const c = cfg || {};
    const lines = c.lines || {};
    const r = (typeof rand === 'function') ? rand() : Math.random();
    if (Number(data.hunger) >= Number(c.hungryAt)) return lines.hungry || '';
    if (Number(data.energy) <= Number(c.lowEnergyAt)) return lines.tired || '';
    const list = lines.idle || [];
    if (!list.length) return '';
    return list[Math.floor(r * list.length) % list.length];
  }

  // 从候选台词里随机取一句（"说句话"菜单用）
  function pickLine(list, rand) {
    if (!list || !list.length) return '';
    const r = (typeof rand === 'function') ? rand() : Math.random();
    return list[Math.floor(r * list.length) % list.length];
  }

  function createPetState(config, storage) {
    const sc = (config && config.state) || {};
    const initial = sc.initial || { mood: 80, hunger: 30, energy: 90, intimacy: 50 };
    const store = storage || (function () {
      try { return window.localStorage; } catch (e) { return null; }
    })();
    let data = normalize(null, initial);
    let savedAt = 0;

    function load() {
      let raw = null;
      let at = 0;
      try {
        const txt = store && store.getItem(sc.storageKey);
        if (txt) {
          const parsed = JSON.parse(txt);
          if (parsed && typeof parsed === 'object' && parsed.data) { raw = parsed.data; at = parsed.savedAt; }
          else raw = parsed; // 兼容只存了裸数值的旧格式
        }
      } catch (e) {
        raw = null; // 存档损坏 → 用默认值，不让桌宠挂掉
      }
      data = normalize(raw, initial);
      savedAt = Number(at) || 0;
      // 关闭页面期间照常流逝（按上限截断），避免回来时数值"冻住"
      const mins = offlineMinutes(savedAt, Date.now(), sc.offlineCapMinutes);
      if (mins > 0) data = applyDrift(data, mins, sc.driftPerMinute, null);
      return get();
    }

    function save() {
      savedAt = Date.now();
      try { store && store.setItem(sc.storageKey, JSON.stringify({ data: data, savedAt: savedAt })); } catch (e) { /* 隐私模式等：忽略 */ }
    }

    function get() { return Object.assign({}, data); }

    // 桌面版 feed()：饥饿-30 / 心情+5 / 亲密+2
    function award(kind) {
      const table = sc.reward || {};
      const delta = table[kind];
      if (!delta) return get();
      data = applyDelta(data, delta);
      return get();
    }

    return {
      load: load,
      save: save,
      get: get,
      rows: function () { return statsRows(data); },
      award: award,
      feed: function () { return award('feed'); },
      drift: function (minutes, extra) { data = applyDrift(data, minutes, sc.driftPerMinute, extra); return get(); },
      ambientLine: function (rand) { return pickAmbientLine(data, sc.ambient || config.ambient, rand); },
      talkLine: function (rand) { return pickLine((config.ambient && config.ambient.talk) || [], rand); },
    };
  }

  window.InnerOSPetState = {
    createPetState: createPetState,
    Core: Object.freeze({
      FIELDS: FIELDS,
      LABELS: LABELS,
      clamp: clamp,
      normalize: normalize,
      applyDelta: applyDelta,
      offlineMinutes: offlineMinutes,
      applyDrift: applyDrift,
      levelText: levelText,
      barTone: barTone,
      statsRows: statsRows,
      pickAmbientLine: pickAmbientLine,
      pickLine: pickLine,
    }),
  };
})();
