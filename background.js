// 前程-灵感素材库 v4.1 — 可配置化架构
// 所有飞书凭证、表信息、字段映射 均从 chrome.storage 动态读取

const FEISHU_AUTH = 'https://open.feishu.cn/open-apis/auth/v3/tenant_access_token/internal';
const UPDATE_URL = 'https://raw.githubusercontent.com/pengqiancheng-sys/xhs-collector/main/manifest.json';

// ====== 默认配置（内置，可被用户覆盖） ======
const DEFAULT_CONFIG = {
  appId: '',
  appSecret: '',
  appToken: '',
  tableId: '',
  tableName: '',
  bitableUrl: '',
  // 字段映射: 采集数据的 key → 表格字段名
  fieldMapping: {
    title: '选题标题',
    text: '多行文本',
    author: '作者/来源',
    platform: '来源平台',
    sourceUrl: '来源链接',
    sourceType: '选题来源',
    images: '素材图片',
    tags: '标签',
    publishTime: '发布时间',
    interactionLikes: '点赞数',
    interactionCollects: '收藏数',
    interactionComments: '评论数',
  },
  // 固定值（每条记录都会写入）
  defaults: {
    '状态': '待选题',
    '优先级': '中',
    '选题来源': '浏览器收录',
  },
  // 表格字段列表（自动探测填充，用于设置页展示）
  tableFields: [],
  // 功能开关
  features: {
    apiIntercept: true,
    domParse: true,
    imageUpload: true,
    maxImages: 9,
  },
  // 采集间隔（毫秒）
  collectIntervalMs: 2500,
};

// 状态
let accessToken = null, tokenExpiresAt = 0;
let taskSeq = 0;
const taskQueue = [];
let activeTask = null;
let lastTask = null;
const taskLogs = [];
const MAX_LOGS = 100;
let config = { ...DEFAULT_CONFIG };

// ====== 初始化 ======
(async () => {
  await loadConfig();
  if (chrome.sidePanel?.setPanelBehavior) {
    chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(() => {});
  }
  setupMenus();
  chrome.runtime.onMessage.addListener(handleMessage);
  chrome.storage.onChanged.addListener(onStorageChange);
  setInterval(processQueue, 1000);
  initUpdate();
  console.log('🚀 前程-灵感素材库 v4.1.1');
})();

async function loadConfig() {
  try {
    const stored = await chrome.storage.local.get(['qcConfig', 'qcInit']);
    if (stored.qcConfig) {
      config = { ...DEFAULT_CONFIG, ...stored.qcConfig };
      // 深度合并 fieldMapping 和 defaults
      if (stored.qcConfig.fieldMapping) {
        config.fieldMapping = { ...DEFAULT_CONFIG.fieldMapping, ...stored.qcConfig.fieldMapping };
      }
      if (stored.qcConfig.defaults) {
        config.defaults = { ...DEFAULT_CONFIG.defaults, ...stored.qcConfig.defaults };
      }
      if (stored.qcConfig.features) {
        config.features = { ...DEFAULT_CONFIG.features, ...stored.qcConfig.features };
      }
    }
    if (!stored.qcInit) {
      // 首次安装，保存默认配置
      await saveConfig(config);
      await chrome.storage.local.set({ qcInit: true });
    }
  } catch (e) {
    console.warn('loadConfig:', e.message);
  }
}

async function saveConfig(cfg) {
  config = cfg;
  await chrome.storage.local.set({ qcConfig: config });
}

function onStorageChange(changes, area) {
  if (area === 'local' && changes.qcConfig) {
    config = { ...DEFAULT_CONFIG, ...changes.qcConfig.newValue };
    // 重置 token，因为凭证可能变了
    accessToken = null;
    tokenExpiresAt = 0;
    console.log('⚙️ 配置已热更新');
  }
}

function setupMenus() {
  chrome.contextMenus.removeAll(() => {
    chrome.contextMenus.create({ id: 'qc-page', title: '📦 收进灵感素材库', contexts: ['page'] });
    chrome.contextMenus.create({ id: 'qc-link', title: '🔗 收藏这个链接', contexts: ['link'] });
    chrome.contextMenus.create({ id: 'qc-image', title: '🖼️ 收藏这张图片', contexts: ['image'] });
  });
  chrome.contextMenus.onClicked.addListener((info, tab) => {
    if (info.menuItemId === 'qc-page') enqueue({ type: 'capture-page', tabId: tab?.id });
    else if (info.menuItemId === 'qc-link') enqueue({ type: 'capture-link', url: info.linkUrl, title: info.selectionText });
    else if (info.menuItemId === 'qc-image') enqueue({ type: 'capture-image', url: info.srcUrl, pageUrl: info.pageUrl });
  });
}

