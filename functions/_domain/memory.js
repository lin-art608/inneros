// Memory 领域模型（ARCH-004）
// 纯类型/归一化/校验：不依赖 D1、fetch、DOM（方案第七节 Domain 层规则）。
// 兼容策略：现有存储行保持旧字段（watch_date/event_date/entries[]...），
// normalizeMemory() 把旧形态映射为标准 Memory；存储层格式不变（回滚零成本）。

export const MEMORY_TYPES = ['media', 'event', 'diary', 'note', 'place', 'conversation'];
export const MEDIA_TYPES = ['movie', 'book', 'music', 'game'];

const MEDIA_TYPE_SET = new Set(MEDIA_TYPES);

// 旧 type → 标准 type（媒体四类归并为 media + mediaType）
export function canonicalType(legacyType) {
  const t = String(legacyType || '');
  if (MEDIA_TYPE_SET.has(t)) return 'media';
  if (t === 'place') return 'place';
  if (t === 'diary') return 'diary';
  if (t === 'event') return 'event';
  return 'note'; // quick/custom/photo/未知 → note
}

function firstDefined(...vals) {
  for (const v of vals) if (v !== undefined && v !== null && v !== '') return v;
  return null;
}

// 旧记录 → 标准 Memory（只读映射，不改写入格式）
export function normalizeMemory(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const legacyType = String(raw.type || '');
  const type = canonicalType(legacyType);
  const occurredAt = firstDefined(raw.watch_date, raw.event_date, raw.date, raw.finish_date, raw.start_date);
  const occurredTime = firstDefined(raw.watch_time, raw.event_time);
  const content = firstDefined(raw.review, raw.notes, raw.content, raw.note) || '';
  const isMedia = type === 'media';
  return {
    id: String(raw.id),
    type,
    legacyType: legacyType || null,
    title: raw.title || '',
    occurredAt,
    occurredTime,
    createdAt: raw.created_at || null,
    updatedAt: raw.updated_at || raw.created_at || null,
    content,
    rating: raw.rating != null ? Number(raw.rating) : null,
    tags: Array.isArray(raw.tags) ? raw.tags : [],
    people: Array.isArray(raw.people) ? raw.people : [],
    places: raw.location ? [raw.location] : [],
    deleted: raw.deleted === 1 || raw.deleted === true,
    // 媒体子结构（仅 media）
    // ARCH-009：若记录里已存标准 media 块（经 /api/v1/memories 保存的电影），以它为准；
    // 否则仍从旧字段推导——老数据零迁移，读取结果一致。
    media: isMedia ? {
      mediaType: legacyType,
      externalId: raw.external_id || null,
      poster: raw.poster || raw.cover || null,
      releaseDate: raw.release_date || raw.publish_date || null,
      creators: [raw.director, raw.author, raw.artist].filter(Boolean),
      genres: Array.isArray(raw.genres) ? raw.genres : [],
      score: raw.rating != null ? Number(raw.rating) : null,
      ...(raw.media && typeof raw.media === 'object' ? raw.media : {}),
    } : null,
    // 旧字段整体保留为 metadata（兼容读取，不丢任何信息）
    metadata: { legacyType, mood: raw.mood || null, platform: raw.platform || null, location: raw.location || null },
  };
}

// 校验：新建/写入时的最小规则（id/title 二选一必达，时间格式）
export function validateMemory(mem) {
  const errs = [];
  if (!mem || typeof mem !== 'object') return { ok: false, errors: ['memory 必须是对象'] };
  if (!mem.id) errs.push('缺少 id');
  if (!mem.title && !mem.content) errs.push('title 与 content 至少有一项');
  for (const k of ['occurredAt', 'createdAt']) {
    if (mem[k] && isNaN(new Date(mem[k]).getTime())) errs.push(k + ' 时间格式无效');
  }
  if (mem.tags && !Array.isArray(mem.tags)) errs.push('tags 必须是数组');
  return { ok: errs.length === 0, errors: errs };
}

// 同步操作校验（ARCH-004 附带：operations 的合法 kind 与最小字段）
export const SYNC_OP_KINDS = ['upsert_memory', 'append_entry', 'update_entry', 'delete_entry', 'delete_memory', 'upsert_attachment'];
export function validateOperation(op) {
  const errs = [];
  if (!op || typeof op !== 'object') return { ok: false, errors: ['operation 必须是对象'] };
  if (!op.op_id) errs.push('缺少 op_id');
  if (!SYNC_OP_KINDS.includes(op.kind)) errs.push('未知操作类型 ' + op.kind);
  if (!op.entity_id && !((op.payload || {}).entry || {}).id) errs.push('缺少 entity_id');
  return { ok: errs.length === 0, errors: errs };
}
