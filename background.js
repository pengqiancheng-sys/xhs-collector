// 前程智囊团 · 采集插件 v2.3 Background
// 完全重构：简化任务流程，确保采集可靠执行

const FEISHU_BASE = 'https://open.feishu.cn/open-apis/bitable/v1';
const FEISHU_DRIVE = 'https://open.feishu.cn/open-apis/drive/v1';
const FEISHU_AUTH = 'https://open.feishu.cn/open-apis/auth/v3/tenant_access_token/internal';
const APP_TOKEN = 'NyOtb2ybzav3e8s7bmlcWfg8nmb';
const TABLE_ID = 'tblK9xb6LcoWyt2H';
const APP_ID = 'cli_a9029657efb81bc7';
const APP_SECRET = 'EHBfRWQsU5VHFjIBK8i2XcDTBGlajmZW';
const UPDATE_SOURCE_MANIFEST_URL = 'https://raw.githubusercontent.com/pengqiancheng-sys/xhs-collector/main/manifest.json';
const UPDATE_SOURCE_REPO_URL = 'https://github.com/pengqiancheng-sys/xhs-collector';
const UPDATE_ALARM_NAME = 'qc-update-check';

let accessToken = null;
let tokenExpiresAt = 0;

// ====== 初始化 ======
(async function init() {
  // Side Panel
  if (chrome.sidePanel?.setPanelBehavior) {
    chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(() => {});
  }

  // 右键菜单
  chrome.contextMenus.removeAll(() => {
    chrome.contextMenus.create({ id: 'qc-save-page', title: '📦 采集当前页面', contexts: ['page'] });
    chrome.contextMenus.create({ id: 'qc-save-link', title: '🔗 采集此链接', contexts: ['link'] });
    chrome.contextMenus.create({ id: 'qc-save-image', title: '🖼️ 采集此图片', contexts: ['image'] });
  });

  chrome.contextMenus.onClicked.addListener((info, tab) => {
    if (info.menuItemId === 'qc-save-page') captureCurrentTab(tab);
    else if (info.menuItemId === 'qc-save-link') saveLink(info.linkUrl, info.selectionText || info.linkUrl);
    else if (info.menuItemId === 'qc-save-image') saveImage(info.srcUrl, info.pageUrl);
  });

  // 消息路由
  chrome.runtime.onMessage.addListener(handleMessage);

  // 更新检测
  initUpdateCheck();

  console.log('🚀 前程智囊团 v2.3 已启动');
})();

// ====== Token ======
async function getToken() {
  if (accessToken && Date.now() < tokenExpiresAt - 600000) return accessToken;

  const resp = await fetch(FEISHU_AUTH, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ app_id: APP_ID, app_secret: APP_SECRET }),
  });
  const data = await resp.json();
  if (data.code !== 0) throw new Error(`Token获取失败: ${data.msg}`);
  
  accessToken = data.tenant_access_token;
  tokenExpiresAt = Date.now() + data.expire * 1000;
  console.log('🔄 Token已刷新, 有效期:', data.expire, 's');
  return accessToken;
}

