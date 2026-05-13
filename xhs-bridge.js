// 前程智囊团 · 小红书 API 拦截桥
// 注入 MAIN 世界，拦截 fetch/XHR 获取结构化笔记数据
(() => {
  const BRIDGE_FLAG = '__QIANCHENG_XHS_BRIDGE__';
  const RESPONSE_STORE = '__QIANCHENG_XHS_RESPONSES__';
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

  function isNoteDetail(url) {
    try {
      const p = new URL(String(url || ''), location.href).pathname;
      return /^\/(explore|discovery\/item)\/[A-Za-z0-9]+/i.test(p);
    } catch { return false; }
  }

  function isProfilePage(url) {
    try {
      const p = new URL(String(url || ''), location.href).pathname;
      return /^\/user\/profile\/[A-Za-z0-9]+/i.test(p);
    } catch { return false; }
  }

  function parseJSON(text) {
    const s = String(text || '').trim();
    if (!s || !/^[\[{]/.test(s)) return null;
    try { return JSON.parse(s); } catch { return null; }
  }

  function extractNoteData(apiResult) {
    // 小红书 API 返回的笔记数据有多种嵌套结构，向下兼容
    const d = apiResult?.data || apiResult;
    if (!d || typeof d !== 'object') return null;
    
    const note = d.note || d.note_detail || d.item || d;
    if (!note || typeof note !== 'object') return null;

    return {
      note_id: note.note_id || note.id || '',
      title: note.title || note.display_title || '',
      desc: note.desc || note.content || '',
      type: note.type || 'normal',
      author: {
        user_id: note.user?.user_id || note.user?.id || d.user?.user_id || '',
        nickname: note.user?.nickname || note.user?.nick_name || d.user?.nickname || '',
        avatar: note.user?.avatar || note.user?.images || d.user?.avatar || '',
      },
      tags: (note.tag_list || note.tags || []).map(t => typeof t === 'string' ? t : (t.name || t.tag_name || '')),
      images: extractImages(note),
      interaction: {
        liked_count: note.interact_info?.liked_count || note.liked_count || 0,
        collected_count: note.interact_info?.collected_count || note.collected_count || 0,
        comment_count: note.interact_info?.comment_count || note.comment_count || 0,
        shared_count: note.interact_info?.shared_count || note.shared_count || 0,
      },
      raw: d,
    };
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

  function extractProfileData(apiResult) {
    const d = apiResult?.data || apiResult;
    if (!d || typeof d !== 'object') return null;
    const user = d.user || d.user_info || d;
    if (!user || !user.user_id) return null;
    return {
      user_id: user.user_id || user.id || '',
      nickname: user.nickname || user.nick_name || '',
      avatar: user.avatar || user.image || '',
      follower_count: user.follower_count || user.fans || 0,
      note_count: user.note_count || user.notes || 0,
      desc: user.desc || user.description || '',
    };
  }

  function remember(record) {
    if (!record?.url || !record?.result) return;
    const store = window[RESPONSE_STORE];
    store.push({
      url: String(record.url),
      type: record.type || 'note',
      profile: record.profile || null,
      note: record.note || null,
      capturedAt: Date.now(),
    });
    while (store.length > MAX_RESPONSES) store.shift();

    // 广播给 page-observer
    window.postMessage({
      source: 'qiancheng-xhs-bridge',
      type: 'xhs-api-response',
      payload: {
        url: record.url,
        noteType: record.type,
        note: record.note,
        profile: record.profile,
        capturedAt: Date.now(),
      },
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

        if (isNoteDetail(url)) {
          const note = extractNoteData(json);
          if (note) remember({ url, type: 'note', note });
        } else if (isProfilePage(url)) {
          const profile = extractProfileData(json);
          if (profile) remember({ url, type: 'profile', profile });
        }
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
        if (isNoteDetail(url)) {
          const note = extractNoteData(json);
          if (note) remember({ url, type: 'note', note });
        }
      });
      return origSend.apply(this, arguments);
    };
  }

  console.log('🔗 前程智囊团 XHS Bridge 已激活');
})();
