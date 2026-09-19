// 前程-灵感素材库 · 页面数据拦截桥
// 注入 MAIN 世界，拦截 fetch/XHR 获取结构化笔记数据
(() => {
  const BRIDGE_FLAG = '__QIANCHENG_IDEAHUB_BRIDGE__';
  const RESPONSE_STORE = '__QIANCHENG_IDEAHUB_RESPONSES__';
  const MAX_RESPONSES = 200;

  if (window[BRIDGE_FLAG]) return;
  window[BRIDGE_FLAG] = true;
  window[RESPONSE_STORE] = [];

  function isXHSHost(url) {
    try {
      const h = new URL(String(url || ''), location.href).hostname.toLowerCase();
      return /(^|\.)xiaohongshu\.com$/i.test(h) || /(^|\.)rednote\.com$/i.test(h);
    } catch { return false; }
  }

  function parseJSON(text) {
    const s = String(text || '').trim();
    if (!s || !/^[\[{]/.test(s)) return null;
    try { return JSON.parse(s); } catch { return null; }
  }

  function normalizeTag(t) {
    const v = String(t || '').trim().replace(/^#+/, '');
    return v ? `#${v}` : '';
  }

  function extractImages(note) {
    const imgs = [];
    const list = note.image_list || note.images_list || note.images || [];
    for (const item of list) {
      if (typeof item === 'string') { imgs.push(item); continue; }
      const url = item.url || item.url_default || item.original || item.fileid || '';
      if (url) imgs.push(url);
      // 尝试获取高清版本
      if (item.url_size_large) imgs.push(item.url_size_large);
    }
    if (!imgs.length && note.cover?.url) imgs.push(note.cover.url);
    return [...new Set(imgs)];
  }

  function findNoteInResponse(result) {
    if (!result || typeof result !== 'object') return null;
    const d = result.data || result;
    if (!d || typeof d !== 'object') return null;
    const candidates = [];
    const pushIfObj = (v) => { if (v && typeof v === 'object') candidates.push(v); };
    pushIfObj(d.note); pushIfObj(d.note_detail); pushIfObj(d.item);
    pushIfObj(d.feed); pushIfObj(d.note_card);
    if (d.data) { pushIfObj(d.data.note); pushIfObj(d.data.item); }
    const items = d.items || d.feeds || d.note_cards || [];
    if (Array.isArray(items)) for (const item of items.slice(0, 50)) pushIfObj(item.note_card || item.noteCard || item.note || item);
    for (const c of candidates) if (c.title || c.display_title || c.desc || c.note_id) return c;
    if ((d.note_id || d.id) && (d.title || d.display_title)) return d;
    return null;
  }

  function parseCountText(value) {
    if (!value) return 0;
    const text = String(value).trim().replace(/[\s,]/g, '').replace(/[^0-9.\u4e00-\u9fa5]/g, '');
    if (!text) return 0;
    if (text.includes('万')) { const n = parseFloat(text.replace('万', '')); return isNaN(n) ? 0 : Math.round(n * 10000); }
    const n = parseFloat(text);
    return isNaN(n) ? 0 : Math.round(n);
  }

  function formatTimestamp(ts) {
    if (!ts) return '';
    const d = new Date(Number(ts));
    if (isNaN(d.getTime())) return '';
    const pad = n => String(n).padStart(2, '0');
    return d.getFullYear() + '-' + pad(d.getMonth()+1) + '-' + pad(d.getDate()) + ' ' + pad(d.getHours()) + ':' + pad(d.getMinutes());
  }

  function extractNoteFromResponse(result) {
    const note = findNoteInResponse(result);
    if (!note) return null;
    const interact = note.interact_info || note.interaction || {};
    let ts = 0;
    for (const f of ['time','timestamp','create_time','createTime','publish_time','publishTime','last_update_time','lastUpdateTime']) {
      if (note[f] != null) { const n = Number(note[f]); if (n > 0) { ts = n > 1000000000000 ? n : n * 1000; break; } }
    }
    return {
      note_id: note.note_id || note.noteId || note.id || '',
      title: note.title || note.display_title || note.displayTitle || '',
      desc: note.desc || note.content || '',
      author: { nickname: note.user?.nickname || note.user?.nick_name || note.user?.nickName || '' },
      tags: (note.tag_list || note.tagList || note.tags || []).map(t => {
        const v = String(typeof t === 'string' ? t : (t.name || t.tag_name || t.tagName || '')).trim().replace(/^#+/, '');
        return v ? '#' + v : '';
      }).filter(Boolean),
      images: extractImages(note),
      publish_time: ts,
      publish_time_text: formatTimestamp(ts),
      interaction: {
        liked_count: parseCountText(interact.liked_count ?? interact.likedCount ?? note.liked_count ?? note.likedCount ?? note.likes ?? 0),
        collected_count: parseCountText(interact.collected_count ?? interact.collectedCount ?? note.collected_count ?? note.collectedCount ?? note.collects ?? 0),
        comment_count: parseCountText(interact.comment_count ?? interact.commentCount ?? note.comment_count ?? note.commentCount ?? note.comments ?? 0),
      },
    };
  }

  function remember(record) {
    if (!record?.url || !record?.result) return;
    const extracted = extractNoteFromResponse(record.result);
    const store = window[RESPONSE_STORE];
    store.push({ url: String(record.url), type: 'note', note: extracted, capturedAt: Date.now() });
    while (store.length > MAX_RESPONSES) store.shift();
    window.postMessage({
      source: 'qiancheng-ideahub-bridge',
      type: 'xhs-api-response',
      payload: { url: record.url, noteType: 'note', note: extracted, capturedAt: Date.now() },
    }, '*');
  }
  // 劫持 fetch
  const nativeFetch = window.fetch;
  if (typeof nativeFetch === 'function') {
    window.fetch = async function(...args) {
      const resp = await nativeFetch.apply(this, args);
      const url = String(args[0]?.url || args[0] || resp.url || '');
      if (!isXHSHost(url)) return resp;
      
      try {
        const clone = resp.clone();
        const text = await clone.text();
        const json = parseJSON(text);
        if (!json) return resp;

        remember({ url, type: 'note', result: json });
      } catch {}
      return resp;
    };
  }

  // 劫持 XMLHttpRequest
  if (window.XMLHttpRequest?.prototype) {
    const origOpen = XMLHttpRequest.prototype.open;
    const origSend = XMLHttpRequest.prototype.send;
    XMLHttpRequest.prototype.open = function(method, url) {
      this.__qc_method = method;
      this.__qc_url = url;
      return origOpen.apply(this, arguments);
    };
    XMLHttpRequest.prototype.send = function(body) {
      this.addEventListener('loadend', () => {
        const url = this.responseURL || this.__qc_url || '';
        if (!isXHSHost(url)) return;
        const json = parseJSON(this.responseText);
        if (!json) return;
        remember({ url, type: 'note', result: json });
      });
      return origSend.apply(this, arguments);
    };
  }

  console.log('🔗 前程-灵感素材库 数据拦截桥 已激活');
})();