// ====== 核心: 采集当前页面 ======
async function captureCurrentTab(tab) {
  if (!tab?.id) return;
  
  try {
    // 1. 从 content script 获取 DOM 数据
    let pageInfo = {};
    try { pageInfo = await chrome.tabs.sendMessage(tab.id, { type: 'extract-page' }); } catch(e) {}

    // 2. 从 xhs-bridge (MAIN) 获取 API 精确数据
    let apiData = null;
    try {
      const results = await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        func: () => {
          const store = window.__QIANCHENG_XHS_RESPONSES__ || [];
          const latest = store.filter(r => r.note).slice(-1);
          return latest.length ? latest[0].note : null;
        },
        world: 'MAIN',
      });
      if (results?.[0]?.result) apiData = results[0].result;
    } catch(e) { console.warn('API data fetch:', e.message); }

    // 2.5 专用图片抓取 - 直接在页面上遍历所有 img/背景图
    let domImages = [];
    try {
      const imgResults = await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        func: () => {
          const urls = new Set();
          // 判断是否小红书笔记详情页
          const isNotePage = /^\/(explore|discovery\/item)\//i.test(location.pathname);
          const isYouTube = location.hostname.includes('youtube.com');
          
          // 策略1: 小红书笔记页 - 只抓笔记内容区域的图片
          if (isNotePage) {
            // 笔记轮播图区域（最核心的图片）
            const noteArea = document.querySelector('#noteContainer, [class*="note"], .note-scroller, .note-image, [class*="detail"]');
            const container = noteArea || document;
            
            // swiper 轮播图
            container.querySelectorAll('.swiper-slide img, [class*="swiper"] img, [class*="carousel"] img, [class*="slide"] img').forEach(img => {
              const src = img.src || img.getAttribute('data-src') || img.getAttribute('data-original') || '';
              if (src && src.startsWith('http')) urls.add(src);
            });
            
            // 如果轮播没抓到，尝试从笔记区域的所有 img
            if (urls.size === 0 && noteArea) {
              noteArea.querySelectorAll('img').forEach(img => {
                const src = img.src || img.getAttribute('data-src') || '';
                if (src && src.startsWith('http') && !src.includes('avatar') && !src.includes('icon')) {
                  urls.add(src);
                }
              });
            }
            
            // og:image 作为兜底
            if (urls.size === 0) {
              const og = document.querySelector('meta[property="og:image"]');
              if (og && og.content && og.content.startsWith('http')) urls.add(og.content);
            }
          }
          // 策略2: YouTube
          else if (isYouTube) {
            const thumb = document.querySelector('meta[property="og:image"]');
            if (thumb && thumb.content && thumb.content.startsWith('http')) urls.add(thumb.content);
          }
          // 策略3: 通用网页 - og:image
          else {
            const og = document.querySelector('meta[property="og:image"]');
            if (og && og.content && og.content.startsWith('http')) urls.add(og.content);
          }
          
          return Array.from(urls).slice(0, 12);
        },
      });
      if (imgResults?.[0]?.result) domImages = imgResults[0].result;
    } catch(e) { console.warn('Image fetch:', e.message); }

    // 3. 合并数据
    const title = apiData?.title || pageInfo?.title || tab.title || '(无标题)';
    const author = apiData?.author?.nickname || pageInfo?.author || '';
    const text = (apiData?.desc || pageInfo?.text || '').substring(0, 5000);
    // 图片: API数据优先 > 专用图片抓取 > pageInfo DOM
    const images = apiData?.images?.length ? apiData.images : (domImages.length ? domImages : (pageInfo?.images || []));
    const noteId = apiData?.note_id || '';
    const platformMap = { xhs: '小红书', youtube: 'YouTube', web: '网页' };
    const platform = platformMap[pageInfo?.platform] || '其他';
    let sourceUrl = tab.url || pageInfo?.url || '';
    if (!sourceUrl && noteId) sourceUrl = `https://www.xiaohongshu.com/explore/${noteId}`;

    console.log('📥 采集数据:', { title: title.substring(0,40), author, platform, textLen: text.length, apiImages: apiData?.images?.length||0, domImages: domImages.length, pageImages: pageInfo?.images?.length||0, finalImages: images.length });
    console.log('📸 图片URLs:', images.slice(0, 5));

    // 4. 收集图片URL（飞书drive上传API暂不可用，先存链接）
    const maxImg = Math.min(images.length, 9);
    console.log(`📸 图片 ${images.length} 张, 取前 ${maxImg} 张`); 
    const imageUrls = images.slice(0, maxImg).join('\n');
    console.log('📸 图片URLs:', images.slice(0, 3));

    // 5. 构建字段
    const fields = {
      '选题标题': title,
      '多行文本': text || title,
      '作者/来源': author || '',
      '来源平台': platform,
      '选题来源': '浏览器采集',
      '状态': '待选题',
      '优先级': '中',
    };
    if (sourceUrl) fields['来源链接'] = { link: sourceUrl, text: title.substring(0, 50) };
    if (fileTokens.length) fields['素材图片'] = fileTokens;

    // 6. 写入飞书
    const token = await getToken();
    let resp = await fetch(`${FEISHU_BASE}/apps/${APP_TOKEN}/tables/${TABLE_ID}/records`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ fields }),
    });

    if (!resp.ok) {
      const err = await resp.json().catch(() => ({}));
      // Token 过期重试
      if (resp.status === 401 || err.code === 99991663) {
        accessToken = null; tokenExpiresAt = 0;
        const newToken = await getToken();
        resp = await fetch(`${FEISHU_BASE}/apps/${APP_TOKEN}/tables/${TABLE_ID}/records`, {
          method: 'POST',
          headers: { 'Authorization': `Bearer ${newToken}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ fields }),
        });
      }
    }

    if (resp.ok) {
      const result = await resp.json();
      console.log('✅ 飞书写入成功:', result.data?.record?.fields?.['选题标题']);
      // 通知侧边栏
      chrome.runtime.sendMessage({
        type: 'capture:result',
        success: true,
        title: title.substring(0, 40),
        images: images.length,
      }).catch(() => {});
    } else {
      const err = await resp.json().catch(() => ({}));
      throw new Error(err.msg || `HTTP ${resp.status}`);
    }
  } catch (e) {
    console.error('❌ 采集失败:', e.message);
    chrome.runtime.sendMessage({
      type: 'capture:result',
      success: false,
      error: e.message,
    }).catch(() => {});
  }
}

// ====== 图片上传（分片上传法：upload_prepare + upload_part + upload_finish）
async function uploadImage(url, index) {
  // 1. 下载图片
  const imgResp = await fetch(url, { signal: AbortSignal.timeout(20000) });
  if (!imgResp.ok) throw new Error(`下载 ${imgResp.status}`);
  const blob = await imgResp.blob();
  if (blob.size > 20 * 1024 * 1024) throw new Error('图片过大');
  console.log(`📸 图片${index}: ${blob.size} bytes, type=${blob.type}`);

  // 2. 预上传
  const token = await getToken();
  const prepResp = await fetch(`${FEISHU_DRIVE}/medias/upload_prepare`, {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      file_name: `img_${index}.jpg`,
      parent_type: 'bitable_file',
      parent_node: APP_TOKEN,
      size: blob.size,
    }),
  });
  const prep = await prepResp.json();
  if (prep.code !== 0) throw new Error(`预上传: ${prep.msg}`);
  const uploadId = prep.data.upload_id;

  // 3. 上传分片
  const partForm = new FormData();
  partForm.append('upload_id', uploadId);
  partForm.append('seq', '0');
  partForm.append('size', String(blob.size));
  partForm.append('file', blob, `img_${index}.jpg`);

  const partResp = await fetch(`${FEISHU_DRIVE}/medias/upload_part`, {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${token}` },
    body: partForm,
  });
  const part = await partResp.json();
  if (part.code !== 0) throw new Error(`上传分片: ${part.msg}`);

  // 4. 完成上传
  const finishResp = await fetch(`${FEISHU_DRIVE}/medias/upload_finish`, {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ upload_id: uploadId, block_num: 1 }),
  });
  const finish = await finishResp.json();
  if (finish.code !== 0) throw new Error(`完成上传: ${finish.msg}`);

  const fileToken = finish.data?.file_token;
  console.log(`📸 图片${index} 上传成功: ${fileToken}`);
  return fileToken;
}

