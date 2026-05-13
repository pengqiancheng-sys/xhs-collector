// 前程智囊团 · 页面观察器 v2.1
// 增强: 深度DOM解析 + API数据融合
(() => {
  let lastPageInfo = null;
  let lastUrl = location.href;
  let urlWatchTimer = null;

  function normalize(s) { return String(s || '').trim(); }

  function getPlatformInfo() {
    const host = location.hostname.toLowerCase();
    if (/(^|\.)xiaohongshu\.com$/i.test(host) || /(^|\.)rednote\.com$/i.test(host)) {
      return { platform: 'xhs', name: '小红书', emoji: '🔴' };
    }
    if (host === 'youtube.com' || host.endsWith('.youtube.com') || host === 'youtu.be') {
      return { platform: 'youtube', name: 'YouTube', emoji: '▶️' };
    }
    return { platform: 'web', name: '网页', emoji: '🌐' };
  }

  function getPageType() {
    const host = location.hostname.toLowerCase();
    const path = location.pathname;
    if (/(^|\.)xiaohongshu\.com$/i.test(host) || /(^|\.)rednote\.com$/i.test(host)) {
      if (/^\/(explore|discovery\/item)\//i.test(path)) return 'note';
      if (/^\/user\/profile\//i.test(path)) return 'profile';
      return 'xhs-page';
    }
    if (host === 'youtube.com' || host.endsWith('.youtube.com')) {
      if (path.startsWith('/watch') || path.startsWith('/shorts/')) return 'video';
      if (path.startsWith('/@') || path.startsWith('/channel/')) return 'channel';
      return 'youtube-page';
    }
    return 'web';
  }

  // ====== 小红书深度 DOM 解析 ======
  function extractXhsDomData() {
    const data = { title: '', author: '', text: '', images: [], tags: [] };

    // 标题 - 多选择器兜底
    const titleSelectors = [
      '#detail-title', '#note-title', 'h1.title', 'h1[class*="title"]',
      '.note-title', '[class*="note-title"]', '.interaction-title',
      'meta[property="og:title"]',
    ];
    for (const sel of titleSelectors) {
      const el = document.querySelector(sel);
      if (el) {
        data.title = normalize(el.textContent || el.content || '');
        if (data.title) break;
      }
    }

    // 作者
    const authorSelectors = [
      '.username span', '.author-name', '[class*="nickname"]',
      '.author-wrapper .name', '.publish-container .name',
      '[class*="username"]', 'a[class*="name"] span',
    ];
    for (const sel of authorSelectors) {
      const el = document.querySelector(sel);
      if (el) {
        data.author = normalize(el.textContent);
        if (data.author) break;
      }
    }

    // 正文 - 取完整内容
    const descSelectors = [
      '#detail-desc', '.note-text', '[class*="note-text"]',
      '.desc', '[class*="desc"]', '.content',
      '.note-scroller .note-content', '[class*="note-content"]',
      '#noteContainer .content',
    ];
    for (const sel of descSelectors) {
      const el = document.querySelector(sel);
      if (el) {
        // 获取纯文本，排除标签
        data.text = normalize(el.textContent);
        // 提取话题标签
        const tagEls = el.querySelectorAll('a[href*="tag"], [class*="tag"], [class*="hash"]');
        tagEls.forEach(t => {
          const tagText = normalize(t.textContent).replace(/^#/, '');
          if (tagText && !data.tags.includes(tagText)) data.tags.push(tagText);
        });
        if (data.text) break;
      }
    }

    // 如果正文为空，尝试从所有可能的选择器组合
    if (!data.text) {
      const allSelectors = [
        '#detail-desc', '.note-text', '[class*="note-text"]', '.desc',
        '[class*="desc"]', '.content', '[class*="content"]', '[class*="detail"]',
      ].join(',');
      const els = document.querySelectorAll(allSelectors);
      // 取文本最长的那个
      let longest = '';
      els.forEach(el => {
        const t = normalize(el.textContent);
        if (t.length > longest.length && t.length > 50) longest = t;
      });
      if (longest) data.text = longest;
    }

    // 图片 - 宽松匹配，抓取所有可能的笔记图片
    const seen = new Set();
    // 优先：从 xhs-bridge 的 API 数据中获取（MAIN 世界不可访问，这里用 DOM 兜底）
    // DOM 全面抓取
    document.querySelectorAll('img').forEach(el => {
      const src = el.src || el.dataset.src || el.dataset.original || el.getAttribute('data-src') || '';
      if (!src || !src.startsWith('http')) return;
      // 过滤掉纯图标、表情、头像（太小的一般是UI元素）
      const w = el.naturalWidth || el.width || 0;
      const h = el.naturalHeight || el.height || 0;
      if (w > 0 && h > 0 && (w < 50 || h < 50)) return;  // 过小跳过
      if (src.includes('emoji') || src.includes('favicon')) return;
      if (!seen.has(src) && data.images.length < 12) {
        seen.add(src);
        data.images.push(src);
      }
    });
    // 也检查 og:image
    const ogImg = document.querySelector('meta[property="og:image"]');
    if (ogImg && ogImg.content && ogImg.content.startsWith('http') && !seen.has(ogImg.content)) {
      data.images.push(ogImg.content);
    }

    // 去重
    data.images = [...new Set(data.images)];

    return data;
  }

  // ====== YouTube 深度 DOM 解析 ======
  function extractYoutubeDomData() {
    const data = { title: '', author: '', text: '', images: [] };

    const titleEl = document.querySelector('h1.ytd-watch-metadata, #title h1 yt-formatted-string, h1[class*="title"]');
    if (titleEl) data.title = normalize(titleEl.textContent);

    const channelSelectors = ['#owner a', 'ytd-channel-name a', '#channel-name a', '#text-container a', 'ytd-video-owner-renderer a'];
    for (const sel of channelSelectors) {
      const el = document.querySelector(sel);
      if (el) { data.author = normalize(el.textContent); break; }
    }

    // 描述 - 取完整
    const descSelectors = [
      '#description-inline-expander [slot="content"]',
      '#description [slot="content"]',
      'ytd-expander [slot="content"]',
      '#snippet [slot="content"]',
    ];
    for (const sel of descSelectors) {
      const el = document.querySelector(sel);
      if (el) {
        data.text = normalize(el.textContent).substring(0, 3000);
        break;
      }
    }

    const thumbMeta = document.querySelector('meta[property="og:image"]');
    if (thumbMeta) data.images.push(thumbMeta.content);

    return data;
  }

  function buildPageInfo() {
    const platform = getPlatformInfo();
    const pageType = getPageType();
    let domData;

    if (platform.platform === 'xhs' && pageType === 'note') {
      domData = extractXhsDomData();
    } else if (platform.platform === 'youtube' && pageType === 'video') {
      domData = extractYoutubeDomData();
    } else {
      domData = {
        title: normalize(document.title),
        author: normalize(document.querySelector('meta[name="author"]')?.content || location.hostname),
        text: normalize(document.querySelector('meta[name="description"]')?.content || '').substring(0, 500),
        images: [],
      };
      // 通用网页 og:image
      const ogImg = document.querySelector('meta[property="og:image"]');
      if (ogImg) domData.images.push(ogImg.content);
    }

    return {
      platform: platform.platform,
      platformName: platform.name,
      pageType,
      url: location.href,
      title: domData.title || normalize(document.title),
      author: domData.author,
      text: domData.text,
      images: [...new Set(domData.images)],
      tags: domData.tags || [],
      hasApiData: false,
      collectedAt: new Date().toISOString(),
    };
  }

  function emit() {
    const info = buildPageInfo();
    if (JSON.stringify(info) === JSON.stringify(lastPageInfo)) return;
    lastPageInfo = info;
    lastUrl = location.href;
    chrome.runtime.sendMessage({ type: 'page-info:update', pageInfo: info, tabUrl: location.href }).catch(() => {});
  }

  // 监听 xhs-bridge (MAIN 世界) 的 API 数据
  window.addEventListener('message', (event) => {
    if (event.source !== window) return;
    if (event.data?.source === 'qiancheng-xhs-bridge' && event.data?.type === 'xhs-api-response') {
      const payload = event.data.payload;
      if (payload?.note) {
        const n = payload.note;
        lastPageInfo = {
          ...(lastPageInfo || buildPageInfo()),
          title: n.title || lastPageInfo?.title || '',
          author: n.author?.nickname || lastPageInfo?.author || '',
          text: n.desc || lastPageInfo?.text || '',
          images: n.images?.length ? n.images : lastPageInfo?.images || [],
          tags: n.tags?.length ? n.tags : lastPageInfo?.tags || [],
          hasApiData: true,
          apiNoteId: n.note_id || '',
          apiInteraction: n.interaction || null,
        };
        chrome.runtime.sendMessage({
          type: 'page-info:update',
          pageInfo: lastPageInfo,
          tabUrl: location.href,
        }).catch(() => {});
      }
    }
  });

  // DOM 变化监听
  let emitTimer = null;
  const observer = new MutationObserver(() => {
    if (emitTimer) clearTimeout(emitTimer);
    emitTimer = setTimeout(emit, 600);
  });
  const root = document.body || document.documentElement;
  if (root) {
    observer.observe(root, { childList: true, subtree: true, attributes: true, attributeFilter: ['src', 'class'] });
  }

  // URL 变化 (SPA)
  function watchUrl() {
    if (location.href !== lastUrl) {
      lastPageInfo = null;
      setTimeout(emit, 1000);
    }
    urlWatchTimer = setTimeout(watchUrl, 300);
  }
  watchUrl();

  setTimeout(emit, 800);

  // 响应提取请求
  chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    if (msg.type === 'extract-page') {
      sendResponse(buildPageInfo());
    }
  });

  console.log('👁️ 前程智囊团 Page Observer v2.1 已激活');
})();
