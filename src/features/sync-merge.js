// 同步合并纯逻辑（V1.32）——只处理普通对象，不碰 DOM / IndexedDB，可被 node 直接单测。
//
// 背景（真实事故根因）：
//   1) upsert_memory 曾把整条记录（含 entries[].photos 的 base64 原图）塞进 payload，
//      单值动辄数 MB，超过 D1 绑定上限 → 推送永远失败；其他设备只拿到 append_entry，
//      于是出现「（同步恢复中）」空壳，手机与电脑记录对不上。
//   2) 客户端回放 upsert_memory 时用 {...本地, ...远端} 整体覆盖 entries，
//      远端旧快照会把本机较新的条目抹掉；V1.29 的「按账户从 0 重放一次」
//      让这个问题在一次运行中批量发生 —— 这就是「数据丢了」的直接原因。
//
// 本模块固化修复后的不变量：
//   - upsert_memory 只承载元数据（slimMemory 剔除 entries / photos / data URL）；
//   - entries 只由 append_entry / update_entry / delete_entry 维护，只增不减；
//   - 照片只由 upsert_attachment 补齐，按 photo_id 挂回对应篇章；
//   - 远端 upsert 携带的 entries 只在本地完全没有条目时作为兜底，永不覆盖本地条目。
(function () {
  'use strict';

  const DROP_KEYS = ['id', 'legacy_id', '_conflicts', 'sync_shell', 'entries', 'photos', 'photo_ids'];

  function isDataUrl(v) {
    return typeof v === 'string' && v.slice(0, 5) === 'data:';
  }

  // 记录 → 上传快照：只保留可安全同步的元数据
  function slimMemory(rec) {
    const out = {};
    const src = rec && typeof rec === 'object' ? rec : {};
    Object.keys(src).forEach(function (k) {
      if (DROP_KEYS.indexOf(k) >= 0) return;
      const v = src[k];
      if (isDataUrl(v)) return; // 任何 data URL 都不进 upsert（照片走附件协议）
      out[k] = v;
    });
    return out;
  }

  function toEntry(raw) {
    const e = raw && typeof raw === 'object' ? raw : {};
    return {
      id: e.id,
      created_at: e.created_at || '',
      content: e.content || '',
      photos: Array.isArray(e.photos) ? e.photos.slice() : [],
      photo_ids: Array.isArray(e.photo_ids) ? e.photo_ids.slice() : [],
    };
  }

  // 追加篇章：同 id 幂等，绝不覆盖已有内容
  function appendEntry(entries, entry) {
    const list = Array.isArray(entries) ? entries.slice() : [];
    if (!entry || !entry.id) return { entries: list, changed: false };
    if (list.some(function (x) { return x && x.id === entry.id; })) {
      return { entries: list, changed: false };
    }
    list.push(toEntry(entry));
    return { entries: list, changed: true };
  }

  // 修改篇章正文（此前客户端完全没处理 update_entry，导致改字在其他设备永远不生效）
  function updateEntry(entries, entryId, content) {
    const list = Array.isArray(entries) ? entries.slice() : [];
    let changed = false;
    for (let i = 0; i < list.length; i++) {
      if (list[i] && list[i].id === entryId) {
        if (list[i].content !== content) {
          list[i] = Object.assign({}, list[i], { content: content || '' });
          changed = true;
        }
        break;
      }
    }
    return { entries: list, changed: changed };
  }

  // 删除篇章
  function removeEntry(entries, entryId) {
    const list = Array.isArray(entries) ? entries.filter(function (x) { return !x || x.id !== entryId; }) : [];
    return { entries: list, changed: list.length !== (entries || []).length };
  }

  // 合并远端 upsert：本地条目优先，远端只补缺失的元数据
  function mergeMemory(local, incoming, updatedAt) {
    const inc = incoming && typeof incoming === 'object' ? incoming : {};
    if (!local) {
      const seed = Object.assign({}, inc);
      seed.entries = Array.isArray(inc.entries) ? inc.entries.map(toEntry) : [];
      if (updatedAt) seed.updated_at = updatedAt;
      return seed;
    }
    const localEntries = Array.isArray(local.entries) ? local.entries : [];
    const localIsNewer = !local.sync_shell && local.updated_at && updatedAt && String(local.updated_at) > String(updatedAt);
    if (localIsNewer) {
      // 本地比远端新（例如刚保存但推送还没成功）：只补远端有而本地没有的字段，不覆盖本地内容
      const mergedNewer = Object.assign({}, inc, local, { id: local.id, entries: localEntries });
      delete mergedNewer.sync_shell;
      return mergedNewer;
    }
    const merged = Object.assign({}, local, inc, { id: local.id });
    if (localEntries.length === 0 && Array.isArray(inc.entries) && inc.entries.length) {
      // 兼容：本地还没有任何篇章时，才允许用远端快照兜底
      merged.entries = inc.entries.map(toEntry);
    } else {
      merged.entries = localEntries;
    }
    delete merged.sync_shell;
    if (updatedAt) merged.updated_at = updatedAt;
    else if (!merged.updated_at && local.updated_at) merged.updated_at = local.updated_at;
    return merged;
  }

  // 把附件挂回引用它的篇章；没有任何篇章引用时返回 false（调用方暂存后重试）
  function attachPhoto(mem, attId, dataURL) {
    if (!mem || !Array.isArray(mem.entries) || !attId || !dataURL) return false;
    let placed = false;
    mem.entries = mem.entries.map(function (en) {
      if (!en || !Array.isArray(en.photo_ids) || en.photo_ids.indexOf(attId) < 0) return en;
      const photos = Array.isArray(en.photos) ? en.photos.slice() : [];
      if (photos.indexOf(dataURL) < 0) photos.push(dataURL);
      placed = true;
      return Object.assign({}, en, { photos: photos });
    });
    return placed;
  }

  const api = { isDataUrl: isDataUrl, slimMemory: slimMemory, appendEntry: appendEntry, updateEntry: updateEntry, removeEntry: removeEntry, mergeMemory: mergeMemory, attachPhoto: attachPhoto };
  if (typeof window !== 'undefined') window.InnerOSSyncMerge = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api; // 兼容 node 直跑
})();