// ====== 简单采集 ======
async function saveLink(url, title) {
  try {
    const token = await getToken();
    await fetch(`${FEISHU_BASE}/apps/${APP_TOKEN}/tables/${TABLE_ID}/records`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        fields: {
          '选题标题': title || url,
          '来源链接': { link: url, text: title || url },
          '来源平台': '其他',
          '选题来源': '链接采集',
          '状态': '待选题',
          '优先级': '中',
        },
      }),
    });
    console.log('✅ 链接已采集');
  } catch(e) { console.error('链接采集失败:', e.message); }
}

async function saveImage(url, pageUrl) {
  try {
    const token = await getToken();
    await fetch(`${FEISHU_BASE}/apps/${APP_TOKEN}/tables/${TABLE_ID}/records`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        fields: {
          '选题标题': pageUrl || '图片素材',
          '来源链接': { link: url, text: '采集的图片' },
          '来源平台': '其他',
          '选题来源': '图片采集',
          '状态': '待选题',
        },
      }),
    });
    console.log('✅ 图片已采集');
  } catch(e) { console.error('图片采集失败:', e.message); }
}

// ====== 博主批量采集 ======
async function collectBloggerNotes(tabId, limit, intervalMs) {
  let apiNotes = [];
  try {
    const results = await chrome.scripting.executeScript({
      target: { tabId },
      func: () => {
        const store = window.__QIANCHENG_XHS_RESPONSES__ || [];
        return store.filter(r => r.note).map(r => r.note).slice(-50);
      },
      world: 'MAIN',
    });
    if (results?.[0]?.result) apiNotes = results[0].result;
  } catch(e) { console.warn('API fetch:', e.message); }

  if (!apiNotes.length) throw new Error('未捕获到API数据。请确保在博主主页，且已滚动加载笔记。');

  const notes = apiNotes.slice(0, Math.min(limit, apiNotes.length));
  let saved = 0;

  for (let i = 0; i < notes.length; i++) {
    const n = notes[i];
    try {
      let imgUrls = '';
      if (n.images?.length) {
        imgUrls = n.images.slice(0, 3).join('\n');
      }

      const fields = {
        '选题标题': n.title || '(无标题)',
        '多行文本': (n.desc || '').substring(0, 5000),
        '作者/来源': n.author?.nickname || '',
        '来源平台': '小红书',
        '选题来源': '博主采集',
        '状态': '待选题',
        '优先级': '中',
      };
      if (n.note_id) fields['来源链接'] = { link: `https://www.xiaohongshu.com/explore/${n.note_id}`, text: n.title };
      if (fileTokens.length) fields['素材图片'] = fileTokens;

      const token = await getToken();
      await fetch(`${FEISHU_BASE}/apps/${APP_TOKEN}/tables/${TABLE_ID}/records`, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ fields }),
      });
      saved++;
      chrome.runtime.sendMessage({ type: 'blogger:progress', saved, total: notes.length }).catch(() => {});

      if (saved < notes.length) await new Promise(r => setTimeout(r, intervalMs));
    } catch(e) { console.error(`笔记${i}采集失败:`, e.message); }
  }

  chrome.runtime.sendMessage({ type: 'blogger:done', saved, total: notes.length }).catch(() => {});
}