// ====== Token ======
async function getToken() {
  if (!config.appId || !config.appSecret) throw new Error('请先配置飞书应用凭证（设置页）');
  if (accessToken && Date.now() < tokenExpiresAt - 600000) return accessToken;
  const r = await fetch(FEISHU_AUTH, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ app_id: config.appId, app_secret: config.appSecret }),
  });
  const d = await r.json();
  if (d.code !== 0) throw new Error(d.msg || 'Token获取失败');
  accessToken = d.tenant_access_token;
  tokenExpiresAt = Date.now() + d.expire * 1000;
  return accessToken;
}

// 把飞书返回的原始错误翻译成「用户能照着修」的话
function describeAuthError(raw, appId) {
  const m = String(raw || '');
  if (/app_id|app_secret|invalid|10003|10014|not\s*found/i.test(m)) {
    const hint = (appId && !/^cli_/.test(appId))
      ? ' 另外：App ID 通常以 cli_ 开头，你填的看起来不像。'
      : '';
    return `App ID 或 App Secret 不正确（飞书返回：${m}）。请回飞书开放平台 →「凭证与基础信息」重新复制，注意别多带空格。${hint}`;
  }
  if (/network|fetch|Failed to fetch|timeout/i.test(m)) {
    return `网络请求失败（${m}）。检查一下网络，或稍后重试。`;
  }
  return m;
}

// ====== 飞书 API 代理 ======
async function feishuRequest(path, options = {}) {
  const token = await getToken();
  const url = `https://open.feishu.cn/open-apis/${path}`;
  const res = await fetch(url, {
    ...options,
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json',
      ...(options.headers || {}),
    },
  });
  const data = await res.json().catch(() => ({}));
  if (res.status === 401 || data.code === 99991663) {
    accessToken = null; tokenExpiresAt = 0;
    const newToken = await getToken();
    const retry = await fetch(url, {
      ...options,
      headers: {
        'Authorization': `Bearer ${newToken}`,
        'Content-Type': 'application/json',
        ...(options.headers || {}),
      },
    });
    return retry.json();
  }
  if (!res.ok || (data.code && data.code !== 0)) {
    throw new Error(data.msg || `HTTP ${res.status}`);
  }
  return data;
}


async function fetchTables(appToken, appId, appSecret) {
  const savedAppId = config.appId;
  const savedSecret = config.appSecret;
  config.appId = appId || savedAppId;
  config.appSecret = appSecret || savedSecret;
  accessToken = null; tokenExpiresAt = 0;

  try {
    const data = await feishuRequest(
      `bitable/v1/apps/${appToken}/tables?page_size=100`,
      { method: 'GET' }
    );
    const tables = (data.data?.items || []).map(t => ({
      id: t.table_id,
      name: t.name || t.table_id,
    }));
    return { success: true, tables };
  } catch (e) {
    return { success: false, error: e.message };
  } finally {
    config.appId = savedAppId;
    config.appSecret = savedSecret;
    accessToken = null; tokenExpiresAt = 0;
  }
}

// ====== 获取表字段列表（设置页用） ======
async function fetchTableFields(appToken, tableId, appId, appSecret) {
  // 使用临时凭证
  const savedAppId = config.appId;
  const savedSecret = config.appSecret;
  config.appId = appId || savedAppId;
  config.appSecret = appSecret || savedSecret;
  accessToken = null; tokenExpiresAt = 0;

  try {
    const data = await feishuRequest(
      `bitable/v1/apps/${appToken}/tables/${tableId}/fields`,
      { method: 'GET' }
    );
    const fields = (data.data?.items || []).map(f => ({
      id: f.field_id,
      name: f.field_name,
      type: f.type, // 1=文本,2=数字,3=单选,4=多选,5=日期,7=复选框,11=人员,15=超链接,17=附件
      typeName: FIELD_TYPE_NAMES[f.type] || `类型${f.type}`,
      // 单选/多选的已有选项名 —— 用于写入前预检，避免飞书报 1254062 SingleSelectFieldConvFail
      options: (f.property?.options || []).map(o => o.name).filter(Boolean),
    }));
    return { success: true, fields };
  } catch (e) {
    return { success: false, error: e.message };
  } finally {
    config.appId = savedAppId;
    config.appSecret = savedSecret;
    accessToken = null; tokenExpiresAt = 0;
  }
}

const FIELD_TYPE_NAMES = {
  1: '文本', 2: '数字', 3: '单选', 4: '多选', 5: '日期',
  7: '复选框', 11: '人员', 13: '电话', 15: '超链接', 17: '附件',
  1001: '创建时间', 1002: '修改时间',
};

