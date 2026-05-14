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

  function normalizeTag(t) {
    const v = String(t || '').trim().replace(/^#+/, '');
    return v ? `#${v}` : '';
  }

  function toNumber(v) {
    if (v === undefined || v === null || v === '') return 0;
    if (typeof v === 'number') return v;
    let s = String(v).trim().replace(/,/g, '');
    if (!s || s === '赞' || s === '收藏' || s === '评论') return 0;
    const m = s.match(/[\d.]+/);
    if (!m) return 0;
    let n = Number(m[0]);
    if (!Number.isFinite(n)) return 0;
    if (s.includes('万')) n *= 10000;
    if (s.toLowerCase().includes('k')) n *= 1000;
    return Math.round(n);
  }

  function pick(obj, paths) {
    for (const path of paths) {
      let cur = obj;
      for (const k of path.split('.')) cur = cur?.[k];
      if (cur !== undefined && cur !== null && cur !== '') return cur;
    }
    return undefined;
  }

  function normalizeTimestamp(v) {
    if (v === undefined || v === null || v === '') return 0;
    if (typeof v === 'number') {
      if (v > 1000000000000) return v;
      if (v > 1000000000) return v * 1000;
      return 0;
    }
    const s = String(v).trim();
    if (/^\d+$/.test(s)) return normalizeTimestamp(Number(s));
    const t = Date.parse(s.replace(/-/g, '/'));
    return Number.isFinite(t) ? t : 0;
  }

  function formatTime(ts) {
    if (!ts) return '';
    const d = new Date(ts);
    const pad = n => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
  }

  function findNoteObject(root) {
    if (!root || typeof root !== 'object') return null;
    const d = root.data || root;
    if (!d || typeof d !== 'object') return null;

    // 优先按已知路径匹配
    const candidates = [];
    function push(c) { if (c && typeof c === 'object') candidates.push(c); }

    // 笔记详情返回格式常见结构
    push(d.note); push(d.note_detail); push(d.item);
    push(d.feed); push(d.note_card); push(d.noteCard);
    push(d.data?.note); push(d.data?.item);

    // 搜索/列表返回格式
    const items = d.items || d.feeds || d.notes || d.note_cards || d.noteCards || [];
    if (Array.isArray(items)) items.slice(0, 100).forEach(item => {
      push(item.note_card || item.noteCard || item.note || item);
    });

    // 递归查找
    if (d.note_list) {
      for (const item of (Array.isArray(d.note_list) ? d.note_list : [])) {
        push(item.note || item);
      }
    }

    for (const cand of candidates) {
      // 必须有标题或内容才能确认是笔记对象
      if ((cand.title || cand.display_title || cand.displayTitle || cand.desc || cand.content) && !cand.code) {
        return cand;
      }
    }
    // 兜底：尝试整个 data 本身
    if ((d.title || d.display_title || d.displayTitle) && !d.code) return d;
    if (d.note_id || d.noteId) return d;
    return null;
  }
  function extractNoteData(apiResult) {
    // 小红书 API 返回结构很多，这里递归寻找真正的笔记对象
    const d = apiResult?.data || apiResult;
    if (!d || typeof d !== 'object') return null;
    const note = findNoteObject(d) || d.note || d.note_detail || d.item || d;
    if (!note || typeof note !== 'object') return null;

    const interact = note.interact_info || note.interactInfo || note.interaction || {};
    const ts = normalizeTimestamp(pick(note, [
      'time', 'timestamp', 'create_time', 'createTime', 'created_time', 'createdTime',
      'publish_time', 'publishTime', 'publishTimeMs', 'last_update_time', 'lastUpdateTime'
    ]) || pick(d, ['time', 'timestamp', 'create_time', 'createTime', 'publish_time', 'publishTime']));

    return {
      note_id: note.note_id || note.noteId || note.id || '',
      title: note.title || note.display_title || note.displayTitle || '',
      desc: note.desc || note.content || note.description || '',
      type: note.type || 'normal',
      author: {
        user_id: note.user?.user_id || note.user?.userId || note.user?.id || d.user?.user_id || '',
        nickname: note.user?.nickname || note.user?.nick_name || note.user?.nickName || d.user?.nickname || '',
        avatar: note.user?.avatar || note.user?.images || d.user?.avatar || '',
      },
      tags: (note.tag_list || note.tagList || note.tags || [])
        .map(t => normalizeTag(typeof t === 'string' ? t : (t.name || t.tag_name || t.tagName || '')))
        .filter(Boolean),
      images: extractImages(note),
      publish_time: ts,
      publish_time_text: formatTime(ts),
      interaction: {
        liked_count: toNumber(interact.liked_count ?? interact.likedCount ?? note.liked_count ?? note.likedCount ?? note.likes),
        collected_count: toNumber(interact.collected_count ?? interact.collectedCount ?? note.collected_count ?? note.collectedCount ?? note.collects),
        comment_count: toNumber(interact.comment_count ?? interact.commentCount ?? note.comment_count ?? note.commentCount ?? note.comments),
        shared_count: toNumber(interact.shared_count ?? interact.sharedCount ?? note.shared_count ?? note.sharedCount ?? note.shares),
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
      source: 'qiancheng-xhs-bridge',
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
        if (isProfilePage(url)) {
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
        remember({ url, type: 'note', result: json });
      });
      return origSend.apply(this, arguments);
    };
  }

  console.log('🔗 前程智囊团 XHS Bridge 已激活');
})();