// ====== 更新检测 ======
function compareVersions(a, b) {
  const pa = String(a||'0').split('.').map(Number), pb = String(b||'0').split('.').map(Number);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const na = pa[i]||0, nb = pb[i]||0;
    if (na > nb) return 1;
    if (na < nb) return -1;
  }
  return 0;
}

async function initUpdateCheck() {
  await chrome.alarms.clear(UPDATE_ALARM_NAME).catch(() => {});
  await chrome.alarms.create(UPDATE_ALARM_NAME, { periodInMinutes: 360 });
  chrome.alarms.onAlarm.addListener(async (alarm) => {
    if (alarm.name !== UPDATE_ALARM_NAME) return;
    await checkUpdate(false);
  });
  await checkUpdate(false);
}

async function checkUpdate(force) {
  try {
    const currentVersion = chrome.runtime.getManifest().version;
    const resp = await fetch(UPDATE_SOURCE_MANIFEST_URL, { cache: 'no-store' });
    if (!resp.ok) return;
    const remote = await resp.json();
    const latestVersion = String(remote?.version || currentVersion);
    const hasUpdate = compareVersions(latestVersion, currentVersion) > 0;

    await chrome.action.setBadgeBackgroundColor({ color: '#e8590c' }).catch(() => {});
    await chrome.action.setBadgeText({ text: hasUpdate ? 'NEW' : '' }).catch(() => {});
    await chrome.action.setTitle({
      title: hasUpdate ? `新版本 v${latestVersion}` : `v${currentVersion}`
    }).catch(() => {});

    await chrome.storage.local.set({
      updateState: { currentVersion, latestVersion, hasUpdate, lastCheckedAt: Date.now() },
    });
    console.log(`🔍 更新: v${currentVersion} → ${hasUpdate ? '🆕 v'+latestVersion : '✅ 最新'}`);
  } catch(e) { console.warn('更新检查失败:', e.message); }
}

// ====== 消息路由 ======
function handleMessage(msg, sender, sendResponse) {
  (async () => {
    switch (msg.type) {
      case 'sidepanel:get-context': {
        const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
        let pageInfo = {};
        if (tab?.id) {
          try { pageInfo = await chrome.tabs.sendMessage(tab.id, { type: 'extract-page' }); } catch {}
        }
        const updateState = (await chrome.storage.local.get(['updateState'])).updateState || {};
        sendResponse({
          tab: tab ? { id: tab.id, url: tab.url, title: tab.title } : null,
          pageInfo,
          tokenOk: !!accessToken,
          update: updateState,
        });
        break;
      }

      case 'capture:save-page': {
        const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
        if (!tab) { sendResponse({ success: false, error: '无当前标签页' }); break; }
        // 异步执行，不等结果
        captureCurrentTab(tab).catch(e => console.error(e));
        sendResponse({ success: true, message: '采集已启动' });
        break;
      }

      case 'capture:save-xhs': {
        const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
        if (!tab) { sendResponse({ success: false, error: '无当前标签页' }); break; }
        captureCurrentTab(tab).catch(e => console.error(e));
        sendResponse({ success: true, message: '小红书采集已启动' });
        break;
      }

      case 'capture:collect-blogger': {
        const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
        if (!tab) { sendResponse({ success: false, error: '无当前标签页' }); break; }
        collectBloggerNotes(tab.id, msg.limit || 30, msg.intervalMs || 2000).catch(e => console.error(e));
        sendResponse({ success: true, message: '批量采集已启动' });
        break;
      }

      case 'auth:refresh': {
        accessToken = null; tokenExpiresAt = 0;
        try { await getToken(); sendResponse({ success: true }); } catch(e) { sendResponse({ success: false, error: e.message }); }
        break;
      }

      case 'update:check': {
        await checkUpdate(true);
        const updateState = (await chrome.storage.local.get(['updateState'])).updateState || {};
        sendResponse({ success: true, update: updateState });
        break;
      }

      case 'update:get-status': {
        const updateState = (await chrome.storage.local.get(['updateState'])).updateState || {};
        sendResponse({ success: true, update: updateState });
        break;
      }

      default:
        sendResponse({ success: false, error: '未知消息类型' });
    }
  })().catch(e => sendResponse({ success: false, error: e.message }));
  return true;
}
