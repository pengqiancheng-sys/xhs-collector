// 前程智囊团 · 采集插件 v2.1 Background Service Worker
// 修复: API级文本采集 + 图片下载上传飞书附件

const FEISHU_BASE = 'https://open.feishu.cn/open-apis/bitable/v1';
const FEISHU_DRIVE = 'https://open.feishu.cn/open-apis/drive/v1';
const FEISHU_AUTH = 'https://open.feishu.cn/open-apis/auth/v3/tenant_access_token/internal';
const APP_TOKEN = 'NyOtb2ybzav3e8s7bmlcWfg8nmb';
const TABLE_ID = 'tblK9xb6LcoWyt2H';
const APP_ID = 'cli_a9029657efb81bc7';
const APP_SECRET = 'EHBfRWQsU5VHFjIBK8i2XcDTBGlajmZW';

const STATE_KEY = 'qiancheng_collector_v2';
const TASK_LOG_KEY = 'qiancheng_collector_logs_v2';
const TASK_LOG_LIMIT = 100;
const MAX_IMAGES = 9; // 每条记录最多9张图
// ====== 更新检测 ======
const UPDATE_STATE_KEY = 'qiancheng_update_state';
const UPDATE_ALARM_NAME = 'qc-plugin-auto-update';
const UPDATE_CHECK_INTERVAL_MINUTES = 360;
const UPDATE_SOURCE_MANIFEST_URL = 'https://raw.githubusercontent.com/pengqiancheng-sys/xhs-collector/main/manifest.json';
// TODO: 替换为前程智囊团自己的 manifest URL
const UPDATE_SOURCE_REPO_URL = 'https://github.com/pengqiancheng-sys/xhs-collector';


// ====== 状态 ======
let accessToken = null;
let tokenExpiresAt = 0;
let activeTask = null;
const taskQueue = [];
let taskLogs = [];
let taskSeq = 0;

// ====== 初始化 ======
(async function init() {
  const saved = await chrome.storage.local.get([STATE_KEY, TASK_LOG_KEY]);
  if (saved[TASK_LOG_KEY]) taskLogs = saved[TASK_LOG_KEY];
  if (saved[STATE_KEY]) {
    const s = saved[STATE_KEY];
    accessToken = s.accessToken || null;
    tokenExpiresAt = s.tokenExpiresAt || 0;
    taskSeq = s.taskSeq || 0;
  }

  if (chrome.sidePanel?.setPanelBehavior) {
    chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(() => {});
  }
  setupContextMenus();
  chrome.runtime.onMessage.addListener(handleMessage);
  setInterval(processQueue, 800);
  initializeUpdateChecks(false);
  console.log('🚀 前程智囊团 v2.1 已启动');
})();

function setupContextMenus() {
  chrome.contextMenus.removeAll(() => {
    chrome.contextMenus.create({ id: 'qc-save-page', title: '📦 采集当前页面', contexts: ['page'] });
    chrome.contextMenus.create({ id: 'qc-save-link', title: '🔗 采集此链接', contexts: ['link'] });
    chrome.contextMenus.create({ id: 'qc-save-image', title: '🖼️ 采集此图片', contexts: ['image'] });
  });
}
chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (info.menuItemId === 'qc-save-page') {
    enqueueTask({ type: 'save-page', tabId: tab?.id, url: tab?.url, title: tab?.title, pageInfo: null });
  } else if (info.menuItemId === 'qc-save-link') {
    enqueueTask({ type: 'save-link', url: info.linkUrl, title: info.selectionText || info.linkUrl });
  } else if (info.menuItemId === 'qc-save-image') {
    enqueueTask({ type: 'save-image', url: info.srcUrl, pageUrl: info.pageUrl });
  }
});

// ====== Token ======
async function ensureToken() {
  if (accessToken && Date.now() < tokenExpiresAt - 300000) return accessToken;
  try {
    const r = await fetch(FEISHU_AUTH, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ app_id: APP_ID, app_secret: APP_SECRET }),
    });
    const d = await r.json();
    if (d.code === 0) {
      accessToken = d.tenant_access_token;
      tokenExpiresAt = Date.now() + (d.expire || 5400) * 1000;
      await saveState();
      return accessToken;
    }
  } catch (e) { console.error('Token error:', e); }
  return accessToken;
}

