// 前程智囊团 · 页面桥接器
// 由 page-observer 注入到页面，监听 MAIN 世界的 postMessage
(() => {
  window.addEventListener('message', (event) => {
    if (event.source !== window) return;
    if (event.data?.source === 'qiancheng-xhs-bridge') {
      // 转发到 page-observer content script
      window.postMessage(event.data, '*');
    }
  });
})();
