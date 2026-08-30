// Media 领域模型（ARCH-009）——纯类型/归一化/校验/映射
// 不依赖 D1、fetch、DOM（方案第七节 Domain 层规则）。
// 核心目标（方案第六/八节）：
//   - 第三方（豆瓣/TMDB/...）的原始 JSON 只进 providerMetadata，业务层不直接依赖它；
//   - 保存后的电影进入统一 Memory/Media 数据模型，UI 不再读取第三方字段。

export const MEDIA_TYPES = ['movie', 'book', 'music', 'game'];
export const MEDIA_SOURCES = ['douban', 'tmdb', 'openlibrary'];

// 标准 Media 结构（Adapter 输出 / 业务层流通的唯一形态）
export function normalizeMedia(raw) {
  if (!raw || typeof raw !== 'object') return null;
  return {
    externalId: String(raw.externalId || ''),
    mediaType: String(raw.mediaType || ''),
    source: String(raw.source || ''),
    title: raw.title || '',
    originalTitle: raw.originalTitle || '',
    poster: raw.poster || '',
    releaseDate: raw.releaseDate || raw.year || '',
    creators: Array.isArray(raw.creators) ? [...raw.creators] : [],
    genres: Array.isArray(raw.genres) ? [...raw.genres] : [],
    score: raw.score == null ? null : Number(raw.score),
    description: raw.description || '',
    providerMetadata: (raw.providerMetadata && typeof raw.providerMetadata === 'object')
      ? { ...raw.providerMetadata }
      : {},
  };
}

export function validateMedia(m) {
  if (!m || typeof m !== 'object') return { ok: false, errors: ['media 必须是对象'] };
  const errs = [];
  if (!m.title) errs.push('缺少 title');
  if (m.mediaType && !MEDIA_TYPES.includes(m.mediaType)) errs.push('未知媒体类型 ' + m.mediaType);
  if (m.score != null && isNaN(Number(m.score))) errs.push('score 必须是数字');
  return { ok: errs.length === 0, errors: errs };
}

// 标准 Media → 记忆记录补丁（写入 memories.data）
// 同时保留两类字段：
//   1) 旧字段（poster/director/genres/...）——既有 UI 与 IndexedDB 读取路径完全不变，零迁移
//   2) 标准 media 结构（含 providerMetadata）——后续模块统一从 media 读取，换 Provider 不改 UI
export function mediaToMemoryPatch(media, mediaType) {
  const m = normalizeMedia(media);
  if (!m) return null;
  const type = mediaType || m.mediaType || 'movie';
  const patch = {
    type,
    title: m.title,
    external_id: m.externalId,
    provider: m.source,
    original_title: m.originalTitle,
    poster: m.poster,
    release_date: m.releaseDate,
    genres: m.genres,
    description: m.description,
    rating: m.score,
    media: { ...m, mediaType: type },
  };
  if (type === 'movie') {
    patch.director = m.creators[0] || '';
    patch.runtime = m.providerMetadata.runtime || null;
  } else if (type === 'book') {
    patch.author = m.creators.join(' / ');
    patch.publisher = m.providerMetadata.publisher || '';
    patch.isbn = m.providerMetadata.isbn || '';
    patch.page_count = m.providerMetadata.pageCount || 0;
    patch.book_description = m.description;
  }
  return patch;
}
