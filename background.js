// 前程智囊团 v3.0 — 对标 RedBox 任务队列架构
const FEISHU_BASE = 'https://open.feishu.cn/open-apis/bitable/v1';
const FEISHU_DRIVE = 'https://open.feishu.cn/open-apis/drive/v1';
const FEISHU_AUTH = 'https://open.feishu.cn/open-apis/auth/v3/tenant_access_token/internal';
const APP_TOKEN = 'NyOtb2ybzav3e8s7bmlcWfg8nmb';
const TABLE_ID = 'tblK9xb6LcoWyt2H';
const APP_ID = 'cli_a9029657efb81bc7';
const APP_SECRET = 'EHBfRWQsU5VHFjIBK8i2XcDTBGlajmZW';
const UPDATE_URL = 'https://raw.githubusercontent.com/pengqiancheng-sys/xhs-collector/main/manifest.json';

// 状态
let accessToken = null, tokenExpiresAt = 0;
let taskSeq = 0;
const taskQueue = [];
let activeTask = null;
let lastTask = null;
const taskLogs = [];
const MAX_LOGS = 100;
const COLLECT_INTERVAL_MS = 2500;

// ====== 初始化 ======
(async () => {
  if (chrome.sidePanel?.setPanelBehavior) {
    chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(() => {});
  }
  setupMenus();
  chrome.runtime.onMessage.addListener(handleMessage);
  setInterval(processQueue, 1000);
  initUpdate();
  console.log('🚀 前程智囊团 v3.0');
})();

function setupMenus() {
  chrome.contextMenus.removeAll(() => {
    chrome.contextMenus.create({ id: 'qc-page', title: '📦 采集页面', contexts: ['page'] });
    chrome.contextMenus.create({ id: 'qc-link', title: '🔗 采集链接', contexts: ['link'] });
    chrome.contextMenus.create({ id: 'qc-image', title: '🖼️ 采集图片', contexts: ['image'] });
  });
  chrome.contextMenus.onClicked.addListener((info, tab) => {
    if (info.menuItemId === 'qc-page') enqueue({ type: 'capture-page', tabId: tab?.id });
    else if (info.menuItemId === 'qc-link') enqueue({ type: 'capture-link', url: info.linkUrl, title: info.selectionText });
    else if (info.menuItemId === 'qc-image') enqueue({ type: 'capture-image', url: info.srcUrl, pageUrl: info.pageUrl });
  });
}

// ====== Token ======
async function getToken() {
  if (accessToken && Date.now() < tokenExpiresAt - 600000) return accessToken;
  const r = await fetch(FEISHU_AUTH, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ app_id: APP_ID, app_secret: APP_SECRET }),
  });
  const d = await r.json();
  if (d.code !== 0) throw new Error(d.msg);
  accessToken = d.tenant_access_token;
  tokenExpiresAt = Date.now() + d.expire * 1000;
  return accessToken;
}

// ====== 飞书 API ======
async function feishuWrite(fields) {
  const token = await getToken();
  const r = await fetch(`${FEISHU_BASE}/apps/${APP_TOKEN}/tables/${TABLE_ID}/records`, {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ fields }),
  });
  if (!r.ok) {
    const e = await r.json().catch(() => ({}));
    if (r.status === 401 || e.code === 99991663) {
      accessToken = null; tokenExpiresAt = 0;
      const newToken = await getToken();
      const retry = await fetch(`${FEISHU_BASE}/apps/${APP_TOKEN}/tables/${TABLE_ID}/records`, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${newToken}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ fields }),
      });
      if (!retry.ok) throw new Error((await retry.json().catch(() => ({}))).msg || 'write fail');
      return retry.json();
    }
    throw new Error(e.msg || `HTTP ${r.status}`);
  }
  return r.json();
}

