// InnerOS 收藏页纯逻辑：可见分类与当前页签状态
(function (global) {
  'use strict';

  const TABS = Object.freeze([
    Object.freeze({ type: 'movie', label: '电影', unit: '部' }),
    Object.freeze({ type: 'series', label: '剧集', unit: '部' }),
    Object.freeze({ type: 'book', label: '书籍', unit: '本' }),
    Object.freeze({ type: 'place', label: '地点', unit: '处' }),
  ]);
  const TYPES = new Set(TABS.map(tab => tab.type));
  let activeType = 'movie';

  function normalizeType(type) {
    return TYPES.has(type) ? type : 'movie';
  }

  function activate(type) {
    activeType = normalizeType(type);
    return activeType;
  }

  function current() {
    return activeType;
  }

  function definitions() {
    return TABS.slice();
  }

  function counts(entries) {
    const result = Object.fromEntries(TABS.map(tab => [tab.type, 0]));
    for (const entry of entries || []) {
      if (Object.prototype.hasOwnProperty.call(result, entry?.type)) result[entry.type] += 1;
    }
    return result;
  }

  global.InnerOSLibrary = Object.freeze({ normalizeType, activate, current, definitions, counts });
})(typeof window !== 'undefined' ? window : globalThis);
