// 前程-灵感素材库 · 飞书开放平台桥接（内容脚本）
// 作用：当你在 open.feishu.cn 开发者后台浏览应用时，把「当前打开的应用」和
//      「你的应用列表」读出来回传给插件，省掉手动复制 App ID 这一步。
// 边界：只在页面里读 DOM —— 不注入任何界面、不发网络请求、不碰 App Secret
//      （飞书默认把 Secret 打码，插件在设计上也拿不到，必须用户手动复制）。
(() => {
  'use strict';

  const ID_SRC = 'cli_[A-Za-z0-9]{10,32}';
  const ID_ONE = new RegExp(ID_SRC);
  const ID_ALL = new RegExp(ID_SRC, 'g');
  const PATH_RE = new RegExp('/app/(' + ID_SRC + ')(?:/|$)');

  let lastKey = '';
  let ticks = 0;

  const pickId = (s) => {
    const m = String(s == null ? '' : s).match(ID_ONE);
    return m ? m[0] : '';
  };

  const clean = (s) => String(s == null ? '' : s).replace(/\s+/g, ' ').trim().slice(0, 40);

  function idFromPath() {
    const m = location.pathname.match(PATH_RE);
    return m ? m[1] : '';
  }

  // 页面标题形如「凭证与基础信息 - 灵感素材库 - 飞书开放平台」。
  // 要的是应用名，所以先剔掉平台名和控制台的页面名，再取【最后】一段。
  const NOISE = /^(飞书开放平台|开发者后台|Lark|Lark Open Platform|Open Platform|凭证与基础信息|基础信息|综合信息|应用信息|概览|权限管理|应用能力|机器人|事件与回调|安全设置|版本管理与发布|应用发布|数据权限|网页应用|小程序|开发配置|测试企业与人员)$/i;

  function nameFromTitle() {
    const parts = clean(document.title).split(/\s*[-|·]\s*/).filter(Boolean);
    for (let i = parts.length - 1; i >= 0; i--) {
      if (!NOISE.test(parts[i])) return parts[i].slice(0, 30);
    }
    return '';
  }

  // 应用列表页：链接里带 /app/cli_xxx，链接文字就是应用名 —— 比扫纯文本准得多。
  // 只有当链接一个都没解析出来时，才退回纯文本扫描，避免把页面里
  // 无关位置出现的 id（复制提示、文档示例等）当成应用列出来。
  function collectFromDom() {
    const map = new Map();
    try {
      document.querySelectorAll('a[href*="/app/cli_"]').forEach((a) => {
        const id = pickId(a.getAttribute('href'));
        if (!id) return;
        const name = clean(a.textContent);
        const cur = map.get(id);
        if (!cur || (!cur.name && name)) map.set(id, { appId: id, name });
      });
    } catch (e) { /* ignore */ }

    if (!map.size) {
      try {
        const txt = document.body ? document.body.innerText : '';
        (txt.match(ID_ALL) || []).forEach((id) => {
          if (!map.has(id)) map.set(id, { appId: id, name: '' });
        });
      } catch (e) { /* ignore */ }
    }

    return Array.from(map.values()).slice(0, 30);
  }

  function snapshot() {
    const urlId = idFromPath();
    if (urlId) {
      // 已在某个应用详情页：这个 id 就是用户"选中的那个"
      return { appId: urlId, name: nameFromTitle(), list: [{ appId: urlId, name: nameFromTitle() }] };
    }
    return { appId: '', name: '', list: collectFromDom() };
  }

  function send(msg) {
    try {
      chrome.runtime.sendMessage(msg, () => { void chrome.runtime.lastError; });
    } catch (e) { /* 扩展被重载时会抛，忽略 */ }
  }

  function scan() {
    if (document.hidden) return;
    const snap = snapshot();
    if (!snap.appId && !snap.list.length) return;
    const key = JSON.stringify(snap);
    if (key === lastKey) return;
    lastKey = key;
    send(Object.assign({ type: 'feishu-bridge:detected', pageUrl: location.href }, snap));
  }

  // 插件主动来问（设置页点「读取已打开的应用」时）
  chrome.runtime.onMessage.addListener((msg, _sender, respond) => {
    if (!msg || msg.type !== 'bridge:scan') return false;
    const snap = snapshot();
    respond(Object.assign({ ok: true, pageUrl: location.href }, snap));
    return true;
  });

  // 开发者后台是 SPA：站内跳转不会重跑内容脚本，用低频轮询兜底
  const timer = setInterval(() => {
    scan();
    if (++ticks >= 150) clearInterval(timer); // ~7.5 分钟后停，避免长期占资源
  }, 3000);

  setTimeout(scan, 1000);
  window.addEventListener('load', () => setTimeout(scan, 800));
})();
