// 前程智囊团 v4.0.5 — 可配置化架构
// 所有飞书凭证、表信息、字段映射 均从 chrome.storage 动态读取

const FEISHU_AUTH = 'https://open.feishu.cn/open-apis/auth/v3/tenant_access_token/internal';
const UPDATE_URL = 'https://raw.githubusercontent.com/pengqiancheng-sys/xhs-collector/main/manifest.json';

// ====== 默认配置（前程智囊团内置，可被用户覆盖） ======
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
    '选题来源': '浏览器采集',
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
  console.log('🚀 前程智囊团 v4.0.10 可配置版');
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
          const s = window.__QIANCHENG_XHS_RESPONSES__ || [];
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
  const author = apiData?.author?.nickname || pageInfo?.author || '';
  const text = (apiData?.desc || domText || pageInfo?.text || '').substring(0, 5000);
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
    sourceType: '浏览器采集',
    images: fileTokens.length ? fileTokens : undefined,
    tags: (apiData?.tags?.length ? apiData.tags : pageInfo?.tags || []).map(t => { const v = String(t || '').trim().replace(/^#+/, ''); return v ? `#${v}` : ''; }).filter(Boolean),
    publishTime: apiData?.publish_time || pageInfo?.publishTime || 0,
    interactionLikes: apiData?.interaction?.liked_count ?? pageInfo?.likes ?? 0,
    interactionCollects: apiData?.interaction?.collected_count ?? pageInfo?.collects ?? 0,
    interactionComments: apiData?.interaction?.comment_count ?? pageInfo?.comments ?? 0,
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
    sourceType: '链接采集',
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
    title: '图片采集',
    text: t.pageUrl || t.url || '',
    author: '',
    platform: '网页',
    sourceUrl: t.pageUrl || t.url || '',
    sourceType: '图片采集',
    images: fileToken ? [{ file_token: fileToken }] : undefined,
  };
  await feishuWrite(captureData);
}

// ====== 博主批量采集 ======
async function collectBlogger(t) {
  const tabId = t.tabId;
  const limit = t.limit || 30;
  const interval = config.collectIntervalMs || 2500;

  // 获取博主页面上的笔记列表
  let noteIds = [];
  try {
    const r = await chrome.scripting.executeScript({
      target: { tabId },
      func: (maxItems) => {
        const ids = [];
        const links = document.querySelectorAll('a[href*="/explore/"], a[href*="/discovery/item/"]');
        links.forEach(a => {
          const match = (a.href || '').match(/\/(explore|discovery\/item)\/([A-Za-z0-9]+)/);
          if (match?.[2] && !ids.includes(match[2])) ids.push(match[2]);
          if (ids.length >= maxItems) return;
        });
        return ids.slice(0, maxItems);
      },
      args: [limit],
    });
    if (r?.[0]?.result) noteIds = r[0].result;
  } catch(e) { console.warn('blogger list:', e.message); }

  if (!noteIds.length) throw new Error('未找到笔记');

  addLog('collect', `🚀 博主 ${noteIds.length} 篇`, 'info');
  const total = noteIds.length;
  let saved = 0;

  t.progress = { total, saved: 0 };
  broadcast();

  for (let i = 0; i < total; i++) {
    const noteUrl = `https://www.xiaohongshu.com/explore/${noteIds[i]}`;
    try {
      await chrome.tabs.update(tabId, { url: noteUrl });
      await sleep(interval + 2000); // 等待页面加载

      // 临时入队单篇采集
      const subTask = { type: 'capture-page', tabId, url: noteUrl, title: noteIds[i] };
      await capturePage(subTask);
      saved++;
    } catch(e) {
      console.warn(`blogger ${i}:`, e.message);
    }
    t.progress = { total, saved };
    broadcast();
  }

  addLog('done', `✅ 博主采集完成 ${saved}/${total}`, 'success');
}

// ====== 批量链接采集 ======
async function collectBatch(t) {
  const urls = t.urls || [];
  if (!urls.length) throw new Error('no urls');

  addLog('collect', `🚀 批量采集 ${urls.length} 个链接`, 'info');
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
        sourceType: '批量采集',
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

  addLog('done', `✅ 批量采集完成 ${saved}/${total}`, 'success');
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
    await chrome.action.setBadgeBackgroundColor({ color: '#e8590c' }).catch(() => {});
    await chrome.action.setBadgeText({ text: hu ? 'NEW' : '' }).catch(() => {});
    await chrome.action.setTitle({ title: hu ? `v${lv}` : `v${cv}` }).catch(() => {});
    await chrome.storage.local.set({ updateState: { cv, lv, hu, ts: Date.now() } });
  } catch {}
}
