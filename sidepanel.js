// 前程智囊团 · 采集插件 v2.0 Side Panel
(() => {
  'use strict';

  // DOM
  const el = {
    serverStatus: document.getElementById('server-status'),
    platformBadge: document.getElementById('platform-badge'),
    pageTitle: document.getElementById('page-title'),
    pageMeta: document.getElementById('page-meta'),
    imagePreview: document.getElementById('image-preview'),
    apiBadge: document.getElementById('api-badge'),
    btnSavePage: document.getElementById('btn-save-page'),
    btnSaveXhs: document.getElementById('btn-save-xhs'),
    captureStatus: document.getElementById('capture-status'),
    bloggerPanel: document.getElementById('blogger-panel'),
    bloggerLimit: document.getElementById('blogger-limit'),
    bloggerInterval: document.getElementById('blogger-interval'),
    btnBloggerStart: document.getElementById('btn-blogger-start'),
    bloggerProgress: document.getElementById('blogger-progress'),
    bloggerProgressLabel: document.getElementById('blogger-progress-label'),
    bloggerProgressPercent: document.getElementById('blogger-progress-percent'),
    bloggerProgressFill: document.getElementById('blogger-progress-fill'),
    bloggerProgressMeta: document.getElementById('blogger-progress-meta'),
    taskCurrent: document.getElementById('task-current'),
    taskQueueList: document.getElementById('task-queue-list'),
    logList: document.getElementById('log-list'),
    btnCheckUpdate: document.getElementById('btn-check-update'),
    updateStatus: document.getElementById('update-status'),

  };

  let context = null;
  let refreshing = false;
  let capturePending = false;

  // ====== 初始化 ======
  init();

  async function init() {
    bindEvents();
    await refreshContext();
    checkUpdateStatus();
    setInterval(refreshContext, 3000);
  }

  function bindEvents() {
    el.btnSavePage.addEventListener('click', () => runCapture('capture:save-page'));
    el.btnSaveXhs.addEventListener('click', () => runCapture('capture:save-xhs'));
    el.btnBloggerStart.addEventListener('click', startBloggerCollect);
    document.getElementById('btn-refresh').addEventListener('click', () => refreshContext());
    document.getElementById('btn-refresh-token').addEventListener('click', refreshToken);
    el.btnCheckUpdate.addEventListener('click', checkUpdate);

    // 监听队列更新
    chrome.runtime.onMessage.addListener((msg) => {
      if (msg.type === 'queue:update') {
        renderQueue(msg);
        renderLogs(msg.logs || []);
      }
    });
  }

  // ====== 上下文刷新 ======
  async function refreshContext() {
    if (refreshing) return;
    refreshing = true;
    try {
      const resp = await sendMessage({ type: 'sidepanel:get-context' });
      context = resp;
      renderHealth(resp.health, resp.tokenStatus);
      renderPageIdentity(resp.tab, resp.pageInfo);
      renderBloggerPanel(resp.tab, resp.pageInfo);
      renderQueue(resp.queue);
      renderLogs(resp.queue?.logs || []);
    } catch (e) {
      el.serverStatus.textContent = '连接失败: ' + e.message;
      el.serverStatus.className = 'status error';
    } finally {
      refreshing = false;
    }
  }

  async function refreshToken() {
    document.getElementById('btn-refresh-token').disabled = true;
    try {
      const resp = await sendMessage({ type: 'auth:refresh' });
      el.serverStatus.textContent = resp.success ? `✅ Token 已刷新` : '❌ Token 刷新失败';
      el.serverStatus.className = resp.success ? 'status ok' : 'status error';
    } catch (e) {
      el.serverStatus.textContent = 'Token 刷新失败';
      el.serverStatus.className = 'status error';
    }
    document.getElementById('btn-refresh-token').disabled = false;
  }

  
  async function checkUpdate() {
    el.btnCheckUpdate.disabled = true;
    el.btnCheckUpdate.textContent = '⏳';
    try {
      const resp = await sendMessage({ type: 'update:check' });
      if (resp?.update?.hasUpdate) {
        el.updateStatus.style.display = 'block';
        el.updateStatus.textContent = `🆕 新版本 v${resp.update.latestVersion}`;
        el.updateStatus.className = 'status error';
        el.btnCheckUpdate.textContent = '🆕';
        el.btnCheckUpdate.style.display = '';
      } else {
        el.updateStatus.style.display = 'block';
        el.updateStatus.textContent = '✅ 已是最新版本';
        el.updateStatus.className = 'status ok';
        el.btnCheckUpdate.style.display = 'none';
        setTimeout(() => { el.updateStatus.style.display = 'none'; }, 3000);
      }
    } catch (e) {
      el.updateStatus.style.display = 'block';
      el.updateStatus.textContent = '检查更新失败';
      el.updateStatus.className = 'status error';
    }
    el.btnCheckUpdate.disabled = false;
  }

  // 启动时检查更新状态
  async function checkUpdateStatus() {
    try {
      const resp = await sendMessage({ type: 'update:get-status' });
      if (resp?.update?.hasUpdate) {
        el.updateStatus.style.display = 'block';
        el.updateStatus.textContent = `🆕 新版本 v${resp.update.latestVersion} (当前 v${resp.update.currentVersion})`;
        el.updateStatus.className = 'status error';
        el.btnCheckUpdate.textContent = '🆕';
        el.btnCheckUpdate.style.display = '';
      }
    } catch {}
  }

  function renderHealth(health, tokenStatus) {
    if (health?.success) {
      const remain = tokenStatus?.remaining || 0;
      const min = Math.floor(remain / 60);
      el.serverStatus.textContent = `✅ 飞书已连接 · Token 剩余 ${min}分钟`;
      el.serverStatus.className = 'status ok';
    } else {
      el.serverStatus.textContent = health?.error || '等待 Token 初始化...';
      el.serverStatus.className = 'status error';
    }
  }

  function renderPageIdentity(tab, pageInfo) {
    if (!tab || !tab.url) {
      el.platformBadge.innerHTML = '🌐 无页面';
      el.pageTitle.textContent = '请打开小红书或YouTube页面';
      el.pageMeta.textContent = '';
      el.imagePreview.innerHTML = '';
      el.btnSavePage.disabled = true;
      el.btnSaveXhs.disabled = true;
      return;
    }

    const platform = pageInfo?.platformName || '网页';
    const emoji = pageInfo?.platform === 'xhs' ? '🔴' : pageInfo?.platform === 'youtube' ? '▶️' : '🌐';
    const pageType = pageInfo?.pageType || '';

    el.platformBadge.innerHTML = `${emoji} ${platform}${pageType ? ' · ' + getPageTypeLabel(pageType) : ''}`;
    el.pageTitle.textContent = pageInfo?.title || tab.title || '(无标题)';
    el.pageMeta.innerHTML = [
      pageInfo?.author ? `作者: ${pageInfo.author}` : '',
      pageInfo?.text ? `正文: ${pageInfo.text.substring(0, 80)}...` : '',
      pageInfo?.hasApiData ? '📡 API数据' : '',
    ].filter(Boolean).join(' &nbsp;|&nbsp; ');

    // 图片预览
    const imgs = pageInfo?.images || [];
    el.imagePreview.innerHTML = imgs.slice(0, 8).map(u =>
      `<img src="${escHtml(u)}" onerror="this.style.display='none'">`
    ).join('');

    // API Badge
    el.apiBadge.style.display = pageInfo?.hasApiData ? 'block' : 'none';
    if (pageInfo?.hasApiData && pageInfo?.apiInteraction) {
      const i = pageInfo.apiInteraction;
      el.apiBadge.textContent = `📡 API: ❤️${i.liked_count || 0} ⭐${i.collected_count || 0} 💬${i.comment_count || 0}`;
    }

    el.btnSavePage.disabled = capturePending;
    el.btnSaveXhs.disabled = capturePending || !pageInfo?.hasApiData;
  }

  function renderBloggerPanel(tab, pageInfo) {
    const isXhsProfile = pageInfo?.platform === 'xhs' && pageInfo?.pageType === 'profile';
    el.bloggerPanel.classList.toggle('hidden', !isXhsProfile);
    if (!isXhsProfile) {
      el.bloggerProgress.classList.add('hidden');
    }
  }

  function getPageTypeLabel(type) {
    const map = {
      note: '笔记', video: '视频', profile: '博主主页', channel: '频道',
      feed: '信息流', 'xhs-page': '小红书', 'youtube-page': 'YouTube', web: '网页',
    };
    return map[type] || type;
  }

  // ====== 采集操作 ======
  async function runCapture(type) {
    if (capturePending) return;
    capturePending = true;
    el.btnSavePage.disabled = true;
    el.btnSaveXhs.disabled = true;
    setCaptureStatus('pending', '⏳ 采集中...');

    try {
      const resp = await sendMessage({ type });
      if (resp.success) {
        setCaptureStatus('success', '✅ 素材已加入任务队列');
        setTimeout(() => el.captureStatus.classList.add('hidden'), 3000);
      } else {
        setCaptureStatus('error', `❌ ${resp.error || '失败'}`);
      }
    } catch (e) {
      setCaptureStatus('error', `❌ ${e.message}`);
    } finally {
      capturePending = false;
      el.btnSavePage.disabled = false;
      el.btnSaveXhs.disabled = !context?.pageInfo?.hasApiData;
    }
  }

  function setCaptureStatus(state, msg) {
    el.captureStatus.textContent = msg;
    el.captureStatus.dataset.state = state;
    el.captureStatus.classList.remove('hidden');
  }

  // ====== 博主批量采集 ======
  async function startBloggerCollect() {
    const limit = Math.max(1, Math.min(100, parseInt(el.bloggerLimit.value) || 20));
    const interval = Math.max(1, Math.min(10, parseFloat(el.bloggerInterval.value) || 2));

    el.btnBloggerStart.disabled = true;
    el.bloggerProgress.classList.remove('hidden');

    try {
      const resp = await sendMessage({
        type: 'capture:collect-blogger',
        limit,
        intervalMs: interval * 1000,
      });

      if (resp.success) {
        el.bloggerProgressLabel.textContent = `已捕获 ${resp.noteCount || 0} 条API数据`;
        el.bloggerProgressPercent.textContent = '0%';
        el.bloggerProgressFill.style.width = '0%';
        el.bloggerProgressMeta.textContent = '任务已入队，等待执行...';
      } else {
        el.bloggerProgressLabel.textContent = '启动失败';
        el.bloggerProgressMeta.textContent = resp.error || '';
      }
    } catch (e) {
      el.bloggerProgressLabel.textContent = '启动失败';
      el.bloggerProgressMeta.textContent = e.message;
    }

    el.btnBloggerStart.disabled = false;
  }

  // ====== 队列渲染 ======
  function renderQueue(queue) {
    const { active, last, queue: list, queueLength } = queue || {};
    const items = [];

    if (active) {
      items.push({ ...active, _tag: 'running' });
    }
    if (list?.length) {
      list.forEach(t => items.push({ ...t, _tag: 'queued' }));
    }
    if (last && last.status === 'completed') {
      items.push({ ...last, _tag: 'completed' });
    }

    el.taskCurrent.textContent = active
      ? `⏳ 执行中: ${active.type} #${active.id || ''}`
      : (list?.length ? `队列中 ${list.length} 个任务` : '空闲');

    el.taskQueueList.innerHTML = items.slice(0, 8).map(t => {
      const tagClass = t._tag === 'running' ? 'running' : t._tag === 'completed' ? 'completed' : '';
      let label = t._tag === 'running' ? '⏳' : t._tag === 'completed' ? '✅' : '📋';
      if (t._tag === 'completed' && t.result) {
        label += ` 已采集 ${t.result.saved || 0}条`;
      }
      return `<div class="task-item ${tagClass}">
        <span>${label} ${t.type || ''}</span>
        <span style="font-size:10px;color:#868e96;">${t.title || ''}</span>
      </div>`;
    }).join('');
  }

  function renderLogs(logs) {
    if (!logs?.length) {
      el.logList.innerHTML = '<div class="log-empty">等待首次采集...</div>';
      return;
    }
    el.logList.innerHTML = logs.slice(0, 30).map(l => {
      const time = new Date(l.time).toLocaleTimeString('zh-CN', { hour12: false });
      return `<div class="log-entry ${l.level || ''}">
        <span class="log-time">${time}</span>
        <span>${escHtml(l.message || '')}</span>
      </div>`;
    }).join('');
  }

  // ====== 工具 ======
  function sendMessage(payload) {
    return new Promise((resolve, reject) => {
      chrome.runtime.sendMessage(payload, (resp) => {
        if (chrome.runtime.lastError) {
          reject(new Error(chrome.runtime.lastError.message));
          return;
        }
        resolve(resp || {});
      });
    });
  }

  function escHtml(s) {
    if (!s) return '';
    const d = document.createElement('div');
    d.textContent = String(s);
    return d.innerHTML;
  }
})();
