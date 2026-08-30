// iTunes Adapter（ARCH-011）——把 iTunes Search / Lookup 响应转成 InnerOS 标准模型
// 规则（与 douban-adapter 一致）：外部字段不泄漏到 UI/Domain，原始数据只进 providerMetadata。
// 数据源：iTunes Search API（https://itunes.apple.com/search / lookup）
//   - 免 API Key、公开、CORS 友好；country=CN 覆盖中文歌曲与歌手。
//   - 音乐（entity=song）字段：trackName/artistName/collectionName/releaseDate/
//     primaryGenreName/artworkUrl100(可升 600)/previewUrl/trackPrice/currency/trackTimeMillis。
// 说明：iTunes 无评分/简介字段，score 恒为 null、description 恒为 ''（标准模型字段语义保留）。

const BASE = 'https://itunes.apple.com';
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

async function fetchItunes(url) {
  const res = await fetch(url, { headers: { 'User-Agent': UA } });
  if (!res.ok) throw new Error('itunes ' + res.status);
  return res.json();
}

// ---- 纯函数：iTunes track → 标准 Media（可单测）----
export function mapTrack(item) {
  const artwork = (item.artworkUrl100 || '').replace('100x100bb', '600x600bb');
  return {
    externalId: String(item.trackId || ''),
    mediaType: 'music',
    source: 'itunes',
    title: item.trackName || '',
    originalTitle: '',
    poster: artwork,
    releaseDate: (item.releaseDate || '').slice(0, 10),
    creators: item.artistName ? [item.artistName] : [],
    genres: item.primaryGenreName ? [item.primaryGenreName] : [],
    score: null,
    description: '',
    providerMetadata: {
      album: item.collectionName || '',
      trackId: item.trackId ? String(item.trackId) : '',
      previewUrl: item.previewUrl || '',
      trackPrice: item.trackPrice == null ? null : item.trackPrice,
      currency: item.currency || '',
      primaryGenreName: item.primaryGenreName || '',
      trackTimeMillis: item.trackTimeMillis || null,
    },
  };
}

// ---- 标准接口（与 douban-adapter 同名，供 media-service 依赖注入）----
export async function searchMedia({ type, query }) {
  const url = `${BASE}/search?media=music&entity=song&country=CN&limit=8&term=${encodeURIComponent(query)}`;
  const data = await fetchItunes(url);
  return (data.results || []).map(mapTrack);
}

export async function getMediaDetail({ type, id }) {
  const url = `${BASE}/lookup?id=${encodeURIComponent(id)}&country=CN`;
  const data = await fetchItunes(url);
  // lookup 可能返回同 id 的多个 wrapperType（track/artist/collection），取首个歌曲
  const r = (data.results || []).find(x => x.wrapperType === 'track' || x.kind === 'song');
  if (!r) throw new Error('itunes track not found');
  return mapTrack(r);
}

// Provider 形态（media-service 依赖注入用）
export const itunesProvider = {
  name: 'itunes',
  async search({ type, query }) { return searchMedia({ type, query }); },
  async detail({ type, id }) { return getMediaDetail({ type, id }); },
};