// ====== 图片上传(分片法) ======
async function uploadImage(url) {
  const imgR = await fetch(url, { signal: AbortSignal.timeout(20000) });
  if (!imgR.ok) throw new Error(`dl ${imgR.status}`);
  const blob = await imgR.blob();
  if (blob.size > 20 * 1024 * 1024) throw new Error('big');

  const token = await getToken();
  // prep
  const p = await fetch(`${FEISHU_DRIVE}/medias/upload_prepare`, {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ file_name: 'img.jpg', parent_type: 'bitable_file', parent_node: APP_TOKEN, size: blob.size }),
  });
  const pd = await p.json();
  if (pd.code !== 0) throw new Error(pd.msg);
  const uid = pd.data.upload_id;

  // part
  const pf = new FormData();
  pf.append('upload_id', uid); pf.append('seq', '0'); pf.append('size', String(blob.size));
  pf.append('file', blob, 'img.jpg');
  const pr = await fetch(`${FEISHU_DRIVE}/medias/upload_part`, {
    method: 'POST', headers: { 'Authorization': `Bearer ${token}` }, body: pf,
  });
  if ((await pr.json()).code !== 0) throw new Error('part fail');

  // finish
  const fr = await fetch(`${FEISHU_DRIVE}/medias/upload_finish`, {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ upload_id: uid, block_num: 1 }),
  });
  const fd = await fr.json();
  if (fd.code !== 0) throw new Error(fd.msg);
  return fd.data.file_token;
}

// ====== 任务队列 ======
function enqueue(task) {
  taskSeq++; task.id = taskSeq; task.status = 'queued'; task.createdAt = Date.now();
  taskQueue.push(task);
  if (taskQueue.length > 200) taskQueue.shift();
  addLog('enqueue', `${task.type} #${taskSeq}`, 'info');
  broadcast();
}

async function processQueue() {
  if (activeTask || !taskQueue.length) return;
  activeTask = taskQueue.shift();
  activeTask.status = 'running';
  activeTask.startedAt = Date.now();
  broadcast();
  try {
    await executeTask(activeTask);
    activeTask.status = 'completed';
    activeTask.completedAt = Date.now();
    addLog('done', `✅ ${activeTask.type} #${activeTask.id}`, 'success');
  } catch (e) {
    activeTask.status = 'failed';
    activeTask.error = e.message;
    addLog('fail', `❌ ${activeTask.type}: ${e.message}`, 'error');
  }
  if (activeTask.status !== 'failed') lastTask = { ...activeTask };
  activeTask = null;
  broadcast();
}

async function executeTask(t) {
  switch (t.type) {
    case 'capture-page': await capturePage(t); break;
    case 'capture-link': await captureLink(t); break;
    case 'capture-image': await captureImage(t); break;
    case 'collect-blogger': await collectBlogger(t); break;
    case 'collect-batch': await collectBatch(t); break;
  }
}

