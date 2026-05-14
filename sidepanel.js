// 前程智囊团 v4.0 Side Panel
(() => {
  const el = {};
  let context = null;

  init();
  async function init() {
    el.serverStatus = document.getElementById('server-status');
    el.updateStatus = document.getElementById('update-status');
    el.configBar = document.getElementById('config-bar');
    el.configHint = document.getElementById('config-hint');
    el.platformBadge = document.getElementById('platform-badge');
    el.pageTitle = document.getElementById('page-title');
    el.pageMeta = document.getElementById('page-meta');
    el.imagePreview = document.getElementById('image-preview');
    el.apiBadge = document.getElementById('api-badge');
    el.btnSavePage = document.getElementById('btn-save-page');
    el.btnSaveXhs = document.getElementById('btn-save-xhs');
    el.captureStatus = document.getElementById('capture-status');
    el.bloggerPanel = document.getElementById('blogger-panel');
    el.bloggerLimit = document.getElementById('blogger-limit');
    el.bloggerInterval = document.getElementById('blogger-interval');
    el.btnBloggerStart = document.getElementById('btn-blogger-start');
    el.bloggerProgress = document.getElementById('blogger-progress');
    el.bloggerProgressLabel = document.getElementById('blogger-progress-label');
    el.bloggerProgressPercent = document.getElementById('blogger-progress-percent');
    el.bloggerProgressFill = document.getElementById('blogger-progress-fill');
    el.bloggerProgressMeta = document.getElementById('blogger-progress-meta');
    el.taskCurrent = document.getElementById('task-current');
    el.taskQueueList = document.getElementById('task-queue-list');
    el.logList = document.getElementById('log-list');
    el.btnCheckUpdate = document.getElementById('btn-check-update');
    el.btnSettings = document.getElementById('btn-settings');

    el.btnSavePage.addEventListener('click', () => doCapture('capture:save-page'));
    el.btnSaveXhs.addEventListener('click', () => doCapture('capture:save-page'));
    el.btnBloggerStart.addEventListener('click', doBlogger);
    el.btnSettings.addEventListener('click', openSettings);
    el.btnCheckUpdate.addEventListener('click', checkUpdate);

    chrome.runtime.onMessage.addListener(msg => {
      if (msg.type === 'queue:update') {
        renderQueue(msg);
        renderLogs(msg.logs || []);
        if (msg.last?.type === 'capture-page' && msg.last?.status === 'completed') {
          setStatus('success', '✅ 已采集并写入飞书');
        }
        if (msg.active?.type === 'collect-blogger' && msg.active?.progress) {
          renderBloggerProgress(msg.active.progress);
        }
      }
      if (msg.type === 'settings:updated') refresh();
    });

    await refresh();
    checkUpdateStatus();
    setInterval(refresh, 3000);
  }

  async function refresh() {
    try {
      const r = await send({ type: 'sidepanel:get-context' });
      context = r;
      renderConfig(r.config || {});
      el.serverStatus.textContent = r.config?.hasConfig ? (r.tokenOk ? '✅ 飞书已连接' : '⏳ 飞书待连接') : '⚠️ 请先完成设置';
      el.serverStatus.className = r.config?.hasConfig ? (r.tokenOk ? 'status ok' : 'status idle') : 'status error';

      if (r.update?.hu) {
        el.updateStatus.style.display = 'block';
        el.updateStatus.textContent = `🆕 发现新版本 v${r.update.lv}`;
        el.btnCheckUpdate.style.display = '';
      }
      renderPage(r.tab, r.pageInfo);
      renderQueue(r);
      renderLogs(r.logs || []);
    } catch(e) {
      el.serverStatus.textContent = '连接失败';
      el.serverStatus.className = 'status error';
    }
  }

  function renderConfig(cfg) {
    const name = cfg.tableName || '未配置表格';
    el.configBar.querySelector('span').textContent = `📋 表: ${name}`;
    el.configHint.style.display = cfg.hasConfig ? 'none' : '';
    if (!cfg.hasConfig) setStatus('error', '⚠️ 请先点击右上角 ⚙️ 配置飞书表格和字段映射');
  }

  function renderPage(tab, pi) {
    if (!tab?.url) {
      el.platformBadge.innerHTML = '🌐 请打开页面';
      el.pageTitle.textContent = '打开小红书、YouTube 或网页';
      el.btnSavePage.disabled = true; el.btnSaveXhs.disabled = true;
      return;
    }
    const e = pi?.platform === 'xhs' ? '🔴' : pi?.platform === 'youtube' ? '▶️' : '🌐';
    el.platformBadge.innerHTML = `${e} ${pi?.platformName || '网页'}${pi?.pageType ? ' · ' + pi.pageType : ''}`;
    el.pageTitle.textContent = pi?.title || tab.title || '(无标题)';
    el.pageMeta.innerHTML = pi?.author ? `作者: ${esc(pi.author)}` : '';
    el.imagePreview.innerHTML = (pi?.images || []).slice(0, 4).map(u => `<img src="${esc(u)}" onerror="this.style.display='none'">`).join('');
    el.apiBadge.style.display = pi?.hasApiData ? 'block' : 'none';

    const isProfile = pi?.platform === 'xhs' && pi?.pageType === 'profile';
    el.bloggerPanel.classList.toggle('hidden', !isProfile);
    const ok = !!context?.config?.hasConfig;
    el.btnSavePage.disabled = !ok;
    el.btnSaveXhs.disabled = !ok || pi?.platform !== 'xhs';
  }

  async function doCapture(type) {
    el.btnSavePage.disabled = true;
    el.btnSaveXhs.disabled = true;
    setStatus('pending', '⏳ 已加入任务队列...');
    try {
      const r = await send({ type });
      if (!r.success) throw new Error(r.error || '加入队列失败');
    } catch(e) {
      setStatus('error', e.message);
      el.btnSavePage.disabled = false;
      el.btnSaveXhs.disabled = false;
    }
  }

  async function doBlogger() {
    el.btnBloggerStart.disabled = true;
    el.bloggerProgress.classList.remove('hidden');
    el.bloggerProgressLabel.textContent = '已加入队列...';
    try {
      const limit = parseInt(el.bloggerLimit.value) || 20;
      const interval = parseFloat(document.getElementById('blogger-interval').value) || 2;
      const r = await send({ type: 'capture:collect-blogger', limit, interval });
      if (!r.success) throw new Error(r.error || '批量采集失败');
    } catch(e) {
      setStatus('error', e.message);
      el.btnBloggerStart.disabled = false;
    }
  }

  function renderBloggerProgress(p) {
    el.bloggerProgress.classList.remove('hidden');
    const pct = p.total ? Math.round((p.saved / p.total) * 100) : 0;
    el.bloggerProgressLabel.textContent = '批量采集中';
    el.bloggerProgressPercent.textContent = `${pct}%`;
    el.bloggerProgressFill.style.width = `${pct}%`;
    el.bloggerProgressMeta.textContent = `${p.saved}/${p.total}`;
    if (p.total && p.saved >= p.total) el.btnBloggerStart.disabled = false;
  }

  function setStatus(state, msg) {
    el.captureStatus.textContent = msg;
    el.captureStatus.dataset.state = state;
    el.captureStatus.classList.remove('hidden');
  }

  function renderQueue(q) {
    el.taskCurrent.textContent = q.isRunning
      ? `⏳ 执行中: ${q.active?.type || ''} #${q.active?.id || ''}`
      : (q.queueLen ? `队列 ${q.queueLen} 个任务` : '空闲');
    
    const items = [];
    if (q.active) items.push({ ...q.active, _t: 'running' });
    (q.queue || []).forEach(t => items.push({ ...t, _t: 'queued' }));
    if (q.last && !q.isRunning) items.push({ ...q.last, _t: 'done' });

    el.taskQueueList.innerHTML = items.slice(0, 10).map(t => {
      const cls = t._t === 'running' ? 'running' : t._t === 'done' ? (t.status === 'failed' ? 'failed' : 'completed') : '';
      const l = t._t === 'running' ? '⏳' : t._t === 'done' ? (t.status === 'failed' ? '❌' : '✅') : '📋';
      let sub = t.type || '';
      if (t.progress) sub += ` (${t.progress.saved || 0}/${t.progress.total || 0})`;
      if (t.result) sub += ` (${t.result.saved || 0}/${t.result.total || 0})`;
      if (t.error) sub += ` ${t.error}`;
      return `<div class="task-item ${cls}"><span>${l} ${esc(sub)}</span></div>`;
    }).join('');
  }

  function renderLogs(logs) {
    if (!logs?.length) { el.logList.innerHTML = '<div class="log-empty">等待采集...</div>'; return; }
    el.logList.innerHTML = logs.slice(0, 20).map(l => {
      const t = new Date(l.time).toLocaleTimeString('zh-CN', { hour12: false });
      return `<div class="log-entry ${l.level||''}"><span class="log-time">${t}</span>${esc(l.msg)}</div>`;
    }).join('');
  }

  async function checkUpdate() {
    el.btnCheckUpdate.disabled = true;
    try {
      const r = await send({ type: 'update:check' });
      if (r?.update?.hu) {
        el.updateStatus.style.display = 'block';
        el.updateStatus.textContent = `🆕 发现新版本 v${r.update.lv}`;
      } else {
        el.updateStatus.style.display = 'block';
        el.updateStatus.textContent = '✅ 当前已是最新版本';
      }
    } catch {}
    el.btnCheckUpdate.disabled = false;
  }

  async function checkUpdateStatus() {
    try {
      const r = await send({ type: 'update:check' });
      if (r?.update?.hu) {
        el.updateStatus.style.display = 'block';
        el.updateStatus.textContent = `🆕 发现新版本 v${r.update.lv}`;
        el.btnCheckUpdate.style.display = '';
      }
    } catch {}
  }

  function openSettings() {
    if (chrome.runtime.openOptionsPage) chrome.runtime.openOptionsPage();
    else chrome.tabs.create({ url: chrome.runtime.getURL('settings.html') });
  }

  function send(p) { return new Promise(r => chrome.runtime.sendMessage(p, res => r(res || {}))); }
  function esc(s) { const d = document.createElement('div'); d.textContent = String(s||''); return d.innerHTML; }
})();