// ====== 飞书: 上传图片到多维表格附件 ======
async function uploadImageToBitable(imageUrl, imageIndex) {
  const token = await ensureToken();
  if (!token) throw new Error('Token unavailable');

  // 1. 下载图片
  let imageBlob;
  try {
    const resp = await fetch(imageUrl, { signal: AbortSignal.timeout(15000) });
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    imageBlob = await resp.blob();
  } catch (e) {
    console.warn(`图片下载失败 ${imageUrl}: ${e.message}`);
    return null;
  }

  if (imageBlob.size > 20 * 1024 * 1024) {
    console.warn(`图片过大 ${imageBlob.size} bytes`);
    return null;
  }

  // 2. 上传到飞书
  const form = new FormData();
  form.append('file', imageBlob, `image_${imageIndex}.jpg`);
  form.append('parent_type', 'bitable_file');
  form.append('parent_node', APP_TOKEN);
  form.append('size', String(imageBlob.size));

  const uploadResp = await fetch(`${FEISHU_DRIVE}/medias/upload_all`, {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${token}` },
    body: form,
  });

  if (!uploadResp.ok) {
    console.warn(`上传失败: HTTP ${uploadResp.status}`);
    return null;
  }

  const uploadData = await uploadResp.json();
  if (uploadData.code !== 0) {
    console.warn(`上传错误: ${uploadData.msg}`);
    return null;
  }

  return uploadData.data?.file_token || null;
}

// ====== 飞书: 写入记录 ======
async function sendToFeishu(fields) {
  const token = await ensureToken();
  if (!token) throw new Error('飞书 Token 获取失败');

  const resp = await fetch(`${FEISHU_BASE}/apps/${APP_TOKEN}/tables/${TABLE_ID}/records`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ fields }),
  });

  if (!resp.ok) {
    const err = await resp.json().catch(() => ({}));
    if (resp.status === 401 || err.code === 99991663) {
      accessToken = null; tokenExpiresAt = 0;
      const newToken = await ensureToken();
      const retry = await fetch(`${FEISHU_BASE}/apps/${APP_TOKEN}/tables/${TABLE_ID}/records`, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${newToken}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ fields }),
      });
      if (!retry.ok) throw new Error((await retry.json().catch(() => ({}))).msg || '重试失败');
      return retry.json();
    }
    throw new Error(err.msg || `HTTP ${resp.status}`);
  }
  return resp.json();
}

// ====== 任务队列 ======
function enqueueTask(task) {
  taskSeq++;
  task.id = `task-${taskSeq}`;
  task.status = 'queued';
  task.createdAt = Date.now();
  taskQueue.push(task);
  if (taskQueue.length > 200) taskQueue.shift();
  addLog('task:enqueue', `#${taskSeq}: ${task.type}`, 'info');
  broadcastQueue();
}

async function processQueue() {
  if (activeTask) return;
  if (!taskQueue.length) return;
  activeTask = taskQueue.shift();
  activeTask.status = 'running';
  activeTask.startedAt = Date.now();
  broadcastQueue();

  try {
    await executeTask(activeTask);
    activeTask.status = 'completed';
    activeTask.completedAt = Date.now();
    addLog('task:done', `✅ ${activeTask.type}`, 'success');
  } catch (e) {
    activeTask.status = 'failed';
    activeTask.error = e.message;
    addLog('task:failed', `❌ ${activeTask.type}: ${e.message}`, 'error');
  }
  if (activeTask.status !== 'failed') lastCompletedTask = { ...activeTask };
  activeTask = null;
  broadcastQueue();
}
let lastCompletedTask = null;

async function executeTask(task) {
  switch (task.type) {
    case 'save-page': return executeSavePage(task);
    case 'save-link': return executeSaveLink(task);
    case 'save-image': return executeSaveImage(task);
    case 'collect-blogger': return executeCollectBlogger(task);
  }
}

// ====== 核心: 保存页面（含图片上传） ======
async function executeSavePage(task) {
  let pageInfo = task.pageInfo || null;

  // 1. 从 content script 获取页面数据
  if (!pageInfo && task.tabId) {
    try {
      pageInfo = await chrome.tabs.sendMessage(task.tabId, { type: 'extract-page' });
    } catch (e) {
      console.warn('extract-page failed:', e.message);
    }
  }

  // 2. 尝试从 xhs-bridge (MAIN 世界) 获取 API 级精确数据
  let apiData = null;
  if (task.tabId) {
    try {
      const results = await chrome.scripting.executeScript({
        target: { tabId: task.tabId },
        func: () => {
          const store = window.__QIANCHENG_XHS_RESPONSES__ || [];
          const latest = store.filter(r => r.note).slice(-1);
          return latest.length ? latest[0].note : null;
        },
        world: 'MAIN',
      });
      if (results?.[0]?.result) apiData = results[0].result;
    } catch (e) {
      console.warn('API data fetch failed:', e.message);
    }
  }

  // 3. 合并数据: API 数据优先级 > DOM 数据
  const title = apiData?.title || pageInfo?.title || task.title || '(无标题)';
  const author = apiData?.author?.nickname || pageInfo?.author || '';
  const text = (apiData?.desc || pageInfo?.text || '').substring(0, 5000);
  const tags = apiData?.tags || [];
  const noteId = apiData?.note_id || '';
  const images = apiData?.images?.length ? apiData.images : (pageInfo?.images || []);
  const interaction = apiData?.interaction || null;

  // 4. 确定平台
  const platformMap = { xhs: '小红书', youtube: 'YouTube', web: '网页' };
  const platform = platformMap[pageInfo?.platform] || '其他';

  // 5. 构建来源链接
  let sourceUrl = task.url || pageInfo?.url || '';
  if (!sourceUrl && noteId) {
    sourceUrl = `https://www.xiaohongshu.com/explore/${noteId}`;
  }

  // 6. 上传图片到飞书附件（最多9张）
  addLog('task:progress', `下载 ${Math.min(images.length, MAX_IMAGES)} 张图片...`, 'info');
  const uploadedFiles = [];
  for (let i = 0; i < Math.min(images.length, MAX_IMAGES); i++) {
    try {
      const fileToken = await uploadImageToBitable(images[i], i);
      if (fileToken) uploadedFiles.push({ file_token: fileToken });
    } catch (e) {
      console.warn(`图片 ${i} 上传失败:`, e.message);
    }
  }
  addLog('task:progress', `已上传 ${uploadedFiles.length} 张图片`, 'info');

  // 7. 构建飞书字段
  const fields = {
    '选题标题': title,
    '多行文本': text,
    '作者/来源': author || '',
    '来源平台': platform,
    '选题来源': '浏览器采集',
    '状态': '待选题',
    '优先级': '中',
  };

  if (sourceUrl) {
    fields['来源链接'] = { link: sourceUrl, text: title.substring(0, 50) };
  }
  if (uploadedFiles.length) {
    fields['素材图片'] = uploadedFiles;
  }

  // 8. 写入飞书
  await sendToFeishu(fields);
  addLog('feishu:save', `✅ "${title.substring(0, 40)}" → 飞书`, 'success');
}

async function executeSaveLink(task) {
  await sendToFeishu({
    '选题标题': task.title || task.url,
    '来源链接': { link: task.url, text: task.title || task.url },
    '来源平台': '其他',
    '选题来源': '链接采集',
    '状态': '待选题',
    '优先级': '中',
  });
}

async function executeSaveImage(task) {
  await sendToFeishu({
    '选题标题': task.pageUrl || '图片素材',
    '来源链接': { link: task.url, text: '采集的图片' },
    '来源平台': '其他',
    '多行文本': task.url,
    '选题来源': '图片采集',
    '状态': '待选题',
  });
}

// ====== 博主批量采集 ======
async function executeCollectBlogger(task) {
  const { limit = 20, intervalMs = 2000 } = task.options || {};
  const notes = task.apiNotes || [];

  if (!notes.length) {
    addLog('blogger:warn', '未捕获到 API 数据。请确认: 1.在博主主页 2.已滚动加载笔记', 'warn');
    return;
  }

  const toCollect = notes.slice(0, Math.min(limit, notes.length));
  let saved = 0;

  for (let i = 0; i < toCollect.length; i++) {
    const note = toCollect[i];
    try {
      const fields = {
        '选题标题': note.title || '(无标题)',
        '多行文本': (note.desc || '').substring(0, 5000),
        '作者/来源': note.author?.nickname || '',
        '来源平台': '小红书',
        '选题来源': '博主采集',
        '状态': '待选题',
        '优先级': '中',
      };
      if (note.note_id) {
        fields['来源链接'] = {
          link: `https://www.xiaohongshu.com/explore/${note.note_id}`,
          text: note.title,
        };
      }
      // 博主批量采只传首图
      const imgs = note.images || [];
      if (imgs.length) {
        const ft = await uploadImageToBitable(imgs[0], i);
        if (ft) fields['素材图片'] = [{ file_token: ft }];
      }

      await sendToFeishu(fields);
      saved++;

      activeTask.progress = { saved, total: toCollect.length };
      broadcastQueue();

      if (saved < toCollect.length) {
        await new Promise(r => setTimeout(r, intervalMs));
      }
    } catch (e) {
      addLog('blogger:error', `${note.title}: ${e.message}`, 'error');
    }
  }

  activeTask.result = { saved, total: toCollect.length };
  addLog('blogger:done', `✅ 批量采集: ${saved}/${toCollect.length}`, 'success');
}

// ====== 日志 ======
function addLog(scope, message, level = 'info') {
  const entry = { scope, message, level, time: Date.now(), id: `log-${Date.now()}-${Math.random().toString(36).slice(2,6)}` };
  taskLogs.unshift(entry);
  if (taskLogs.length > TASK_LOG_LIMIT) taskLogs.length = TASK_LOG_LIMIT;
  chrome.storage.local.set({ [TASK_LOG_KEY]: taskLogs });
}

function broadcastQueue() {
  chrome.runtime.sendMessage({
    type: 'queue:update',
    active: activeTask,
    last: lastCompletedTask,
    queue: taskQueue,
    logs: taskLogs.slice(0, 20),
    queueLength: taskQueue.length,
    health: { success: !!accessToken, error: accessToken ? '' : 'Token 未初始化' },
  }).catch(() => {});
}

async function saveState() {
  await chrome.storage.local.set({
    [STATE_KEY]: { accessToken, tokenExpiresAt, taskSeq },
  });
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
        sendResponse({
          success: true,
          tab: tab ? { id: tab.id, url: tab.url, title: tab.title } : null,
          pageInfo,
          queue: {
            active: activeTask, last: lastCompletedTask,
            queue: taskQueue, logs: taskLogs.slice(0, 20), queueLength: taskQueue.length,
          },
          health: { success: !!accessToken, error: accessToken ? '' : '等待 Token 初始化' },
          tokenStatus: {
            hasToken: !!accessToken, expiresAt: tokenExpiresAt,
            remaining: tokenExpiresAt ? Math.max(0, Math.round((tokenExpiresAt - Date.now()) / 1000)) : 0,
          },
        });
        break;
      }

      case 'capture:save-page': {
        const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
        if (!tab) { sendResponse({ success: false, error: '无当前标签页' }); break; }
        enqueueTask({ type: 'save-page', tabId: tab.id, url: tab.url, title: tab.title, pageInfo: msg.pageInfo || null });
        sendResponse({ success: true });
        break;
      }

      case 'capture:save-xhs': {
        const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
        if (!tab) { sendResponse({ success: false, error: '无当前标签页' }); break; }
        try {
          const pageInfo = await chrome.tabs.sendMessage(tab.id, { type: 'extract-page' });
          enqueueTask({ type: 'save-page', tabId: tab.id, url: tab.url, title: tab.title, pageInfo });
        } catch {
          enqueueTask({ type: 'save-page', tabId: tab.id, url: tab.url, title: tab.title, pageInfo: null });
        }
        sendResponse({ success: true });
        break;
      }

      case 'capture:collect-blogger': {
        const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
        if (!tab) { sendResponse({ success: false, error: '无当前标签页' }); break; }
        let apiNotes = [];
        try {
          const result = await chrome.scripting.executeScript({
            target: { tabId: tab.id },
            func: () => {
              const store = window.__QIANCHENG_XHS_RESPONSES__ || [];
              return store.filter(r => r.note).map(r => r.note).slice(-50);
            },
            world: 'MAIN',
          });
          if (result?.[0]?.result) apiNotes = result[0].result;
        } catch (e) { console.warn('API notes fetch:', e.message); }

        enqueueTask({
          type: 'collect-blogger',
          tabId: tab.id, url: tab.url, apiNotes,
          options: { limit: msg.limit || 30, intervalMs: msg.intervalMs || 2500 },
        });
        sendResponse({ success: true, noteCount: apiNotes.length });
        break;
      }

      case 'queue:get-status': {
        sendResponse({
          success: true,
          active: activeTask, last: lastCompletedTask,
          queue: taskQueue, logs: taskLogs.slice(0, 30), queueLength: taskQueue.length,
        });
        break;
      }

      case 'auth:refresh': {
        accessToken = null; tokenExpiresAt = 0;
        const token = await ensureToken();
        sendResponse({ success: !!token });
        break;
      }

      case 'update:check': {
        const result = await checkForUpdate({ force: true, reason: 'manual' });
        sendResponse(result);
        break;
      }

      case 'update:get-status': {
        const state = await readUpdateState();
        sendResponse({ success: true, update: state });
        break;
      }

      case 'update:open-source': {
        await chrome.tabs.create({ url: UPDATE_SOURCE_REPO_URL });
        sendResponse({ success: true });
        break;
      }



      default:
        sendResponse({ success: false, error: `Unknown: ${msg.type}` });
    }
  })().catch(e => sendResponse({ success: false, error: e.message }));
  return true;
}