// ====== 核心: 采集页面 ======
async function capturePage(t) {
  const tabId = t.tabId;
  if (!tabId) {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab?.id) throw new Error('no tab');
    t.tabId = tab.id; t.url = tab.url; t.title = tab.title;
  }

  // 获取页面信息
  let pageInfo = {};
  try { pageInfo = await chrome.tabs.sendMessage(t.tabId, { type: 'extract-page' }); } catch {}
  
  // 获取 API 数据
  let apiData = null;
  try {
    const r = await chrome.scripting.executeScript({
      target: { tabId: t.tabId },
      func: () => {
        const s = window.__QIANCHENG_XHS_RESPONSES__ || [];
        return s.filter(r => r.note).pop()?.note || null;
      },
      world: 'MAIN',
    });
    if (r?.[0]?.result) apiData = r[0].result;
  } catch {}

  // 获取图片 — 用 RedBox 风格
  let images = [];
  try {
    const r = await chrome.scripting.executeScript({
      target: { tabId: t.tabId },
      func: () => {
        const urls = [];
        const add = (u) => { if (u && u.startsWith('http') && !urls.includes(u)) urls.push(u); };
        const isComment = (el) => {
          while (el) {
            if (el.closest && el.closest('.comments, [class*="comment"], .comment-container, .note-comment')) return true;
            el = el.parentElement;
          }
          return false;
        };
        
        if (/^\/(explore|discovery\/item)\//i.test(location.pathname)) {
          // 优先 swiper 轮播图
          const slides = Array.from(document.querySelectorAll('.note-slider .swiper-slide, .swiper .swiper-slide'))
            .filter(s => !s.classList.contains('swiper-slide-duplicate') && !isComment(s));
          slides.forEach(s => {
            const im = s.querySelector('img');
            if (im) add(im.getAttribute('src') || im.src);
          });
          // 兜底: img-container
          if (!urls.length) {
            document.querySelectorAll('.img-container img, .note-image img, .swiper-slide img').forEach(im => {
              if (!isComment(im) && !im.closest('[class*="avatar"]')) add(im.src || im.getAttribute('src'));
            });
          }
          // 兜底2: og:image
          if (!urls.length) {
            const og = document.querySelector('meta[property="og:image"]');
            if (og?.content) add(og.content);
          }
        }
        return urls.slice(0, 12);
      },
    });
    if (r?.[0]?.result) images = r[0].result;
  } catch {}

  // 专门提取正文（DOM深度解析经常失败，这里再兜底一次）
  let domText = pageInfo?.text || '';
  let domPlatform = pageInfo?.platform || '';
  if (!domText || domText.length < 50) {
    try {
      const r = await chrome.scripting.executeScript({
        target: { tabId: t.tabId },
        func: () => {
          // 小红书正文专用提取
          const host = location.hostname;
          if (host.includes('xiaohongshu.com') || host.includes('rednote.com')) {
            // 按优先级尝试
            const selectors = [
              '#detail-desc', '.note-text', '.desc', '[class*="desc"]',
              '.note-content', '[class*="note-content"]',
              '#noteContainer .content', '.note-scroller .content',
            ];
            for (const sel of selectors) {
              const el = document.querySelector(sel);
              if (el) {
                const t = (el.textContent || '').trim();
                if (t.length > 30) return { text: t.substring(0, 5000), platform: 'xhs' };
              }
            }
            // 兜底: 所有符合选择器的元素中最长文本
            const all = document.querySelectorAll(selectors.join(','));
            let best = '';
            all.forEach(el => { const t = (el.textContent || '').trim(); if (t.length > best.length) best = t; });
            if (best.length > 30) return { text: best.substring(0, 5000), platform: 'xhs' };
            return { text: '', platform: 'xhs' };
          }
          if (host.includes('youtube.com')) {
            const el = document.querySelector('#description-inline-expander [slot="content"], #description [slot="content"]');
            return { text: (el?.textContent || '').trim().substring(0, 3000), platform: 'youtube' };
          }
          return { text: (document.querySelector('meta[name="description"]')?.content || '').substring(0, 500), platform: 'web' };
        },
      });
      if (r?.[0]?.result) {
        domText = r[0].result.text || domText;
        domPlatform = r[0].result.platform || domPlatform;
      }
    } catch(e) { console.warn('text extract:', e.message); }
  }

  // 合并数据
  const title = apiData?.title || pageInfo?.title || t.title || '(无标题)';
  const author = apiData?.author?.nickname || pageInfo?.author || '';
  const text = (apiData?.desc || domText || pageInfo?.text || '').substring(0, 5000);
  const platform = domPlatform === 'xhs' ? '小红书' : domPlatform === 'youtube' ? 'YouTube' : '网页';
  let sourceUrl = t.url || pageInfo?.url || '';
  if (!sourceUrl && apiData?.note_id) sourceUrl = `https://www.xiaohongshu.com/explore/${apiData.note_id}`;

  addLog('capture', `📸 ${title.substring(0, 40)} · ${images.length} 图`, 'info');

  // 上传图片
  let fileTokens = [];
  for (let i = 0; i < Math.min(images.length, 9); i++) {
    try {
      const ft = await uploadImage(images[i]);
      if (ft) fileTokens.push({ file_token: ft });
    } catch(e) { console.warn(`img${i}:`, e.message); }
  }
  addLog('upload', `📸 ${fileTokens.length}/${Math.min(images.length, 9)} 上传`, 'info');

  // 写入飞书
  const fields = { '选题标题': title, '多行文本': text || title, '作者/来源': author, '来源平台': platform, '选题来源': '浏览器采集', '状态': '待选题', '优先级': '中' };
  if (sourceUrl) fields['来源链接'] = { link: sourceUrl, text: title.substring(0, 50) };
  if (fileTokens.length) fields['素材图片'] = fileTokens;
  await feishuWrite(fields);
  addLog('feishu', `✅ ${title.substring(0, 30)}`, 'success');
}

