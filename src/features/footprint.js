// InnerOS 前端足迹地图模块（ARCH-014 / V1.18.0）
// 从 app.js 迁出，独立模块（IIFE + window.InnerOSFootprint，与 media.js/api-client.js 同模式）。
// 功能：
//   - 高德矢量瓦片（美观、中文标注完整，免 Key 公开瓦片）
//   - 地点标记（按年份颜色区分，点击弹详情+照片）
//   - 批量地理编码补全经纬度（后端 /api/v1/geocode 代理 Nominatim）
//   - 工具栏：添加地点（快速记录）、全景缩放
// 边界：
//   - 本模块不碰 app.js 内部变量，依赖全局函数（dbGetAll/dbGet/dbPut/escapeHtml/openDetail 等），
//     这些在 render 调用时已就绪（app.js 先于本模块执行完毕）；
//   - 不改变数据契约，经纬度存记录的 lat/lng 字段，与 app.js 旧逻辑兼容。
(function () {
  'use strict';

  let map = null;
  let markers = [];
  let currentPlaces = [];

  // 高德矢量瓦片（街道图，中文标注，免 Key 公开瓦片）
  const AMAP_URL = 'https://webrd0{s}.is.autonavi.com/appmaptile?lang=zh_cn&size=1&scale=1&style=8&x={x}&y={y}&z={z}';
  const COLORS = ['#C75450', '#C97B63', '#C9A961', '#88A096', '#5A8BAD', '#6B5B95', '#B07555', '#8B8B8B'];

  function colorForYear(year, allYears) {
    const idx = allYears.indexOf(String(year));
    return COLORS[idx % COLORS.length];
  }

  // 收集所有地点：place 类型 + event 类型带 location
  async function collectPlaces() {
    const all = await window.dbGetAll();
    const places = [];
    for (const e of all) {
      if (e.type === 'place') {
        places.push({ id: e.id, name: e.title || e.location || '未命名', location: e.location || '', date: window.getEntryDate(e) || '', lat: e.lat, lng: e.lng, record: e });
      } else if (e.type === 'event' && e.location) {
        places.push({ id: e.id, name: e.location, location: e.location || '', date: window.getEntryDate(e) || '', lat: e.lat, lng: e.lng, record: e });
      }
    }
    return places;
  }

  // 收集某个地点的所有照片（place 记录自身的 entries[].photos + 同 location 的 event 记录照片）
  function collectPhotos(place) {
    const photos = [];
    const rec = place.record;
    if (rec && rec.entries) {
      for (const en of rec.entries) {
        if (en.photos && en.photos.length) photos.push(...en.photos);
      }
    }
    return photos;
  }

  function addMarker(place, allYears) {
    if (!map || place.lat == null || place.lng == null) return;
    const year = place.date ? place.date.slice(0, 4) : '未知';
    const color = colorForYear(year, allYears);
    const photos = collectPhotos(place);
    const photoHtml = photos.length > 0
      ? `<div class="fp-photos">${photos.slice(0, 4).map(p => `<img src="${p}" class="fp-photo-thumb" onclick="window.openViewer('${p}')">`).join('')}${photos.length > 4 ? `<span class="fp-photo-more">+${photos.length - 4}</span>` : ''}</div>`
      : '';
    const marker = L.circleMarker([place.lat, place.lng], {
      radius: 9,
      fillColor: color,
      color: '#fff',
      weight: 2.5,
      opacity: 1,
      fillOpacity: 0.9,
    }).addTo(map);
    marker.bindPopup(`<div class="fp-popup">
      <div class="fp-popup-title">${window.escapeHtml(place.name)}</div>
      ${place.location && place.location !== place.name ? `<div class="fp-popup-addr">${window.escapeHtml(place.location)}</div>` : ''}
      <div class="fp-popup-date">${place.date || '日期未知'}${photos.length ? ` · ${photos.length} 张照片` : ''}</div>
      ${photoHtml}
      <div class="fp-popup-actions">
        <button class="btn btn-ghost fp-popup-btn" onclick="window.openDetail('${place.id}')">查看记录</button>
      </div>
    </div>`, { maxWidth: 280 });
    markers.push(marker);
  }

  function fitAll() {
    if (!map || markers.length === 0) return;
    const group = L.featureGroup(markers);
    map.fitBounds(group.getBounds().pad(0.2));
  }

  // 串行地理编码（Nominatim 限 1 req/s，间隔 1.1s）
  async function batchGeocode(places, allYears, progressEl) {
    let done = 0;
    for (const p of places) {
      done++;
      if (progressEl) progressEl.textContent = `地理编码中 ${done}/${places.length}：${p.name}`;
      try {
        const res = await window.InnerOSApi.get(`/api/v1/geocode?q=${encodeURIComponent(p.name)}`);
        const geo = res.data || {};
        if (geo.lat != null && geo.lon != null) {
          p.lat = geo.lat; p.lng = geo.lon;
          const rec = await window.dbGet(p.id);
          if (rec) {
            rec.lat = geo.lat; rec.lng = geo.lng;
            await window.dbPut(rec);
            try { if (window.authState && window.authState.loggedIn) { await window.enqueueMemoryUpsert(rec); window.syncNow(); } } catch (e) { console.warn('足迹同步入队失败', e); }
          }
          addMarker(p, allYears);
          if (markers.length > 0) fitAll();
        }
      } catch (e) {
        console.warn('[footprint] 地理编码失败', p.name, e);
      }
      if (done < places.length) await new Promise(r => setTimeout(r, 1100));
    }
    if (progressEl) progressEl.textContent = `地理编码完成（${places.length} 个地点）`;
  }

  // 主渲染入口（app.js 的 renderFootprintMap 委托到此）
  async function render() {
    currentPlaces = await collectPlaces();
    const located = currentPlaces.filter(p => p.lat != null && p.lng != null);
    const needsGeo = currentPlaces.filter(p => p.lat == null || p.lng == null);
    const allYears = [...new Set(currentPlaces.map(p => p.date ? p.date.slice(0, 4) : '未知').filter(Boolean))].sort().reverse();

    let html = `<div class="page-header"><div class="page-title">足迹 · Footprint</div><div class="page-subtitle">共 ${currentPlaces.length} 个地点 · 已定位 ${located.length} · 待定位 ${needsGeo.length}</div></div>`;
    html += `<div class="fp-toolbar">
      <button class="btn btn-primary fp-add-btn" onclick="window.fpAddPlace()">＋ 添加地点</button>
      <button class="btn btn-ghost" onclick="window.InnerOSFootprint.fitAll()">全景</button>
      <span class="fp-progress" id="fp-progress">${needsGeo.length > 0 ? '正在地理编码…' : '全部已定位'}</span>
    </div>`;
    html += `<div id="fp-map" class="fp-map"></div>`;
    if (currentPlaces.length === 0) {
      html += `<div class="empty-state"><div class="empty-state-icon">📍</div><div class="empty-state-title">还没有地点记录</div><div class="empty-state-desc">点击上方「添加地点」按钮，记录你去过的地方</div></div>`;
    }
    document.getElementById('content').innerHTML = html;

    if (currentPlaces.length === 0) return;

    requestAnimationFrame(() => {
      if (map) { map.remove(); map = null; }
      markers = [];
      map = L.map('fp-map', { zoomControl: true, attributionControl: true }).setView([35.0, 105.0], 4);
      L.tileLayer(AMAP_URL, {
        subdomains: ['1', '2', '3', '4'],
        attribution: '&copy; 高德地图',
        maxZoom: 18,
      }).addTo(map);
      for (const p of located) addMarker(p, allYears);
      if (located.length > 0) fitAll();
      if (needsGeo.length > 0) batchGeocode(needsGeo, allYears, document.getElementById('fp-progress'));
    });
  }

  // 快速添加地点（打开 capture 表单，预选 place 类型）
  function addPlace() {
    if (typeof window.captureTriggerClick === 'function') {
      window.captureTriggerClick();
      // 延迟选择 place 类型（等弹窗渲染完）
      setTimeout(() => {
        const placeCard = document.querySelector('.type-card[data-type="place"]');
        if (placeCard) placeCard.click();
      }, 100);
    }
  }

  window.InnerOSFootprint = Object.freeze({
    render: render,
    fitAll: fitAll,
  });
  // 全局快捷函数（供内联 onclick 调用）
  window.fpAddPlace = addPlace;
})();