// ====== 更新检测 ======
function compareVersions(a, b) {
  const pa = String(a || '0').split('.').map(Number);
  const pb = String(b || '0').split('.').map(Number);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const na = pa[i] || 0, nb = pb[i] || 0;
    if (na > nb) return 1;
    if (na < nb) return -1;
  }
  return 0;
}

async function setStorage(key, value) {
  return chrome.storage.local.set({ [key]: value });
}

async function getStorage(key) {
  const result = await chrome.storage.local.get([key]);
  return result?.[key] || null;
}

async function readUpdateState() {
  const stored = await getStorage(UPDATE_STATE_KEY);
  if (!stored || typeof stored !== 'object') {
    return { currentVersion: chrome.runtime.getManifest().version, latestVersion: '', hasUpdate: false, lastCheckedAt: null, checkStatus: 'idle' };
  }
  return stored;
}

async function applyUpdateBadge(state) {
  const badge = state?.hasUpdate ? 'NEW' : '';
  await chrome.action.setBadgeBackgroundColor({ color: '#e8590c' }).catch(() => {});
  if (chrome.action.setBadgeTextColor) {
    await chrome.action.setBadgeTextColor({ color: '#fff' }).catch(() => {});
  }
  await chrome.action.setBadgeText({ text: badge }).catch(() => {});
  const title = state?.hasUpdate
    ? `前程智囊团采集：发现新版本 ${state.latestVersion}`
    : `前程智囊团采集 v${state?.currentVersion || ''}`;
  await chrome.action.setTitle({ title }).catch(() => {});
}

