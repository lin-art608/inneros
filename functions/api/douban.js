// /api/douban —— 既有路由（兼容层）：全部豆瓣访问已委托给 _adapters/douban-adapter.js（ARCH-006）
// 响应形状保持与历史版本完全一致（app.js 依赖），字段映射规则见 adapter。

import { suggestLegacy, movieDetailLegacy, bookDetailRexxar, bookDetailHtml } from '../_adapters/douban-adapter.js';

function jsonResponse(obj, status) {
  return new Response(JSON.stringify(obj), {
    status: status || 200,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Access-Control-Allow-Origin': '*',
      'Cache-Control': 'public, max-age=300',
    },
  });
}

export async function onRequestGet(context) {
  const url = new URL(context.request.url);
  const type = url.searchParams.get('type') || 'movie';
  const q = url.searchParams.get('q') || '';
  const id = url.searchParams.get('id') || '';

  // 详情模式：type=detail&kind=movie|book&id=xxx
  if (type === 'detail') {
    const kind = url.searchParams.get('kind') || 'movie';
    if (!id) return jsonResponse({ detail: null }, 400);
    try {
      const detail = kind === 'book'
        ? await bookDetailRexxar(id).catch(() => bookDetailHtml(id))
        : await movieDetailLegacy(id);
      return jsonResponse({ detail });
    } catch (e) {
      return jsonResponse({ detail: null }, 502);
    }
  }

  // 搜索模式：type=movie|book&q=xxx
  if (!q) return jsonResponse(type === 'book' ? { items: [] } : { results: [] }, 400);
  const kind = type === 'book' ? 'book' : 'movie';
  try {
    const raw = await suggestLegacy(kind, q);
    if (kind === 'book') {
      return jsonResponse({ items: raw.map(it => ({
        external_id: it.external_id,
        title: it.title,
        authors: it.authors,
        publisher: '',
        publishedDate: it.publishedDate,
        cover: it.poster || it.cover || '',
        isbn: '',
        categories: [],
        description: '',
        pageCount: 0,
        provider: 'douban',
      })) });
    }
    return jsonResponse({ results: raw.map(it => ({
      external_id: it.external_id,
      title: it.title,
      original_title: it.original_title,
      poster: it.poster,
      release_date: it.release_date,
      director: '',
      genres: [],
      description: '',
      provider: 'douban',
    })) });
  } catch (e) {
    return jsonResponse(type === 'book' ? { items: [] } : { results: [] }, 502);
  }
}