// ====== 飞书写入（带字段映射） ======
async function feishuWrite(captureData) {
  const fields = {};
  const fm = config.fieldMapping || DEFAULT_CONFIG.fieldMapping;
  const defs = config.defaults || DEFAULT_CONFIG.defaults;

  // 写入前确保知道目标表真实字段和字段类型
  let tableFields = Array.isArray(config.tableFields) ? config.tableFields : [];
  if (!tableFields.length && config.appToken && config.tableId) {
    const r = await fetchTableFields(config.appToken, config.tableId, config.appId, config.appSecret);
    if (r.success) {
      tableFields = r.fields || [];
      config.tableFields = tableFields;
      await saveConfig(config).catch(() => {});
    }
  }
  const fieldByName = new Map(tableFields.map(f => [f.name, f]));
  const allowed = tableFields.length ? new Set(tableFields.map(f => f.name)) : null;
  const skipped = [];
  const converted = [];

  const fieldAliases = {
    tags: ['标签', '话题', '关键词'],
    publishTime: ['发布时间', '发布日期', '发布于', '时间', '笔记时间'],
    interactionLikes: ['点赞数', '点赞'],
    interactionCollects: ['收藏数', '收藏'],
    interactionComments: ['评论数', '评价数', '评论', '评价'],
  };

  function resolveField(dataKey, preferred) {
    if (!allowed) return preferred;
    if (preferred && allowed.has(preferred)) return preferred;
    for (const name of fieldAliases[dataKey] || []) {
      if (allowed.has(name)) return name;
    }
    return preferred;
  }

  function canWrite(fieldName) {
    if (!fieldName) return false;
    if (!allowed) return true;
    const ok = allowed.has(fieldName);
    if (!ok) skipped.push(fieldName);
    return ok;
  }

  function formatTimestamp(ts) {
    if (!ts) return '';
    const d = new Date(Number(ts));
    if (!Number.isFinite(d.getTime())) return '';
    const pad = n => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
  }

  function normalizeText(v, max = 15000) {
    if (v === undefined || v === null) return '';
    if (typeof v === 'string') return v.substring(0, max);
    if (typeof v === 'number' || typeof v === 'boolean') return String(v);
    if (Array.isArray(v)) return v.map(x => typeof x === 'string' ? x : JSON.stringify(x)).join(', ').substring(0, max);
    if (v.link) return String(v.link).substring(0, max);
    try { return JSON.stringify(v).substring(0, max); } catch { return String(v).substring(0, max); }
  }

  function formatForField(fieldName, dataKey, rawValue) {
    if (rawValue === undefined || rawValue === null || rawValue === '') return { ok: false };
    const field = fieldByName.get(fieldName);
    const type = field?.type;

    // 没有字段类型信息时，沿用旧格式
    if (!type) return { ok: true, value: rawValue };

    // 附件字段：只有图片 file_token 可以写
    if (type === 17) {
      if (dataKey === 'images' && Array.isArray(rawValue) && rawValue.length) return { ok: true, value: rawValue };
      converted.push(`${fieldName}: 非附件数据跳过`);
      return { ok: false };
    }

    // 非附件字段不写 file_token 对象，避免类型转换失败
    if (dataKey === 'images') {
      converted.push(`${fieldName}: 非附件字段，图片跳过`);
      return { ok: false };
    }

    // 超链接字段
    if (type === 15) {
      const url = typeof rawValue === 'string' ? rawValue : (rawValue.link || '');
      if (!url) return { ok: false };
      return { ok: true, value: { link: url, text: (captureData.title || url).substring(0, 50) } };
    }

    // 数字字段
    if (type === 2) {
      const n = Number(rawValue);
      if (Number.isFinite(n)) return { ok: true, value: n };
      converted.push(`${fieldName}: 非数字跳过`);
      return { ok: false };
    }

    // 多选字段
    if (type === 4) {
      if (Array.isArray(rawValue)) return { ok: true, value: rawValue.map(String).filter(Boolean) };
      return { ok: true, value: [String(rawValue)] };
    }

    // 单选字段
    if (type === 3) return { ok: true, value: String(rawValue) };

    // 复选框字段
    if (type === 7) return { ok: true, value: Boolean(rawValue) };

    // 日期字段：支持毫秒时间戳，否则跳过
    if (type === 5) {
      const n = Number(rawValue);
      if (Number.isFinite(n) && n > 0) return { ok: true, value: n };
      converted.push(`${fieldName}: 非日期跳过`);
      return { ok: false };
    }

    // 发布时间写入非日期字段时，转成人可读时间
    if (dataKey === 'publishTime') {
      const txt = formatTimestamp(rawValue);
      return txt ? { ok: true, value: txt } : { ok: false };
    }

    // 文本/其他字段：统一转字符串，避免 TextFieldConvFail
    return { ok: true, value: normalizeText(rawValue, dataKey === 'text' ? 15000 : 5000) };
  }

  function setField(fieldName, dataKey, rawValue) {
    if (!canWrite(fieldName)) return;
    const r = formatForField(fieldName, dataKey, rawValue);
    if (!r.ok) return;
    fields[fieldName] = r.value;
  }

  // 默认值：按字段类型转换后写入
  for (const [key, val] of Object.entries(defs)) {
    setField(key, 'default', val);
  }

  // 字段映射：按目标字段类型转换后写入
  for (const [dataKey, mappedFieldName] of Object.entries(fm)) {
    const fieldName = resolveField(dataKey, mappedFieldName);
    if (!fieldName) continue;
    let value = captureData[dataKey];
    if (dataKey === 'tags' && Array.isArray(value) && value.length) {
      value = value.map(t => { const v = String(t || '').trim().replace(/^#+/, ''); return v ? `#${v}` : ''; }).filter(Boolean);
      if (fieldByName.get(fieldName)?.type !== 4) value = value.join(', ');
    }
    if (dataKey === 'interactionLikes' || dataKey === 'interactionCollects' || dataKey === 'interactionComments') {
      value = Number(value) || 0;
    }
    setField(fieldName, dataKey, value);
  }

  // 确保标题至少有一个值
  const titleField = fm.title || '选题标题';
  if (!fields[titleField] && captureData.title) {
    setField(titleField, 'title', captureData.title);
  }

  const fieldCount = Object.keys(fields).length;
  if (!fieldCount) {
    throw new Error('没有可写入字段：请在设置页先读取字段，并完成字段映射');
  }
  if (skipped.length) {
    const unique = [...new Set(skipped)].slice(0, 8).join('、');
    addLog('mapping', `⚠️ 已跳过不存在字段：${unique}`, 'info');
  }
  if (converted.length) {
    const msg = [...new Set(converted)].slice(0, 3).join('；');
    addLog('mapping', `ℹ️ 字段类型适配：${msg}`, 'info');
  }

  const data = await feishuRequest(
    `bitable/v1/apps/${config.appToken}/tables/${config.tableId}/records`,
    { method: 'POST', body: JSON.stringify({ fields }) }
  );
  return data;
}

// ====== 图片上传 ======
async function uploadImage(url) {
  const imgR = await fetch(url, { signal: AbortSignal.timeout(20000) });
  if (!imgR.ok) throw new Error(`dl ${imgR.status}`);
  const blob = await imgR.blob();
  if (blob.size > 20 * 1024 * 1024) throw new Error('big');

  const token = await getToken();
  // prep
  const p = await fetch('https://open.feishu.cn/open-apis/drive/v1/medias/upload_prepare', {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ file_name: 'img.jpg', parent_type: 'bitable_file', parent_node: config.appToken, size: blob.size }),
  });
  const pd = await p.json();
  if (pd.code !== 0) throw new Error(pd.msg);
  const uid = pd.data.upload_id;

  // part
  const pf = new FormData();
  pf.append('upload_id', uid); pf.append('seq', '0'); pf.append('size', String(blob.size));
  pf.append('file', blob, 'img.jpg');
  const pr = await fetch('https://open.feishu.cn/open-apis/drive/v1/medias/upload_part', {
    method: 'POST', headers: { 'Authorization': `Bearer ${token}` }, body: pf,
  });
  if ((await pr.json()).code !== 0) throw new Error('part fail');

  // finish
  const fr = await fetch('https://open.feishu.cn/open-apis/drive/v1/medias/upload_finish', {
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

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

// ====== 核心: 采集页面 ======
async function capturePage(t) {
  const tabId = t.tabId;
  if (!tabId) {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab?.id) throw new Error('no tab');
    t.tabId = tab.id; t.url = tab.url; t.title = tab.title;
  }

  const features = config.features || DEFAULT_CONFIG.features;

  // 获取页面信息
  let pageInfo = {};
  // 直接从 DOM 获取完整数据（RedBox 同款方式：作者/互动/时间/标签）
  let domData = {};
  try {
    const r = await chrome.scripting.executeScript({
      target: { tabId: t.tabId },
      func: () => {
        function parseCount(v) {
          if (!v) return 0;
          var s = String(v).trim().replace(/[\s,]/g, '').replace(/[^0-9.\u4e00-\u9fa5]/g, '');
          if (!s) return 0;
          if (s.includes('万')) { var n = parseFloat(s.replace('万', '')); return isNaN(n) ? 0 : Math.round(n * 10000); }
          var n = parseFloat(s); return isNaN(n) ? 0 : Math.round(n);
        }
        function getDomTime(root) {
          var sels = ['.date', '[class*="date"]', '.publish-time', '[class*="time"]', 'time', '.bottom-container .date'];
          var scope = root || document;
          for (var i = 0; i < sels.length; i++) {
            var el = scope.querySelector(sels[i]);
            if (!el) continue;
            var raw = (el.textContent || '').trim();
            if (!raw) continue;
            var now = new Date();
            var mm = raw.match(/(\d+)\s*分钟前/); if (mm) return now.getTime() - Number(mm[1]) * 60000;
            var hh = raw.match(/(\d+)\s*小时前/); if (hh) return now.getTime() - Number(hh[1]) * 3600000;
            var dd = raw.match(/(\d+)\s*天前/); if (dd) return now.getTime() - Number(dd[1]) * 86400000;
            var ymd = raw.match(/(20\d{2})[-\/.年](\d{1,2})[-\/.月](\d{1,2})/);
            if (ymd) return new Date(Number(ymd[1]), Number(ymd[2]) - 1, Number(ymd[3])).getTime();
            var md = raw.match(/(\d{1,2})[-\/.月](\d{1,2})/);
            if (md) return new Date(new Date().getFullYear(), Number(md[1]) - 1, Number(md[2])).getTime();
          }
          return 0;
        }
        // === RedBox 同款：先定位当前笔记弹窗根元素 ===
        function getActiveMask() {
          var masks = document.querySelectorAll('.note-detail-mask[note-id]');
          if (masks.length) return masks[0];
          masks = document.querySelectorAll('.note-detail-mask');
          for (var i = 0; i < masks.length; i++) {
            var style = window.getComputedStyle(masks[i]);
            if (style.display !== 'none' && style.visibility !== 'hidden') return masks[i];
          }
          return null;
        }
        function getNoteRoot() {
          var mask = getActiveMask();
          if (mask) {
            var scoped = mask.querySelector('#noteContainer.note-container') || mask.querySelector('#noteContainer') || mask.querySelector('.note-container');
            if (scoped) return scoped;
            return mask;
          }
          // 兜底：从正文锚点往上找
          var anchor = document.querySelector('#detail-desc') || document.querySelector('#detail-title') || document.querySelector('.note-content');
          if (!anchor) return document.body;
          return anchor.closest('#noteContainer.note-container') || anchor.closest('#noteContainer') || anchor.closest('.note-container') || anchor.closest('.note-detail-mask') || document.body;
        }
        // === 在根元素范围内查找作者 ===
        function getAuthor(root) {
          var sels = ['.author .username', '.author-wrapper .username', '.username'];
          var scope = root || document;
          for (var i = 0; i < sels.length; i++) {
            var el = scope.querySelector(sels[i]);
            if (el) { var t = (el.innerText || el.textContent || '').trim(); if (t) return t; }
          }
          return '';
        }
        // === 在根元素范围内查找互动数据 ===
        function findInRoot(root, sels) {
          var scope = root || document;
          for (var i = 0; i < sels.length; i++) {
            var els = scope.querySelectorAll(sels[i]);
            for (var j = 0; j < els.length; j++) {
              var el = els[j];
              if (el.closest('[class*="comment"]') || el.closest('.comments-el') || el.closest('.comment-container') || el.closest('.comment-list') || el.closest('.comment-item')) continue;
              var t = (el.textContent || '').trim();
              if (t) return t;
            }
          }
          return '';
        }
        // === 从正文文本中提取 #标签（RedBox 同款） ===
        function extractTags(text) {
          var tags = [];
          var seen = {};
          var tokens = String(text || '').split('#').slice(1);
          for (var i = 0; i < tokens.length; i++) {
            var candidate = tokens[i].split(/\r?\n/, 1)[0].split(/\s+/, 1)[0].replace(/^[#]+|[，,。.！!？?【】 ]+$/g, '').trim();
            if (candidate && !seen[candidate]) { seen[candidate] = true; tags.push('#' + candidate); }
          }
          return tags;
        }

        var root = getNoteRoot();
        var author = getAuthor(root);
        // 互动：只在当前笔记弹窗范围内查找
        var likes = parseCount(findInRoot(root, ['.like-wrapper .count', '[class*="like-wrapper"] .count', '[class*="like"] .count']));
        var collects = parseCount(findInRoot(root, ['.collect-wrapper .count', '[class*="collect-wrapper"] .count', '[class*="collect"] .count']));
        var comments = parseCount(findInRoot(root, ['.chat-wrapper .count', '.comment-wrapper .count', '.engage-bar [class*="comment"] .count', '.interactions [class*="comment"] .count']));
        // 正文：只在当前笔记弹窗范围内查找
        var domText = '';
        var textEls = (root || document).querySelectorAll('#detail-desc .note-text, .desc .note-text, .note-content .note-text');
        if (textEls.length) {
          var parts = [];
          for (var k = 0; k < textEls.length; k++) { var p = (textEls[k].innerText || textEls[k].textContent || '').trim(); if (p) parts.push(p); }
          domText = parts.join('\n\n');
        }
        if (!domText) {
          var meta = document.querySelector('meta[property="og:description"]');
          if (meta) domText = (meta.getAttribute('content') || '').trim();
        }
        return {
          author: author,
          text: domText,
          tags: extractTags(domText),
          likes: likes,
          collects: collects,
          comments: comments,
          time: getDomTime(root),
        };
      },
    });
    if (r?.[0]?.result) domData = r[0].result;
  } catch(e) {}

  if (features.domParse !== false) {
    try { pageInfo = await chrome.tabs.sendMessage(t.tabId, { type: 'extract-page' }); } catch {}
  }

  // 获取 API 数据
  let apiData = null;
  if (features.apiIntercept !== false) {
    try {
      const r = await chrome.scripting.executeScript({
        target: { tabId: t.tabId },
        func: () => {
          const s = window.__QIANCHENG_IDEAHUB_RESPONSES__ || [];
          return s.filter(r => r.note).pop()?.note || null;
        },
        world: 'MAIN',
      });
      if (r?.[0]?.result) apiData = r[0].result;
    } catch {}
  }

  // 获取图片
  let images = [];
  if (features.imageUpload !== false) {
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
            const slides = Array.from(document.querySelectorAll('.note-slider .swiper-slide, .swiper .swiper-slide'))
              .filter(s => !s.classList.contains('swiper-slide-duplicate') && !isComment(s));
            slides.forEach(s => {
              const im = s.querySelector('img');
              if (im) add(im.getAttribute('src') || im.src);
            });
            if (!urls.length) {
              document.querySelectorAll('.img-container img, .note-image img, .swiper-slide img').forEach(im => {
                if (!isComment(im) && !im.closest('[class*="avatar"]')) add(im.src || im.getAttribute('src'));
              });
            }
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
  }

  // 专门提取正文
  let domText = pageInfo?.text || '';
  let domPlatform = pageInfo?.platform || '';
  if (features.domParse !== false && (!domText || domText.length < 50)) {
    try {
      const r = await chrome.scripting.executeScript({
        target: { tabId: t.tabId },
        func: () => {
          const host = location.hostname;
          if (host.includes('xiaohongshu.com') || host.includes('rednote.com')) {
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
  const author = domData.author || apiData?.author?.nickname || pageInfo?.author || '';
  const text = (domData.text || apiData?.desc || domText || pageInfo?.text || '').substring(0, 5000);
  const platform = domPlatform === 'xhs' ? '小红书' : domPlatform === 'youtube' ? 'YouTube' : '网页';
  let sourceUrl = t.url || pageInfo?.url || '';
  if (!sourceUrl && apiData?.note_id) sourceUrl = `https://www.xiaohongshu.com/explore/${apiData.note_id}`;

  addLog('capture', `📸 ${title.substring(0, 40)} · ${images.length} 图`, 'info');

  // 上传图片
  let fileTokens = [];
  const maxImgs = features.maxImages || 9;
  if (features.imageUpload !== false) {
    for (let i = 0; i < Math.min(images.length, maxImgs); i++) {
      try {
        const ft = await uploadImage(images[i]);
        if (ft) fileTokens.push({ file_token: ft });
      } catch(e) { console.warn(`img${i}:`, e.message); }
    }
    addLog('upload', `📸 ${fileTokens.length}/${Math.min(images.length, maxImgs)} 上传`, 'info');
  }

  // 构建采集数据结构
  const captureData = {
    title,
    text: text || title,
    author: author || '',
    platform,
    sourceUrl: sourceUrl || '',
    sourceType: '浏览器收录',
    images: fileTokens.length ? fileTokens : undefined,
    tags: (() => { const dom = domData.tags || []; const api = (apiData?.tags?.length ? apiData.tags : pageInfo?.tags || []).map(t => { const v = String(t || '').trim().replace(/^#+/, ''); return v ? '#' + v : ''; }).filter(Boolean); const all = [...dom, ...api]; return [...new Set(all)].filter(Boolean); })(),
    publishTime: domData.time || apiData?.publish_time || pageInfo?.publishTime || 0,
    interactionLikes: domData.likes || (apiData?.interaction?.liked_count ?? pageInfo?.likes ?? 0),
    interactionCollects: domData.collects || (apiData?.interaction?.collected_count ?? pageInfo?.collects ?? 0),
    interactionComments: domData.comments || (apiData?.interaction?.comment_count ?? pageInfo?.comments ?? 0),
  };
  addLog('mapping', `📊 点赞${captureData.interactionLikes} 收藏${captureData.interactionCollects} 评论${captureData.interactionComments}`, 'info');

  await feishuWrite(captureData);
  addLog('feishu', `✅ ${title.substring(0, 30)}`, 'success');
}

async function captureLink(t) {
  addLog('capture', `🔗 ${t.title || t.url}`, 'info');
  const captureData = {
    title: t.title || t.url,
    text: t.url || '',
    author: '',
    platform: '网页',
    sourceUrl: t.url || '',
    sourceType: '链接收录',
  };
  await feishuWrite(captureData);
}

async function captureImage(t) {
  addLog('capture', `🖼️ ${t.url}`, 'info');
  let fileToken = null;
  if (config.features?.imageUpload !== false) {
    try { fileToken = await uploadImage(t.url); } catch(e) { console.warn(e.message); }
  }
  const captureData = {
    title: '图片收藏',
    text: t.pageUrl || t.url || '',
    author: '',
    platform: '网页',
    sourceUrl: t.pageUrl || t.url || '',
    sourceType: '图片收录',
    images: fileToken ? [{ file_token: fileToken }] : undefined,
  };
  await feishuWrite(captureData);
}

// ====== 等待标签页真正加载完成 ======
function waitForTabLoad(tabId, timeout = 20000) {
  return new Promise((resolve) => {
    let settled = false;
    const done = () => {
      if (settled) return;
      settled = true;
      chrome.tabs.onUpdated.removeListener(listener);
      clearTimeout(timer);
      resolve();
    };
    const listener = (id, info) => { if (id === tabId && info.status === 'complete') done(); };
    chrome.tabs.onUpdated.addListener(listener);
    const timer = setTimeout(done, timeout);
  });
}

// ====== 博主批量收录 ======
// 已修复：
//  1) 列表提取前自动滚动加载（原实现只取首屏，limit 形同虚设）
//  2) 改用后台标签页工作，不再抢占用户当前标签
//  3) 等页面真正加载完成，不再靠固定 sleep 猜
//  4) 「间隔(秒)」参数真正生效（原来被消息路由丢弃 + 后台读错配置项）
//  5) 失败逐条记入可视日志，完成日志按实际成功率区分级别
async function collectBlogger(t) {
  const srcTabId = t.tabId;
  const limit = t.limit || 20;
  // 间隔：优先用侧边栏传入的秒数，其次回落到设置页的毫秒值
  const interval = t.interval ? Math.round(Number(t.interval) * 1000) : (config.collectIntervalMs || 2500);

  // ---- 1. 抓取博主主页的笔记 ID（自动滚动加载） ----
  let noteIds = [];
  try {
    const r = await chrome.scripting.executeScript({
      target: { tabId: srcTabId },
      func: async (maxItems) => {
        const wait = ms => new Promise(res => setTimeout(res, ms));
        const harvest = () => {
          const ids = [];
          const links = document.querySelectorAll('a[href*="/explore/"], a[href*="/discovery/item/"]');
          for (const a of links) {
            const m = (a.href || '').match(/\/(explore|discovery\/item)\/([A-Za-z0-9]+)/);
            if (m?.[2] && !ids.includes(m[2])) ids.push(m[2]);
          }
          return ids;
        };
        let ids = harvest();
        let stale = 0;
        // 无限滚动：滚到底 → 等懒加载 → 再看有无新增；连续 3 轮无新增即停
        for (let i = 0; i < 40 && ids.length < maxItems && stale < 3; i++) {
          window.scrollTo(0, document.documentElement.scrollHeight);
          await wait(1200);
          const next = harvest();
          if (next.length > ids.length) { ids = next; stale = 0; } else { stale++; }
        }
        window.scrollTo(0, 0);
        return ids.slice(0, maxItems);
      },
      args: [limit],
    });
    if (r?.[0]?.result) noteIds = r[0].result;
  } catch(e) {
    addLog('fail', `❌ 读取博主笔记列表失败: ${e.message}`, 'error');
  }

  if (!noteIds.length) throw new Error('未找到笔记（请确认已登录且停留在博主主页）');

  const total = noteIds.length;
  addLog('collect', `🚀 博主批量收录 ${total} 篇`, 'info');

  // ---- 2. 用后台标签页逐篇收录，不打扰用户当前浏览 ----
  let workTabId = null;
  let createdTab = false;
  try {
    const tab = await chrome.tabs.create({ url: 'about:blank', active: false });
    workTabId = tab.id;
    createdTab = true;
  } catch(e) {
    workTabId = srcTabId;   // 建不了后台标签就退回原标签
  }

  let saved = 0;
  t.progress = { total, saved: 0 };
  broadcast();

  try {
    for (let i = 0; i < total; i++) {
      const noteUrl = `https://www.xiaohongshu.com/explore/${noteIds[i]}`;
      try {
        await chrome.tabs.update(workTabId, { url: noteUrl });
        await waitForTabLoad(workTabId);
        await sleep(interval);   // 再留时间给接口拦截与正文渲染
        await capturePage({ type: 'capture-page', tabId: workTabId, url: noteUrl, title: noteIds[i] });
        saved++;
      } catch(e) {
        addLog('fail', `❌ 第 ${i + 1}/${total} 篇失败: ${e.message}`, 'warn');
      }
      t.progress = { total, saved };
      broadcast();
    }
  } finally {
    if (createdTab && workTabId != null) {
      try { await chrome.tabs.remove(workTabId); } catch {}
    }
  }

  // ---- 3. 按实际成功率给出日志级别（原来无论成败都报绿色成功） ----
  if (saved === total) {
    addLog('done', `✅ 博主批量收录完成 ${saved}/${total}`, 'success');
  } else if (saved > 0) {
    addLog('done', `⚠️ 博主批量收录部分完成 ${saved}/${total}，失败项见上方日志`, 'warn');
  } else {
    addLog('done', `❌ 博主批量收录全部失败 0/${total}`, 'error');
  }
}

// ====== 批量链接采集 ======
async function collectBatch(t) {
  const urls = t.urls || [];
  if (!urls.length) throw new Error('no urls');

  addLog('collect', `🚀 批量收录 ${urls.length} 个链接`, 'info');
  const total = urls.length;
  let saved = 0;

  t.progress = { total, saved: 0 };
  broadcast();

  for (let i = 0; i < total; i++) {
    try {
      const captureData = {
        title: urls[i],
        text: urls[i],
        author: '',
        platform: '网页',
        sourceUrl: urls[i],
        sourceType: '批量收录',
      };
      await feishuWrite(captureData);
      saved++;
    } catch(e) {
      console.warn(`batch ${i}:`, e.message);
    }
    t.progress = { total, saved };
    broadcast();
    await sleep(config.collectIntervalMs || 2500);
  }

  addLog('done', `✅ 批量收录完成 ${saved}/${total}`, 'success');
}

// ====== 日志 ======
function addLog(stage, msg, level) {
  taskLogs.unshift({ time: Date.now(), stage, msg, level });
  while (taskLogs.length > MAX_LOGS) taskLogs.pop();
}

// ====== 广播 ======
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
          tokenOk: !!(config.appId && config.appSecret && accessToken),
          active: activeTask, last: lastTask, queue: taskQueue.slice(0, 10), logs: taskLogs.slice(0, 20),
          queueLen: taskQueue.length, isRunning: !!activeTask,
          update: up, config: {
            tableName: config.tableName || config.tableId,
            hasConfig: !!(config.appId && config.appSecret && config.appToken && config.tableId),
          },
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
        if (!tab?.id) { sendResponse({ success: false, error: '未找到当前标签页' }); break; }
        enqueue({
          type: 'collect-blogger',
          tabId: tab.id,
          limit: msg.limit || 20,
          interval: msg.interval,          // 修复：原来这里把侧边栏传来的 interval 直接丢弃了
        });
        sendResponse({ success: true, message: '批量收录已入队', queueLen: taskQueue.length });
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

      // ====== v4.0 新增: 设置相关消息 ======
      case 'settings:get-config': {
        sendResponse({ success: true, config });
        break;
      }

      case 'settings:save-config': {
        try {
          await saveConfig(msg.config);
          sendResponse({ success: true, message: '配置已保存' });
        } catch(e) {
          sendResponse({ success: false, error: e.message });
        }
        break;
      }

      case 'settings:list-tables': {
        try {
          const result = await fetchTables(
            msg.appToken || config.appToken,
            msg.appId,
            msg.appSecret
          );
          sendResponse(result);
        } catch(e) {
          sendResponse({ success: false, error: e.message });
        }
        break;
      }

      case 'settings:fetch-fields': {
        try {
          const result = await fetchTableFields(
            msg.appToken || config.appToken,
            msg.tableId || config.tableId,
            msg.appId,
            msg.appSecret
          );
          sendResponse(result);
        } catch(e) {
          sendResponse({ success: false, error: e.message });
        }
        break;
      }

      case 'settings:reset-config': {
        try {
          config = { ...DEFAULT_CONFIG };
          await saveConfig(config);
          accessToken = null; tokenExpiresAt = 0;
          sendResponse({ success: true, message: '已重置为默认配置' });
        } catch(e) {
          sendResponse({ success: false, error: e.message });
        }
        break;
      }

      // 只验证凭证本身（不依赖表格），供配置向导第 2 步使用
      case 'settings:verify-cred': {
        const savedId = config.appId, savedSecret = config.appSecret;
        config.appId = (msg.appId || savedId || '').trim();
        config.appSecret = (msg.appSecret || savedSecret || '').trim();
        accessToken = null; tokenExpiresAt = 0;
        try {
          if (!config.appId || !config.appSecret) throw new Error('请先填写 App ID 和 App Secret');
          await getToken();
          sendResponse({ success: true, message: 'App ID / App Secret 有效' });
        } catch (e) {
          sendResponse({ success: false, error: describeAuthError(e.message, config.appId) });
        } finally {
          config.appId = savedId; config.appSecret = savedSecret;
          accessToken = null; tokenExpiresAt = 0;
        }
        break;
      }

      case 'settings:test-connection': {
        try {
          if (!config.appId || !config.appSecret) {
            sendResponse({ success: false, error: '请先配置 APP ID 和 APP Secret' });
            break;
          }
          await getToken();
          // 尝试获取表信息验证
          try {
            await feishuRequest(`bitable/v1/apps/${config.appToken}/tables/${config.tableId}/fields`, { method: 'GET' });
          } catch(e) {
            sendResponse({ success: false, error: `表格连接失败: ${e.message}` });
            break;
          }
          sendResponse({ success: true, message: '飞书连接成功，字段读取正常' });
        } catch(e) {
          sendResponse({ success: false, error: `授权失败: ${e.message}` });
        }
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
    await chrome.action.setBadgeBackgroundColor({ color: '#ff2442' }).catch(() => {});
    await chrome.action.setBadgeText({ text: hu ? 'NEW' : '' }).catch(() => {});
    await chrome.action.setTitle({ title: hu ? `v${lv}` : `v${cv}` }).catch(() => {});
    await chrome.storage.local.set({ updateState: { cv, lv, hu, ts: Date.now() } });
  } catch {}
}
