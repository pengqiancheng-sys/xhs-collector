// 前程智囊团 v3.0 Side Panel
(() => {
  const el = {};
  let context = null;

  init();
  async function init() {
    el.serverStatus = document.getElementById('server-status');
    el.updateStatus = document.getElementById('update-status');
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

    el.btnSavePage.addEventListener('click', () => doCapture('capture:save-page'));
    el.btnSaveXhs.addEventListener('click', () => doCapture('capture:save-page'));
    el.btnBloggerStart.addEventListener('click', doBlogger);
    document.getElementById('btn-refresh').addEventListener('click', refresh);
    document.getElementById('btn-refresh-token').addEventListener('click', refreshToken);
    el.btnCheckUpdate.addEventListener('click', checkUpdate);

    chrome.runtime.onMessage.addListener(msg => {
      if (msg.type === 'queue:update') {
        renderQueue(msg);
        renderLogs(msg.logs || []);
        if (msg.last?.type === 'capture-page' && msg.last?.status === 'completed') {
          setStatus('success', '✅ 已采集');
        }
        if (msg.active?.type === 'collect-blogger' && msg.active?.progress) {
          const p = msg.active.progress;
          el.bloggerProgress.classList.remove('hidden');
          const pct = Math.round((p.saved / p.total) * 100);
          el.bloggerProgressLabel.textContent = '批量采集中';
          el.bloggerProgressPercent.textContent = `${pct}%`;
          el.bloggerProgressFill.style.width = `${pct}%`;
          el.bloggerProgressMeta.textContent = `${p.saved}/${p.total}`;
        }
      }
    });

    await refresh();
    checkUpdateStatus();
    setInterval(refresh, 3000);
  }

  async function refresh() {
    try {
      const r = await send({ type: 'sidepanel:get-context' });
      context = r;
      el.serverStatus.textContent = r.tokenOk ? '✅ 飞书已连接' : '⏳ 连接中';
      el.serverStatus.className = r.tokenOk ? 'status ok' : 'status idle';
      if (r.update?.hu) {
        el.updateStatus.style.display = 'block';
        el.updateStatus.textContent = `🆕 v${r.update.lv}`;
        el.updateStatus.className = 'status error';
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

  function renderPage(tab, pi) {
    if (!tab?.url) {
      el.platformBadge.innerHTML = '🌐 请打开页面';
      el.pageTitle.textContent = '打开小红书或YouTube';
      el.btnSavePage.disabled = true; el.btnSaveXhs.disabled = true;
      return;
    }
    const e = pi?.platform === 'xhs' ? '🔴' : pi?.platform === 'youtube' ? '▶️' : '🌐';
    el.platformBadge.innerHTML = `${e} ${pi?.platformName || '网页'}${pi?.pageType ? ' · ' + pi.pageType : ''}`;
    el.pageTitle.textContent = pi?.title || tab.title || '(无标题)';
    el.pageMeta.innerHTML = pi?.author ? `作者: ${pi.author}` : '';
    el.imagePreview.innerHTML = (pi?.images || []).slice(0, 4).map(u => `<img src="${esc(u)}" onerror="this.style.display='none'">`).join('');
    el.apiBadge.style.display = pi?.hasApiData ? 'block' : 'none';

    const isProfile = pi?.platform === 'xhs' && pi?.pageType === 'profile';
    el.bloggerPanel.classList.toggle('hidden', !isProfile);
    el.btnSavePage.disabled = false;
  }

  async function doCapture(type) {
    el.btnSavePage.disabled = true;
    setStatus('pending', '⏳ 已加入任务队列...');
    try {
      await send({ type });
    } catch(e) { setStatus('error', e.message); el.btnSavePage.disabled = false; }
  }

  async function doBlogger() {
    el.btnBloggerStart.disabled = true;
    el.bloggerProgress.classList.remove('hidden');
    el.bloggerProgressLabel.textContent = '已加入队列...';
    try {
      const limit = parseInt(el.bloggerLimit.value) || 20;
      await send({ type: 'capture:collect-blogger', limit });
    } catch(e) { setStatus('error', e.message); el.btnBloggerStart.disabled = false; }
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
      const cls = t._t === 'running' ? 'running' : t._t === 'done' ? 'completed' : '';
      const l = t._t === 'running' ? '⏳' : t._t === 'done' ? (t.status === 'failed' ? '❌' : '✅') : '📋';
      let sub = t.type || '';
      if (t.result) sub += ` (${t.result.saved || 0}/${t.result.total || 0})`;
      if (t.error) sub += ` ${t.error}`;
      return `<div class="task-item ${cls}"><span>${l} ${sub}</span></div>`;
    }).join('');
  }

  function renderLogs(logs) {
    if (!logs?.length) { el.logList.innerHTML = '<div class="log-empty">等待采集...</div>'; return; }
    el.logList.innerHTML = logs.slice(0, 20).map(l => {
      const t = new Date(l.time).toLocaleTimeString('zh-CN', { hour12: false });
      return `<div class="log-entry ${l.level||''}"><span class="log-time">${t}</span>${esc(l.msg)}</div>`;
    }).join('');
  }

  async function refreshToken() {
    document.getElementById('btn-refresh-token').disabled = true;
    try {
      const r = await send({ type: 'auth:refresh' });
      el.serverStatus.textContent = r.success ? '✅ Token已刷新' : '❌ 失败';
      el.serverStatus.className = r.success ? 'status ok' : 'status error';
    } catch(e) { el.serverStatus.textContent = '刷新失败'; }
    document.getElementById('btn-refresh-token').disabled = false;
  }

  async function checkUpdate() {
    el.btnCheckUpdate.disabled = true;
    try {
      const r = await send({ type: 'update:check' });
      if (r?.update?.hu) {
        el.updateStatus.style.display = 'block';
        el.updateStatus.textContent = `🆕 v${r.update.lv}`;
      }
    } catch {}
    el.btnCheckUpdate.disabled = false;
  }

  async function checkUpdateStatus() {
    try {
      const r = await send({ type: 'update:check' });
      if (r?.update?.hu) {
        el.updateStatus.style.display = 'block';
        el.updateStatus.textContent = `🆕 v${r.update.lv}`;
        el.updateStatus.className = 'status error';
        el.btnCheckUpdate.style.display = '';
      }
    } catch {}
  }

  function send(p) { return new Promise(r => chrome.runtime.sendMessage(p, res => r(res || {}))); }
  function esc(s) { const d = document.createElement('div'); d.textContent = String(s||''); return d.innerHTML; }
})();
