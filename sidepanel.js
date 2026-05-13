// 前程智囊团 · 采集插件 v2.3 Side Panel
(() => {
  const el = {};
  let context = null;

  async function init() {
    // DOM 绑定
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

    // 按钮绑定
    el.btnSavePage.addEventListener('click', () => doCapture('capture:save-page'));
    el.btnSaveXhs.addEventListener('click', () => doCapture('capture:save-xhs'));
    el.btnBloggerStart.addEventListener('click', () => doBloggerCollect());
    document.getElementById('btn-refresh').addEventListener('click', refreshContext);
    document.getElementById('btn-refresh-token').addEventListener('click', refreshToken);
    el.btnCheckUpdate.addEventListener('click', () => checkUpdate());

    // 监听结果
    chrome.runtime.onMessage.addListener((msg) => {
      if (msg.type === 'capture:result') {
        if (msg.success) {
          setStatus('success', `✅ 已采集: ${msg.title || ''} · 图片${msg.images || 0}张`);
        } else {
          setStatus('error', `❌ ${msg.error || '采集失败'}`);
        }
        resetButtons();
      }
      if (msg.type === 'blogger:progress') {
        el.bloggerProgress.classList.remove('hidden');
        const pct = Math.round((msg.saved / msg.total) * 100);
        el.bloggerProgressLabel.textContent = `采集中...`;
        el.bloggerProgressPercent.textContent = `${pct}%`;
        el.bloggerProgressFill.style.width = `${pct}%`;
        el.bloggerProgressMeta.textContent = `${msg.saved} / ${msg.total}`;
      }
      if (msg.type === 'blogger:done') {
        el.bloggerProgressLabel.textContent = `✅ 完成`;
        el.bloggerProgressPercent.textContent = '100%';
        el.bloggerProgressFill.style.width = '100%';
        el.bloggerProgressMeta.textContent = `已采集 ${msg.saved} / ${msg.total}`;
        el.btnBloggerStart.disabled = false;
      }
    });

    await refreshContext();
    checkUpdateStatus();
    setInterval(refreshContext, 4000);
  }

  let busy = false;
  function resetButtons() { busy = false; el.btnSavePage.disabled = false; el.btnSaveXhs.disabled = !context?.pageInfo?.hasApiData; }

  async function refreshContext() {
    try {
      const resp = await sendMessage({ type: 'sidepanel:get-context' });
      context = resp;

      // 连接状态
      const remain = Math.floor((context?.update?.lastCheckedAt ? (Date.now() - context.update.lastCheckedAt) / 60000 : 0));
      el.serverStatus.textContent = context?.tokenOk
        ? `✅ 飞书已连接`
        : '⏳ 初始化中...';
      el.serverStatus.className = context?.tokenOk ? 'status ok' : 'status idle';

      // 更新状态
      if (context?.update?.hasUpdate) {
        el.updateStatus.style.display = 'block';
        el.updateStatus.textContent = `🆕 v${context.update.latestVersion}`;
        el.updateStatus.className = 'status error';
        el.btnCheckUpdate.style.display = '';
        el.btnCheckUpdate.textContent = '🆕';
      }

      renderPage(context?.tab, context?.pageInfo);
    } catch(e) {
      el.serverStatus.textContent = '连接失败';
      el.serverStatus.className = 'status error';
    }
  }

  function renderPage(tab, pageInfo) {
    if (!tab?.url) {
      el.platformBadge.innerHTML = '🌐 请打开页面';
      el.pageTitle.textContent = '打开小红书或YouTube后自动识别';
      el.pageMeta.textContent = '';
      el.imagePreview.innerHTML = '';
      el.btnSavePage.disabled = true;
      el.btnSaveXhs.disabled = true;
      return;
    }

    const emoji = pageInfo?.platform === 'xhs' ? '🔴' : pageInfo?.platform === 'youtube' ? '▶️' : '🌐';
    el.platformBadge.innerHTML = `${emoji} ${pageInfo?.platformName || '网页'}${pageInfo?.pageType ? ' · ' + pageInfo.pageType : ''}`;
    el.pageTitle.textContent = pageInfo?.title || tab.title || '(无标题)';
    el.pageMeta.innerHTML = [
      pageInfo?.author ? `作者: ${pageInfo.author}` : '',
      pageInfo?.hasApiData ? '📡 API数据' : '',
    ].filter(Boolean).join(' | ');

    const imgs = pageInfo?.images || [];
    el.imagePreview.innerHTML = imgs.slice(0, 8).map(u =>
      `<img src="${esc(u)}" loading="lazy" onerror="this.style.display='none'">`
    ).join('');

    el.apiBadge.style.display = pageInfo?.hasApiData ? 'block' : 'none';
    if (pageInfo?.hasApiData && pageInfo?.apiInteraction) {
      const i = pageInfo.apiInteraction;
      el.apiBadge.textContent = `📡 ❤️${i.liked_count||0} ⭐${i.collected_count||0} 💬${i.comment_count||0}`;
    }

    const isXhsProfile = pageInfo?.platform === 'xhs' && pageInfo?.pageType === 'profile';
    el.bloggerPanel.classList.toggle('hidden', !isXhsProfile);

    el.btnSavePage.disabled = busy;
    el.btnSaveXhs.disabled = busy || !pageInfo?.hasApiData;
  }

  async function doCapture(type) {
    if (busy) return;
    busy = true;
    el.btnSavePage.disabled = true;
    el.btnSaveXhs.disabled = true;
    setStatus('pending', '⏳ 采集中...');
    try {
      const resp = await sendMessage({ type });
      if (!resp.success) setStatus('error', `❌ ${resp.error || '失败'}`);
    } catch(e) {
      setStatus('error', `❌ ${e.message}`);
      resetButtons();
    }
  }

  async function doBloggerCollect() {
    const limit = Math.max(1, Math.min(100, parseInt(el.bloggerLimit.value) || 20));
    const interval = Math.max(1, Math.min(10, parseFloat(el.bloggerInterval.value) || 2));
    el.btnBloggerStart.disabled = true;
    el.bloggerProgress.classList.remove('hidden');
    el.bloggerProgressLabel.textContent = '启动中...';
    try {
      const resp = await sendMessage({ type: 'capture:collect-blogger', limit, intervalMs: interval * 1000 });
      if (resp.success) {
        el.bloggerProgressLabel.textContent = '批量采集已启动';
        el.bloggerProgressMeta.textContent = '';
      } else {
        setStatus('error', resp.error || '启动失败');
        el.btnBloggerStart.disabled = false;
      }
    } catch(e) {
      setStatus('error', e.message);
      el.btnBloggerStart.disabled = false;
    }
  }

  function setStatus(state, msg) {
    el.captureStatus.textContent = msg;
    el.captureStatus.dataset.state = state;
    el.captureStatus.classList.remove('hidden');
    setTimeout(() => { if (el.captureStatus.textContent === msg) el.captureStatus.classList.add('hidden'); }, 5000);
  }

  async function refreshToken() {
    document.getElementById('btn-refresh-token').disabled = true;
    try {
      const resp = await sendMessage({ type: 'auth:refresh' });
      el.serverStatus.textContent = resp.success ? '✅ Token已刷新' : '❌ 刷新失败';
      el.serverStatus.className = resp.success ? 'status ok' : 'status error';
      if (resp.success) setTimeout(refreshContext, 1000);
    } catch(e) {
      el.serverStatus.textContent = '刷新失败';
      el.serverStatus.className = 'status error';
    }
    document.getElementById('btn-refresh-token').disabled = false;
  }

  async function checkUpdate() {
    el.btnCheckUpdate.disabled = true;
    try {
      const resp = await sendMessage({ type: 'update:check' });
      if (resp?.update?.hasUpdate) {
        el.updateStatus.style.display = 'block';
        el.updateStatus.textContent = `🆕 v${resp.update.latestVersion}`;
        el.updateStatus.className = 'status error';
        el.btnCheckUpdate.textContent = '🆕';
      } else {
        el.updateStatus.style.display = 'block';
        el.updateStatus.textContent = '✅ 已是最新';
        el.updateStatus.className = 'status ok';
        el.btnCheckUpdate.style.display = 'none';
        setTimeout(() => { el.updateStatus.style.display = 'none'; }, 3000);
      }
    } catch(e) {
      el.updateStatus.textContent = '检查失败';
      el.updateStatus.className = 'status error';
    }
    el.btnCheckUpdate.disabled = false;
  }

  async function checkUpdateStatus() {
    try {
      const resp = await sendMessage({ type: 'update:get-status' });
      if (resp?.update?.hasUpdate) {
        el.updateStatus.style.display = 'block';
        el.updateStatus.textContent = `🆕 v${resp.update.latestVersion}`;
        el.updateStatus.className = 'status error';
        el.btnCheckUpdate.style.display = '';
        el.btnCheckUpdate.textContent = '🆕';
      }
    } catch {}
  }

  function sendMessage(payload) {
    return new Promise((resolve) => {
      chrome.runtime.sendMessage(payload, (resp) => {
        resolve(resp || {});
      });
    });
  }

  function esc(s) {
    const d = document.createElement('div');
    d.textContent = String(s || '');
    return d.innerHTML;
  }

  init();
})();
