// ============================================================
// 速记 · Quick（代替微信传输助手：随手发文字/照片给自己，全设备同步）
// ============================================================
let pendingChatPhotos = [];

async function renderQuickChat() {
  const all = (await dbGetAll()).filter(r => r.type === 'quick')
    .sort((a, b) => String(a.created_at || '').localeCompare(String(b.created_at || '')));
  let html = `<div class="page-header"><div class="page-title">速记 · Quick</div><div class="page-subtitle">随手发文字 / 照片给自己，登录后全设备同步</div></div>`;
  html += `<div class="chat-thread" id="chat-thread">`;
  if (!all.length) {
    html += `<div class="empty-state" style="padding:40px 16px;"><div class="empty-state-icon">💬</div><div class="empty-state-title">发第一条速记给自己</div><div class="empty-state-desc">下方输入文字或点 📎 加照片，发送即保存并同步。</div></div>`;
  }
  for (const mem of all) {
    const day = (mem.title || '').replace('速记 ', '') || (getEntryDate(mem) || '');
    html += `<div class="chat-day">${day}</div>`;
    const sorted = [...(mem.entries || [])].sort((a, b) => String(a.created_at || '').localeCompare(String(b.created_at || '')));
    for (const en of sorted) {
      const ts = String(en.created_at || '').slice(11, 16);
      const imgs = (en.photos || []).map(p => `<img class="chat-photo" src="${p}" onclick="this.classList.toggle('expanded')">`).join('');
      html += `<div class="chat-msg"><div class="chat-bubble">${en.content ? `<div class="chat-text">${escapeHtml(en.content)}</div>` : ''}${imgs}</div><div class="chat-time">${ts}</div></div>`;
    }
  }
  html += `</div><div class="chat-inputbar">
    <div class="chat-previews" id="chat-previews"></div>
    <div class="chat-input-row">
      <label class="chat-attach-btn" title="添加照片">📎<input type="file" accept="image/jpeg,image/png,image/webp" multiple style="display:none" onchange="handleChatPhotos(this)"></label>
      <input type="text" class="chat-input" id="chat-input" placeholder="给自己发一条…" onkeydown="if(event.key==='Enter')sendQuickMsg()">
      <button class="chat-send-btn" onclick="sendQuickMsg()">发送</button>
    </div>
  </div>`;
  document.getElementById('content').innerHTML = html;
  requestAnimationFrame(() => window.scrollTo(0, document.body.scrollHeight));
}

function escapeHtml(str) {
  return String(str || '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

async function handleChatPhotos(inp) {
  for (const f of Array.from(inp.files || [])) {
    if (f.size > 10 * 1024 * 1024) { showToast('图片不能超过10MB: ' + f.name, 'error'); continue; }
    try { pendingChatPhotos.push(await fileToDataURL(f)); } catch (e) { showToast('图片读取失败', 'error'); }
  }
  inp.value = '';
  renderChatPreviews();
}
function removeChatPhoto(i) {
  pendingChatPhotos.splice(i, 1);
  renderChatPreviews();
}
function renderChatPreviews() {
  const prev = document.getElementById('chat-previews');
  if (prev) prev.innerHTML = pendingChatPhotos.map((p, i) => `<img class="chat-preview" src="${p}" onclick="removeChatPhoto(${i})" title="点击移除">`).join('');
}

async function sendQuickMsg() {
  const input = document.getElementById('chat-input');
  const content = (input ? input.value : '').trim();
  if (!content && !pendingChatPhotos.length) { showToast('先输入文字或添加照片', ''); return; }
  const today = localDate();
  const all = await dbGetAll();
  let mem = all.find(r => r.type === 'quick' && getEntryDate(r) === today);
  if (!mem) {
    mem = { id: uuid(), type: 'quick', title: '速记 ' + today, created_at: new Date().toISOString(), entries: [] };
  }
  mem.entries = mem.entries || [];
  const entry = { id: uuid(), created_at: new Date().toISOString(), content, photos: pendingChatPhotos.slice(), photo_ids: [] };
  mem.entries.push(entry);
  mem.updated_at = entry.created_at;
  await dbPut(mem);
  try {
    if (authState.loggedIn) {
      await enqueueMemoryUpsert(mem);
      await enqueueEntryAppend(mem.id, entry);
      syncNow();
    }
  } catch (e) { console.warn('速记同步入队失败', e); }
  pendingChatPhotos = [];
  renderQuickChat();
}