async function captureLink(t) {
  await feishuWrite({ '选题标题': t.title || t.url, '来源链接': { link: t.url, text: t.title || t.url }, '来源平台': '其他', '选题来源': '链接采集', '状态': '待选题', '优先级': '中' });
}

async function captureImage(t) {
  await feishuWrite({ '选题标题': t.pageUrl || '图片素材', '来源链接': { link: t.url, text: '图片' }, '来源平台': '其他', '选题来源': '图片采集', '状态': '待选题' });
}

// ====== 博主批量采集 ======
async function collectBlogger(t) {
  let notes = [];
  const tabId = t.tabId;
  try {
    const r = await chrome.scripting.executeScript({
      target: { tabId }, world: 'MAIN',
      func: () => {
        const s = window.__QIANCHENG_XHS_RESPONSES__ || [];
        return s.filter(r => r.note).map(r => r.note).slice(-50);
      },
    });
    if (r?.[0]?.result) notes = r[0].result;
  } catch(e) { console.warn('api fetch:', e.message); }

  if (!notes.length) throw new Error('no api data. 请确保在博主主页并滚动加载笔记');
  
  const limit = Math.min(t.limit || 20, notes.length);
  const batch = notes.slice(0, limit);
  addLog('blogger', `🚀 批量采集 ${batch.length} 篇`, 'info');

  let saved = 0;
  for (let i = 0; i < batch.length; i++) {
    const n = batch[i];
    try {
      let fts = [];
      if (n.images?.length) {
        try { const ft = await uploadImage(n.images[0]); if (ft) fts.push({ file_token: ft }); } catch {}
      }
      const fields = {
        '选题标题': n.title || '(无标题)',
        '多行文本': (n.desc || '').substring(0, 5000),
        '作者/来源': n.author?.nickname || '',
        '来源平台': '小红书',
        '来源链接': n.note_id ? { link: `https://www.xiaohongshu.com/explore/${n.note_id}`, text: n.title } : undefined,
        '选题来源': '博主采集', '状态': '待选题', '优先级': '中',
      };
      if (fts.length) fields['素材图片'] = fts;
      await feishuWrite(fields);
      saved++;
      
      t.progress = { saved, total: batch.length };
      broadcast();
      
      if (saved < batch.length) await new Promise(r => setTimeout(r, COLLECT_INTERVAL_MS));
    } catch(e) { addLog('blogger', `❌ ${n.title}: ${e.message}`, 'error'); }
  }
  
  t.result = { saved, total: batch.length };
  addLog('blogger', `✅ ${saved}/${batch.length}`, 'success');
}

// ====== 批量链接采集(对标RedBox) ======
async function collectBatch(t) {
  const urls = Array.isArray(t.urls) ? t.urls.filter(Boolean) : [];
  if (!urls.length) throw new Error('no urls');
  
  addLog('batch', `🚀 批量采集 ${urls.length} 篇`, 'info');
  let saved = 0;

  for (let i = 0; i < urls.length; i++) {
    try {
      // 打开新tab采集
      const tab = await chrome.tabs.create({ url: urls[i], active: false });
      await new Promise(r => setTimeout(r, 5000)); // 等待加载
      await capturePage({ tabId: tab.id, url: urls[i] });
      await chrome.tabs.remove(tab.id);
      saved++;
      t.progress = { saved, total: urls.length };
      broadcast();
      if (saved < urls.length) await new Promise(r => setTimeout(r, COLLECT_INTERVAL_MS));
    } catch(e) {
      addLog('batch', `❌ ${urls[i]}: ${e.message}`, 'error');
      // 清理tab
      try {
        const tabs = await chrome.tabs.query({ url: urls[i] });
        if (tabs.length) await chrome.tabs.remove(tabs[0].id);
      } catch {}
    }
  }
  t.result = { saved, total: urls.length };
  addLog('batch', `✅ ${saved}/${urls.length}`, 'success');
}

// ====== 日志 + 广播 ======
function addLog(scope, msg, level) {
  taskLogs.unshift({ scope, msg, level, time: Date.now() });
  if (taskLogs.length > MAX_LOGS) taskLogs.length = MAX_LOGS;
}