async function initializeUpdateChecks(forceCheck) {
  const state = await readUpdateState();
  state.currentVersion = chrome.runtime.getManifest().version;
  await setStorage(UPDATE_STATE_KEY, state);
  await applyUpdateBadge(state);

  // 设置定时检查
  await chrome.alarms.clear(UPDATE_ALARM_NAME).catch(() => {});
  await chrome.alarms.create(UPDATE_ALARM_NAME, {
    periodInMinutes: UPDATE_CHECK_INTERVAL_MINUTES,
  });

  chrome.alarms.onAlarm.addListener(async (alarm) => {
    if (alarm.name !== UPDATE_ALARM_NAME) return;
    await checkForUpdate({ force: false, reason: 'alarm' });
  });

  if (forceCheck) {
    await checkForUpdate({ force: true, reason: 'install' });
  } else if (!state.lastCheckedAt) {
    await checkForUpdate({ force: false, reason: 'startup' });
  }
}

async function checkForUpdate(options = {}) {
  const currentState = await readUpdateState();
  const currentVersion = chrome.runtime.getManifest().version;

  if (!options.force && currentState.checkStatus === 'checking') {
    return { success: true, update: currentState };
  }

  const checkingState = { ...currentState, checkStatus: 'checking', lastError: '' };
  await setStorage(UPDATE_STATE_KEY, checkingState);

  try {
    const resp = await fetch(UPDATE_SOURCE_MANIFEST_URL, {
      cache: 'no-store',
      headers: { 'Accept': 'application/json' },
    });
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);

    const remote = await resp.json();
    const latestVersion = String(remote?.version || currentVersion);
    const hasUpdate = compareVersions(latestVersion, currentVersion) > 0;

    const nextState = {
      currentVersion,
      latestVersion,
      hasUpdate,
      lastCheckedAt: new Date().toISOString(),
      checkStatus: 'idle',
      lastError: '',
    };
    await setStorage(UPDATE_STATE_KEY, nextState);
    await applyUpdateBadge(nextState);

    console.log(`🔍 更新检查: v${currentVersion} → ${hasUpdate ? '🆕 v' + latestVersion : '✅ 最新'}`);
    return { success: true, update: nextState };
  } catch (e) {
    const nextState = {
      ...checkingState,
      currentVersion,
      latestVersion: currentState.latestVersion || '',
      lastCheckedAt: new Date().toISOString(),
      checkStatus: 'idle',
      lastError: e.message,
    };
    await setStorage(UPDATE_STATE_KEY, nextState);
    console.warn('更新检查失败:', e.message);
    return { success: false, error: e.message, update: nextState };
  }
}
