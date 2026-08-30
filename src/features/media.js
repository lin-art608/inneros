// InnerOS 前端媒体数据层（ARCH-012 前端模块化 / V1.16.1 收口）
// 把电影/书籍/音乐「搜索 → 详情 → 字段映射」的纯数据逻辑从 app.js 抽离到此，
// app.js 只保留 DOM 渲染、状态协调与用户交互生命周期。
// 边界：
//   - 本文件不碰 DOM、不碰 app.js 内部变量，只依赖 window.InnerOSApi + 原生 fetch；
//   - 只做「标准 Media 结构 → 本地记录字段」映射与 v1/旧接口的获取与回退；
//   - 不改变业务规则、不改变用户流程、不改变返回字段形状（app.js 读取方式不变）。
// 主链（V1.16.1 收口）：UI → InnerOSMedia → InnerOSApi → /api/v1/media/* → MediaService → Adapter。
// 第三方 URL（/api/douban、itunes.apple.com）与原始字段解析**只存在于本文件的「兼容 fallback 层」**，
// feature 函数（searchMovie 等）不直接知道这些 URL——换 Provider 时只需改 Adapter 与 fallback 层。
// 说明：项目无打包器，采用经典脚本 + 单一命名空间 InnerOSMedia（与 InnerOSApi 同模式）。
(function () {
  'use strict';

  // ============================================================
  // 1) 字段映射（纯函数）：标准 Media → 本地记录字段
  // ============================================================
  // v1 返回标准结构（externalId/title/originalTitle/poster/releaseDate/creators/genres/
  // score/description/source/providerMetadata），映射成既有 UI 与 IndexedDB 读取字段名；
  // 标准结构整体保留在 media 字段（含 providerMetadata），换 Provider 时 UI 读取方式不变；
  // 第三方原始 JSON 只存在于 providerMetadata。type 用于书籍/音乐扩展字段映射。
  function mediaToWorkFields(m, type) {
    const meta = m.providerMetadata || {};
    const fields = {
      external_id: String(m.externalId || ''),
      title: m.title || '',
      original_title: m.originalTitle || '',
      poster: m.poster || '',
      release_date: m.releaseDate || '',
      director: (m.creators && m.creators[0]) || '',
      genres: m.genres || [],
      description: m.description || '',
      rating: (m.score == null ? null : m.score),
      runtime: meta.runtime || null,
      provider: m.source || 'douban',
      media: m,
    };
    if (type === 'book' || m.mediaType === 'book') {
      fields.cover = m.poster || '';
      fields.authors = (m.creators && m.creators[0]) || '';
      fields.publisher = meta.publisher || '';
      fields.isbn = meta.isbn || '';
      fields.categories = m.genres || [];
      fields.pageCount = meta.pageCount || 0;
      fields.publishedDate = m.releaseDate || '';
      fields.book_description = m.description || '';
    }
    if (type === 'music' || m.mediaType === 'music') {
      fields.artist = (m.creators && m.creators[0]) || '';
      fields.album = meta.album || '';
      fields.preview_url = meta.previewUrl || '';
      fields.track_price = (meta.trackPrice == null ? null : meta.trackPrice);
    }
    return fields;
  }

  // ============================================================
  // 2) 兼容 fallback 层（集中管理，非第二主链）
  // ============================================================
  // 主链永远是 InnerOSApi → /api/v1/media/*。以下 legacy 函数仅在 v1 不可用时作为临时兜底，
  // 第三方 URL（/api/douban、itunes.apple.com）与原始字段解析**只出现在这里**，
  // feature 层（searchMovie/searchBook/searchMusic/enrichWorkDetail）不直接知道这些 URL。
  // 未来 v1 稳定后可整体关闭或删除本段，不影响 feature 层。

  // 旧 /api/douban 搜索（kind = movie | book），返回旧字段形状（与历史 UI 一致）
  async function legacyDoubanSearch(kind, query) {
    const res = await fetch(`/api/douban?type=${kind}&q=${encodeURIComponent(query)}`);
    if (!res.ok) throw new Error((kind === 'book' ? '图书' : '电影') + '数据源暂时不可用');
    const data = await res.json();
    if (kind === 'book') {
      return (data.items || []).map(item => ({
        external_id: String(item.external_id), title: item.title || '', authors: item.authors || '',
        publisher: item.publisher || '', publishedDate: item.publishedDate || '', cover: item.cover || '',
        isbn: item.isbn || '', categories: item.categories || [], description: item.description || '', pageCount: item.pageCount || 0, provider: 'douban',
      }));
    }
    return (data.results || []).map(item => ({
      external_id: String(item.external_id), title: item.title || '', original_title: item.original_title || '',
      poster: item.poster || '', release_date: item.release_date || '',
      director: item.director || '', genres: item.genres || [], description: item.description || '', provider: 'douban',
    }));
  }

  // 旧 /api/douban 详情（kind = movie | book）
  async function legacyDoubanDetail(kind, id) {
    const res = await fetch(`/api/douban?type=detail&kind=${kind}&id=${encodeURIComponent(id)}`);
    if (!res.ok) return null;
    const data = await res.json();
    return data.detail || null;
  }

  // 直连 iTunes 搜索（country=CN 提升中文歌覆盖）
  async function legacyItunesSearch(query) {
    const res = await fetch(`https://itunes.apple.com/search?media=music&entity=song&limit=8&term=${encodeURIComponent(query)}&country=CN`);
    if (!res.ok) throw new Error('音乐数据源暂时不可用');
    return (await res.json()).results.map(item => ({
      external_id: String(item.trackId), title: item.trackName || '', artist: item.artistName || '',
      album: item.collectionName || '', poster: item.artworkUrl100 ? item.artworkUrl100.replace('100x100bb', '600x600bb') : '',
      release_date: (item.releaseDate || '').slice(0, 10),
      genres: item.primaryGenreName ? [item.primaryGenreName] : [], provider: 'itunes',
    }));
  }

  // ============================================================
  // 3) feature 主链：v1 优先，失败才走 fallback 层
  // ============================================================

  // 电影搜索（ARCH-009）：v1 标准接口 → MediaService → DoubanAdapter；失败回退 legacy
  async function searchMovie(query) {
    if (window.InnerOSApi) {
      try {
        const res = await window.InnerOSApi.get(`/api/v1/media/search?type=movie&query=${encodeURIComponent(query)}`);
        const items = (res.data && res.data.items) || [];
        if (items.length > 0) return items.map(x => mediaToWorkFields(x, 'movie'));
      } catch (e) {
        console.warn('[movie] v1 搜索失败，回退 legacy：', (e && (e.code || e.message)) || e);
      }
    }
    return legacyDoubanSearch('movie', query);
  }

  // 书籍搜索（ARCH-010）：v1 标准接口 → MediaService → DoubanAdapter；失败回退 legacy
  async function searchBook(query) {
    if (window.InnerOSApi) {
      try {
        const res = await window.InnerOSApi.get(`/api/v1/media/search?type=book&query=${encodeURIComponent(query)}`);
        const items = (res.data && res.data.items) || [];
        if (items.length > 0) return items.map(x => mediaToWorkFields(x, 'book'));
      } catch (e) {
        console.warn('[book] v1 搜索失败，回退 legacy：', (e && (e.code || e.message)) || e);
      }
    }
    return legacyDoubanSearch('book', query);
  }

  // 音乐搜索（ARCH-011）：v1 标准接口 → MediaService → iTunesAdapter；失败回退 legacy 直连 iTunes
  async function searchMusic(query) {
    if (window.InnerOSApi) {
      try {
        const res = await window.InnerOSApi.get(`/api/v1/media/search?type=music&query=${encodeURIComponent(query)}`);
        const items = (res.data && res.data.items) || [];
        if (items.length > 0) return items.map(x => mediaToWorkFields(x, 'music'));
      } catch (e) {
        console.warn('[music] v1 搜索失败，回退 legacy：', (e && (e.code || e.message)) || e);
      }
    }
    return legacyItunesSearch(query);
  }

  // 详情补全（V1.2 §8 / ARCH-009/010/011）：选中搜索结果后拉详情，补齐简介/导演/评分/片长；
  // 书籍补出版社/ISBN/页数；音乐走 iTunes lookup（幂等，字段与搜索一致）。
  async function enrichWorkDetail(type, r) {
    if (!r || !r.external_id) return null;
    const kind = type === 'book' ? 'book' : 'movie';
    if (type === 'movie' && window.InnerOSApi) {
      try {
        const res = await window.InnerOSApi.get(`/api/v1/media/detail?type=movie&id=${encodeURIComponent(r.external_id)}`);
        if (res.data && res.data.title) return mediaToWorkFields(res.data, 'movie');
      } catch (e) {
        console.warn('[movie] v1 详情失败，回退 legacy：', (e && (e.code || e.message)) || e);
      }
    }
    if (type === 'book' && window.InnerOSApi) {
      try {
        const res = await window.InnerOSApi.get(`/api/v1/media/detail?type=book&id=${encodeURIComponent(r.external_id)}`);
        if (res.data && res.data.title) return mediaToWorkFields(res.data, 'book');
      } catch (e) {
        console.warn('[book] v1 详情失败，回退 legacy：', (e && (e.code || e.message)) || e);
      }
    }
    if (type === 'music' && window.InnerOSApi) {
      try {
        const res = await window.InnerOSApi.get(`/api/v1/media/detail?type=music&id=${encodeURIComponent(r.external_id)}`);
        if (res.data && res.data.title) return mediaToWorkFields(res.data, 'music');
      } catch (e) {
        console.warn('[music] v1 详情失败，沿用搜索字段：', (e && (e.code || e.message)) || e);
      }
    }
    // 豆瓣详情兜底只对 movie/book 生效（music 走 iTunes，避免用 trackId 误查豆瓣）
    if (type === 'music') return null;
    return legacyDoubanDetail(kind, r.external_id);
  }

  // 单一命名空间暴露（与 InnerOSApi 同模式，Object.freeze 防误改）
  window.InnerOSMedia = Object.freeze({
    mediaToWorkFields: mediaToWorkFields,
    searchMovie: searchMovie,
    searchBook: searchBook,
    searchMusic: searchMusic,
    enrichWorkDetail: enrichWorkDetail,
  });
})();