function broadcast() {
  chrome.runtime.sendMessage({
    type: 'queue:update',
    active: activeTask, last: lastTask,
    queue: taskQueue.slice(0, 10), logs: taskLogs.slice(0, 20),
    queueLen: taskQueue.length,
    isRunning: !!activeTask,
  }).catch(() => {});
}

// ====== 消息路由 ======
function handleMessage(msg, sender, sendResponse) {
  (async () => {
    switch (msg.type) {
      case 'sidepanel:get-context': {
        const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
        let pageInfo = {};
        if (tab?.id) { try { pageInfo = await chrome.tabs.sendMessage(tab.id, { type: 'extract-page' }); } catch {} }
        const up = (await chrome.storage.local.get(['updateState'])).updateState || {};
        sendResponse({
          tab: tab ? { id: tab.id, url: tab.url, title: tab.title } : null, pageInfo,
          tokenOk: !!accessToken,
          active: activeTask, last: lastTask, queue: taskQueue.slice(0, 10), logs: taskLogs.slice(0, 20),
          queueLen: taskQueue.length, isRunning: !!activeTask,
          update: up,
        });
        break;
      }

      case 'capture:save-page': {
        const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
        if (!tab?.id) { sendResponse({ success: false, error: 'no tab' }); break; }
        enqueue({ type: 'capture-page', tabId: tab.id, url: tab.url, title: tab.title });
        sendResponse({ success: true, message: '已入队', queueLen: taskQueue.length });
        break;
      }

      case 'capture:collect-blogger': {
        const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
        if (!tab?.id) { sendResponse({ success: false, error: 'no tab' }); break; }
        enqueue({ type: 'collect-blogger', tabId: tab.id, limit: msg.limit || 30 });
        sendResponse({ success: true, message: '批量采集已入队', queueLen: taskQueue.length });
        break;
      }

      case 'capture:collect-batch': {
        if (!Array.isArray(msg.urls) || !msg.urls.length) {
          sendResponse({ success: false, error: 'no urls' }); break;
        }
        enqueue({ type: 'collect-batch', urls: msg.urls });
        sendResponse({ success: true, message: '批量链接采集已入队', queueLen: taskQueue.length });
        break;
      }

      case 'auth:refresh': {
        accessToken = null; tokenExpiresAt = 0;
        try { await getToken(); sendResponse({ success: true }); } catch(e) { sendResponse({ success: false, error: e.message }); }
        break;
      }

      case 'update:check': {
        await checkUpdate(true);
        const up = (await chrome.storage.local.get(['updateState'])).updateState || {};
        sendResponse({ success: true, update: up });
        break;
      }

      default: sendResponse({ success: false, error: 'unknown' });
    }
  })().catch(e => sendResponse({ success: false, error: e.message }));
  return true;
}

// ====== 更新检测 ======
function compareVer(a, b) {
  const pa = String(a||'0').split('.').map(Number), pb = String(b||'0').split('.').map(Number);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    if ((pa[i]||0) > (pb[i]||0)) return 1;
    if ((pa[i]||0) < (pb[i]||0)) return -1;
  }
  return 0;
}
async function initUpdate() {
  await checkUpdate(false);
  chrome.alarms.create('qc-update', { periodInMinutes: 360 });
  chrome.alarms.onAlarm.addListener(a => { if (a.name === 'qc-update') checkUpdate(false); });
}
async function checkUpdate(force) {
  try {
    const cv = chrome.runtime.getManifest().version;
    const r = await fetch(UPDATE_URL, { cache: 'no-store' });
    if (!r.ok) return;
    const rm = await r.json();
    const lv = String(rm?.version || cv);
    const hu = compareVer(lv, cv) > 0;
    await chrome.action.setBadgeBackgroundColor({ color: '#e8590c' }).catch(() => {});
    await chrome.action.setBadgeText({ text: hu ? 'NEW' : '' }).catch(() => {});
    await chrome.action.setTitle({ title: hu ? `v${lv}` : `v${cv}` }).catch(() => {});
    await chrome.storage.local.set({ updateState: { cv, lv, hu, ts: Date.now() } });
  } catch {}
}
