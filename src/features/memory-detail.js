// InnerOS 记忆详情 UI：类型图标、篇章标题、Unicode 安全文本处理
(function (global) {
  'use strict';

  const ICONS = {
    movie: '<rect x="3" y="5" width="18" height="14" rx="2"/><path d="M7 5l2-3M12 5l2-3M17 5l2-3M3 10h18"/>',
    book: '<path d="M4 19.5A2.5 2.5 0 016.5 17H20V3H6.5A2.5 2.5 0 004 5.5z"/><path d="M4 5.5v14A2.5 2.5 0 016.5 22H20"/>',
    music: '<path d="M9 18V5l10-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="16" cy="16" r="3"/>',
    game: '<path d="M8.5 7h7a5.5 5.5 0 015.2 7.3l-1.1 3.2a2 2 0 01-3.2.9L14 16h-4l-2.4 2.4a2 2 0 01-3.2-.9l-1.1-3.2A5.5 5.5 0 018.5 7z"/><path d="M7 11v4M5 13h4M16 12h.01M18 14h.01"/>',
    custom: '<path d="M4 4h16v16H4z"/><path d="M8 9h8M8 13h8M8 17h5"/>',
    place: '<path d="M20 10c0 5-8 12-8 12S4 15 4 10a8 8 0 1116 0z"/><circle cx="12" cy="10" r="2.5"/>',
    event: '<path d="M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8z"/><path d="M19 17l.8 2.2L22 20l-2.2.8L19 23l-.8-2.2L16 20l2.2-.8z"/>',
    photo: '<rect x="3" y="5" width="18" height="14" rx="2"/><circle cx="8.5" cy="10" r="1.5"/><path d="M21 15l-5-5L5 19"/>',
    quick: '<path d="M21 15a4 4 0 01-4 4H8l-5 3V7a4 4 0 014-4h10a4 4 0 014 4z"/><path d="M8 9h8M8 13h5"/>',
    diary: '<path d="M5 3h12a2 2 0 012 2v16H7a2 2 0 01-2-2z"/><path d="M7 3v18M10 8h6M10 12h6M10 16h4"/>',
  };

  function icon(type, className) {
    const body = ICONS[type] || ICONS.event;
    return `<svg class="${className || 'type-icon-svg'}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${body}</svg>`;
  }

  function graphemes(value) {
    const text = String(value || '').normalize('NFC');
    if (typeof Intl !== 'undefined' && Intl.Segmenter) {
      return Array.from(new Intl.Segmenter('zh-CN', { granularity: 'grapheme' }).segment(text), item => item.segment);
    }
    return Array.from(text);
  }

  function truncate(value, max) {
    const parts = graphemes(value);
    return parts.length > max ? parts.slice(0, max).join('') + '…' : parts.join('');
  }

  function diaryFallbackTitle(content, date) {
    const plain = String(content || '').replace(/\s+/g, ' ').trim();
    if (plain) return truncate(plain, 18);
    return date ? `${date.slice(5, 7)}月${date.slice(8, 10)}日的日记` : '未命名日记';
  }

  function chapterLabel(index) {
    return index === 0 ? '初记' : `续写 ${index}`;
  }

  global.InnerOSMemoryDetail = Object.freeze({ icon, truncate, diaryFallbackTitle, chapterLabel });
})(typeof window !== 'undefined' ? window : globalThis);
