// 前程-灵感素材库 v4.2 — 设置页脚本
(() => {
  let config = null;

  // 收藏数据的字段定义（供映射使用）
  const CAPTURE_FIELDS = [
    { key: 'title', label: '笔记标题', desc: 'apiData.title || pageInfo.title' },
    { key: 'text', label: '正文内容', desc: 'apiData.desc || DOM正文' },
    { key: 'author', label: '作者/来源', desc: 'apiData.author.nickname || DOM作者' },
    { key: 'platform', label: '来源平台', desc: '小红书 / 网页' },
    { key: 'sourceUrl', label: '来源链接', desc: '笔记URL（超链接字段）' },
    { key: 'sourceType', label: '收录方式', desc: '浏览器收录 / 链接收录 / 批量收录' },
    { key: 'images', label: '素材图片', desc: '笔记图片（附件字段）' },
    { key: 'tags', label: '标签', desc: '话题标签（自动补 #）' },
    { key: 'publishTime', label: '发布时间', desc: '小红书笔记发布时间' },
    { key: 'interactionLikes', label: '点赞数', desc: '互动数据 - 点赞' },
    { key: 'interactionCollects', label: '收藏数', desc: '互动数据 - 收藏' },
    { key: 'interactionComments', label: '评论数', desc: '互动数据 - 评论' },
  ];

  const DOM = {};
  let tableFields = [];

  init();

  async function init() {
    bindElements();
    setupTabNav();
    await loadConfig();
    renderAll();
    setupEvents();
    // ⚠️ 必须调用：扫码一键授权（btn-auth-create / btn-auth-bind）和
    //    一键建表（btn-build-table）的事件监听都挂在 setupAuthUI 里
    setupAuthUI();
    setupFeishuBridge();
    setupPromptTab();
    setupWizard();
    setupUpdateUI();
    refreshWizard();
    await refreshDetected();
    // 支持外部带 hash 直达任意标签：settings.html#feishu / #mapping / #features / #prompt / #about
    const hashTab = (location.hash || '').replace(/^#/, '');
    if (hashTab && document.getElementById('tab-' + hashTab)) switchTab(hashTab);
  }

  function bindElements() {
    const ids = [
      'cfg-appId','cfg-appSecret','cfg-bitableUrl','cfg-appToken','cfg-tableId','cfg-tableSelect','cfg-tableName',
      'cfg-apiIntercept','cfg-domParse','cfg-imageUpload',
      'cfg-maxImages','cfg-collectInterval',
      'btn-toggle-secret','btn-parse-url','btn-list-tables','btn-fetch-fields','btn-test-connection',
      'btn-auto-map','btn-add-default','btn-reset-config',
      'btn-export-config','btn-import-config','btn-save-all',
      'connection-result','save-status','mapping-list','defaults-list',
      'import-file','version-tag','about-version',
      'btn-copy-prompt','copy-status','prompt-text',
      'btn-copy-perms','btn-verify-cred','cred-result','btn-quick-bind',
      'btn-health-check','health-list',
      'ws-1','ws-2','ws-3','btn-check-update','update-box','update-detail','cur-version',
      'btn-open-platform','btn-probe-feishu',
      'feishu-detected','feishu-detected-list','btn-open-app-baseinfo','btn-clear-detected',
      'btn-auth-create','btn-auth-bind','btn-auth-open','btn-auth-cancel','auth-status','auth-extra',
      'btn-open-app-auth','btn-open-app-version',
      'btn-build-table','itable-result','itable-link',
    ];
    ids.forEach(id => {
      DOM[id] = document.getElementById(id);
      if (!DOM[id]) console.warn('missing element:', id);
    });
  }

  async function loadConfig() {
    try {
      const r = await send({ type: 'settings:get-config' });
      if (r.success) {
        config = r.config;
        tableFields = config.tableFields || [];
      }
    } catch(e) {
      console.error('loadConfig:', e);
    }
  }

  function renderAll() {
    // 飞书凭证
    DOM['cfg-appId'].value = config.appId || '';
    DOM['cfg-appSecret'].value = config.appSecret || '';
    DOM['cfg-bitableUrl'].value = config.bitableUrl || '';
    DOM['cfg-appToken'].value = config.appToken || '';
    DOM['cfg-tableId'].value = config.tableId || '';
    DOM['cfg-tableName'].value = config.tableName || '';
    renderTableSelect(config.tables || [], config.tableId || '');

    // 功能开关
    const f = config.features || {};
    DOM['cfg-apiIntercept'].checked = f.apiIntercept !== false;
    DOM['cfg-domParse'].checked = f.domParse !== false;
    DOM['cfg-imageUpload'].checked = f.imageUpload !== false;
    DOM['cfg-maxImages'].value = f.maxImages || 9;
    DOM['cfg-collectInterval'].value = config.collectIntervalMs || 2500;

    // 版本
    const ver = chrome.runtime.getManifest().version;
    DOM['version-tag'].textContent = `v${ver}`;
    DOM['about-version'].textContent = `v${ver}`;

    renderMapping();
    renderDefaults();
  }


  function renderTableSelect(tables, selectedId) {
    const select = DOM['cfg-tableSelect'];
    if (!select) return;
    if (!Array.isArray(tables) || !tables.length) {
      select.innerHTML = selectedId
        ? `<option value="${escAttr(selectedId)}">${escHtml(config.tableName || selectedId)}</option>`
        : '<option value="">请先读取数据表列表</option>';
      return;
    }
    select.innerHTML = '<option value="">请选择数据表</option>' + tables.map(t => {
      const selected = t.id === selectedId ? 'selected' : '';
      return `<option value="${escAttr(t.id)}" data-name="${escAttr(t.name)}" ${selected}>${escHtml(t.name)} (${escHtml(t.id)})</option>`;
    }).join('');
  }

  function parseBitableUrl(url) {
    const raw = String(url || '').trim();
    if (!raw) return { appToken: '', tableId: '' };
    let appToken = '', tableId = '';
    try {
      const u = new URL(raw);
      const path = u.pathname;
      const baseMatch = path.match(/\/(base|bitable)\/([^/?#]+)/i);
      if (baseMatch) appToken = baseMatch[2];
      tableId = u.searchParams.get('table') || u.searchParams.get('table_id') || u.searchParams.get('tableId') || '';
      if (!tableId && u.hash) {
        const h = new URLSearchParams(u.hash.replace(/^#/, ''));
        tableId = h.get('table') || h.get('table_id') || h.get('tableId') || '';
      }
    } catch {
      const m = raw.match(/\/(?:base|bitable)\/([^/?#]+)/i);
      if (m) appToken = m[1];
      const tm = raw.match(/(?:table|table_id|tableId)=([^&#]+)/i) || raw.match(/\b(tbl[a-zA-Z0-9]+)\b/);
      if (tm) tableId = tm[1];
    }
    const tbl = raw.match(/\b(tbl[a-zA-Z0-9]+)\b/);
    if (!tableId && tbl) tableId = tbl[1];
    return { appToken, tableId };
  }

  function renderMapping() {
    const fm = config.fieldMapping || {};

    DOM['mapping-list'].innerHTML = CAPTURE_FIELDS.map(cf => {
      const currentVal = fm[cf.key] || '';
      const options = tableFields.map(f => {
        const selected = f.name === currentVal ? 'selected' : '';
        return `<option value="${escAttr(f.name)}" ${selected}>${escHtml(f.name)} (${f.typeName})</option>`;
      }).join('');
      const customOption = currentVal && !tableFields.some(f => f.name === currentVal)
        ? `<option value="${escAttr(currentVal)}" selected>${escHtml(currentVal)} (手动输入)</option>`
        : '';

      return `
        <div class="mapping-item">
          <div class="mapping-label">
            <span>${cf.label}</span>
            <span class="data-key">${cf.desc}</span>
          </div>
          <span class="mapping-arrow">→</span>
          <div class="mapping-field-select">
            <select data-map-key="${cf.key}">
              <option value="" style="color:#6b7280;">-- 不映射 --</option>
              ${options}
              ${customOption}
            </select>
          </div>
          <span style="font-size:10px;color:#495057;min-width:60px;text-align:right;">${cf.key}</span>
        </div>
      `;
    }).join('');
  }

  function renderDefaults() {
    const defs = config.defaults || {};
    const entries = Object.entries(defs);

    DOM['defaults-list'].innerHTML = entries.map(([key, val]) => `
      <div class="default-item">
        <input class="field-key" value="${escAttr(key)}" placeholder="字段名" data-default-key="${escAttr(key)}">
        <input class="field-value" value="${escAttr(val)}" placeholder="默认值" data-default-val="${escAttr(val)}">
        <button class="btn-remove-default" title="删除">✕</button>
      </div>
    `).join('') || '<div style="color:#6b7280;font-size:12px;padding:8px 0;">暂无默认值</div>';
  }

  // 反向查找「表格字段名 → 采集数据 key」的旧 helper 已删除：
  // 全项目没有任何地方调用它（2026-09-19 排查"按钮没反应"时顺手清掉的死代码）

  function setupEvents() {
    // Tab 切换
    document.querySelectorAll('.tab-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        const tabId = btn.dataset.tab;
        document.querySelectorAll('.tab-content').forEach(tc => tc.classList.remove('active'));
        document.getElementById(`tab-${tabId}`).classList.add('active');
      });
    });

    // 密码显示切换
    DOM['btn-toggle-secret'].addEventListener('click', () => {
      const inp = DOM['cfg-appSecret'];
      if (inp.type === 'password') {
        inp.type = 'text';
        DOM['btn-toggle-secret'].textContent = '🙈';
      } else {
        inp.type = 'password';
        DOM['btn-toggle-secret'].textContent = '👁️';
      }
    });

    // 解析完整多维表格链接
    DOM['btn-parse-url'].addEventListener('click', () => {
      const parsed = parseBitableUrl(DOM['cfg-bitableUrl'].value);
      if (parsed.appToken) DOM['cfg-appToken'].value = parsed.appToken;
      if (parsed.tableId) DOM['cfg-tableId'].value = parsed.tableId;
      if (parsed.appToken) {
        showConnectionStatus('success', `✅ 已识别 APP_TOKEN${parsed.tableId ? ' 和 TABLE_ID' : ''}`);
      } else {
        showConnectionStatus('error', '❌ 未识别到多维表格 token，请确认链接中包含 /base/xxx');
      }
    });

    // 读取数据表列表
    DOM['btn-list-tables'].addEventListener('click', async () => {
      const parsed = parseBitableUrl(DOM['cfg-bitableUrl'].value);
      if (parsed.appToken) DOM['cfg-appToken'].value = parsed.appToken;
      if (parsed.tableId) DOM['cfg-tableId'].value = parsed.tableId;
      if (!DOM['cfg-appToken'].value.trim()) {
        showConnectionStatus('error', '❌ 请先粘贴多维表格链接，或手动填写 APP_TOKEN');
        return;
      }
      DOM['btn-list-tables'].disabled = true;
      showConnectionStatus('loading', '⏳ 正在读取数据表列表...');
      try {
        const r = await send({
          type: 'settings:list-tables',
          appToken: DOM['cfg-appToken'].value.trim(),
          appId: DOM['cfg-appId'].value.trim(),
          appSecret: DOM['cfg-appSecret'].value.trim(),
        });
        if (r.success) {
          config.tables = r.tables || [];
          renderTableSelect(config.tables, DOM['cfg-tableId'].value.trim());
          showConnectionStatus('success', `✅ 读取到 ${config.tables.length} 张数据表，请选择要写入的表`);
        } else {
          showConnectionStatus('error', `❌ ${r.error}`);
        }
      } catch(e) {
        showConnectionStatus('error', `❌ ${e.message}`);
      }
      DOM['btn-list-tables'].disabled = false;
    });

    // 选择数据表后同步 Table ID 和名称
    DOM['cfg-tableSelect'].addEventListener('change', () => {
      const opt = DOM['cfg-tableSelect'].selectedOptions[0];
      DOM['cfg-tableId'].value = DOM['cfg-tableSelect'].value || '';
      DOM['cfg-tableName'].value = opt?.dataset?.name || '';
      tableFields = [];
      config.tableFields = [];
      renderMapping();
    });

    // 自动探测字段
    DOM['btn-fetch-fields'].addEventListener('click', async () => {
      const parsed = parseBitableUrl(DOM['cfg-bitableUrl'].value);
      if (parsed.appToken) DOM['cfg-appToken'].value = parsed.appToken;
      if (parsed.tableId && !DOM['cfg-tableId'].value.trim()) DOM['cfg-tableId'].value = parsed.tableId;
      if (!DOM['cfg-appToken'].value.trim() || !DOM['cfg-tableId'].value.trim()) {
        showConnectionStatus('error', '❌ 请先粘贴多维表格链接并选择数据表');
        return;
      }
      DOM['btn-fetch-fields'].disabled = true;
      showConnectionStatus('loading', '⏳ 正在获取表格字段...');
      try {
        const r = await send({
          type: 'settings:fetch-fields',
          appToken: DOM['cfg-appToken'].value.trim(),
          tableId: DOM['cfg-tableId'].value.trim(),
          appId: DOM['cfg-appId'].value.trim(),
          appSecret: DOM['cfg-appSecret'].value.trim(),
        });
        if (r.success) {
          tableFields = r.fields;
          config.tableFields = r.fields;
          renderMapping();
          showConnectionStatus('success', `✅ 获取到 ${r.fields.length} 个字段`);
        } else {
          showConnectionStatus('error', `❌ ${r.error}`);
        }
      } catch(e) {
        showConnectionStatus('error', `❌ ${e.message}`);
      }
      DOM['btn-fetch-fields'].disabled = false;
    });

    // 测试连接
    DOM['btn-test-connection'].addEventListener('click', async () => {
      DOM['btn-test-connection'].disabled = true;
      showConnectionStatus('loading', '⏳ 正在测试连接...');
      // 先临时保存当前凭证
      const parsed = parseBitableUrl(DOM['cfg-bitableUrl'].value);
      if (parsed.appToken) DOM['cfg-appToken'].value = parsed.appToken;
      if (parsed.tableId && !DOM['cfg-tableId'].value.trim()) DOM['cfg-tableId'].value = parsed.tableId;
      const tempConfig = { ...config,
        appId: DOM['cfg-appId'].value.trim(),
        appSecret: DOM['cfg-appSecret'].value.trim(),
        appToken: DOM['cfg-appToken'].value.trim(),
        tableId: DOM['cfg-tableId'].value.trim(),
        bitableUrl: DOM['cfg-bitableUrl'].value.trim(),
      };
      await send({ type: 'settings:save-config', config: tempConfig });
      config = tempConfig;
      try {
        const r = await send({ type: 'settings:test-connection' });
        if (r.success) {
          showConnectionStatus('success', `✅ ${r.message}`);
        } else {
          showConnectionStatus('error', `❌ ${r.error}`);
        }
      } catch(e) {
        showConnectionStatus('error', `❌ ${e.message}`);
      }
      DOM['btn-test-connection'].disabled = false;
    });

    // 智能自动匹配
    DOM['btn-auto-map'].addEventListener('click', () => {
      if (!tableFields.length) {
        alert('请先点击「自动探测表格字段」获取表结构');
        return;
      }
      const fm = { ...config.fieldMapping };
      const autoMapRules = {
        title: ['选题标题', '标题', '笔记标题', '名称', '主题', 'title', 'name'],
        text: ['多行文本', '正文', '内容', '文案内容', '描述', '正文内容', 'content', 'desc'],
        author: ['作者/来源', '作者', '来源', '发布者', '昵称', 'author'],
        platform: ['来源平台', '平台', '来源', 'platform'],
        sourceUrl: ['来源链接', '链接', '笔记链接', 'URL', 'url', 'source'],
        sourceType: ['选题来源', '采集来源', '来源类型', '采集方式', 'source'],
        images: ['素材图片', '图片', '附件', '配图', 'images', 'image'],
        tags: ['标签', '话题', '关键词', 'tags', 'tag'],
        publishTime: ['发布时间', '发布日期', '发布于', '时间', '笔记时间', 'publishTime', 'publish_time'],
        interactionLikes: ['点赞数', '点赞', 'likes', 'like'],
        interactionCollects: ['收藏数', '收藏', 'collects', 'collect'],
        interactionComments: ['评论数', '评价数', '评论', '评价', 'comments', 'comment'],
      };

      for (const [dataKey, candidates] of Object.entries(autoMapRules)) {
        for (const candidate of candidates) {
          const match = tableFields.find(f =>
            f.name === candidate || f.name.toLowerCase() === candidate.toLowerCase()
          );
          if (match) { fm[dataKey] = match.name; break; }
        }
      }
      config.fieldMapping = fm;
      renderMapping();
      showConnectionStatus('success', '✅ 智能匹配完成，请检查结果');
    });

    // 添加默认值
    DOM['btn-add-default'].addEventListener('click', () => {
      const defs = config.defaults || {};
      const key = prompt('字段名（如：状态）：');
      if (!key) return;
      const val = prompt(`"${key}" 的默认值：`, '');
      if (val === null) return;
      defs[key] = val;
      config.defaults = defs;
      renderDefaults();
    });

    // 删除默认值（事件委托）
    DOM['defaults-list'].addEventListener('click', (e) => {
      if (e.target.classList.contains('btn-remove-default')) {
        const item = e.target.closest('.default-item');
        const keyInput = item.querySelector('.field-key');
        const key = keyInput.value;
        delete config.defaults[key];
        renderDefaults();
      }
    });

    // 重置配置
    DOM['btn-reset-config'].addEventListener('click', async () => {
      if (!confirm('确定要重置所有配置为默认值吗？')) return;
      try {
        const r = await send({ type: 'settings:reset-config' });
        if (r.success) {
          config = r.config || config;
          await loadConfig();
          renderAll();
          showSaveStatus('saved', '已重置');
        }
      } catch(e) {
        showSaveStatus('error', e.message);
      }
    });

    // 导出配置
    DOM['btn-export-config'].addEventListener('click', () => {
      // 去除 appSecret 再导出（安全）
      const exportConfig = { ...config, appSecret: '' };
      const blob = new Blob([JSON.stringify(exportConfig, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'idea-hub-config.json';
      a.click();
      URL.revokeObjectURL(url);
      showSaveStatus('saved', '配置已导出（不含密钥）');
    });

    // 导入配置
    DOM['btn-import-config'].addEventListener('click', () => {
      DOM['import-file'].click();
    });
    DOM['import-file'].addEventListener('change', (e) => {
      const file = e.target.files[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = async (ev) => {
        try {
          const importedConfig = JSON.parse(ev.target.result);
          // 合并导入的配置
          config = { ...config, ...importedConfig };
          if (importedConfig.fieldMapping) {
            config.fieldMapping = { ...config.fieldMapping, ...importedConfig.fieldMapping };
          }
          if (importedConfig.defaults) {
            config.defaults = { ...config.defaults, ...importedConfig.defaults };
          }
          if (importedConfig.features) {
            config.features = { ...config.features, ...importedConfig.features };
          }
          renderAll();
          showSaveStatus('saved', '配置已导入，请点击保存');
        } catch(e) {
          showSaveStatus('error', `导入失败: ${e.message}`);
        }
      };
      reader.readAsText(file);
      DOM['import-file'].value = '';
    });

    // 保存配置
    DOM['btn-save-all'].addEventListener('click', saveAllConfig);
  }

  function setupTabNav() {
    document.querySelectorAll('.tab-btn').forEach(btn => {
      btn.addEventListener('click', () => switchTab(btn.dataset.tab));
    });
  }

  // 切换标签页（也支持外部带 hash 直达，如 settings.html#about）
  function switchTab(tabId) {
    if (!tabId) return;
    const btn = document.querySelector(`.tab-btn[data-tab="${tabId}"]`);
    const pane = document.getElementById(`tab-${tabId}`);
    if (!btn || !pane) return;
    document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    document.querySelectorAll('.tab-content').forEach(el => el.classList.remove('active'));
    pane.classList.add('active');
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  // ====== 配置向导 ======
  const PERM_TEXT = `请在飞书开放平台为你的应用开通以下权限。
推荐做法：左侧「权限管理」→ 右上角「批量导入/导出权限」，把下面这段 JSON 整个粘进去再点确认。

{
  "scopes": {
    "tenant": [
      "base:app:create",
      "base:table:read",
      "base:table:create",
      "base:table:delete",
      "base:field:read",
      "base:field:create",
      "base:record:create",
      "docs:document.media:upload"
    ],
    "user": []
  }
}

各条对应的能力（怕批量导入用不了就按名字搜着开）：
  多维表格 — 创建多维表格                base:app:create
  多维表格 — 查看数据表                  base:table:read
  多维表格 — 新增数据表                  base:table:create
  多维表格 — 删除数据表                  base:table:delete
  多维表格 — 查看字段                    base:field:read
  多维表格 — 新增字段                    base:field:create
  多维表格 — 新增记录                    base:record:create
  云文档   — 上传图片和附件到云文档中     docs:document.media:upload

说明：只要这 8 条就够了，都是「按接口最小必要」给的。
别只开「多维表格 — 查看」，那是只读的，建不了表也写不进数据。

⚠️ 开完权限后，要「创建版本并发布」，权限才会生效——
   如果你是用插件里的扫码一键创建，飞书会自动发布，不需要这一步；
   只有在开发者后台手动给已有应用加权限时，才要自己去「版本管理与发布」点一下。`;

  // 插件会写入的单选值 —— 表里必须预先建好这些选项，否则飞书报 1254062
  const REQUIRED_OPTIONS = {
    '来源平台': ['小红书', '网页'],
    '选题来源': ['浏览器收录', '链接收录', '图片收录', '批量收录'],
    '状态': ['待选题', '已选题', '已完成'],
    '优先级': ['高', '中', '低'],
  };

  // 可选选项：缺了完全不影响正常使用。只有当你真的去收对应的页面时才写得到，
  // 所以缺了只提示、不判失败。
  const OPTIONAL_OPTIONS = {
    '来源平台': ['YouTube'],
  };

  function refreshWizard() {
    const hasCred = !!(DOM['cfg-appId']?.value.trim() && DOM['cfg-appSecret']?.value.trim());
    const hasTable = !!(DOM['cfg-appToken']?.value.trim() && DOM['cfg-tableId']?.value.trim());
    const mark = (id, cls) => {
      const n = DOM[id];
      if (!n) return;
      n.classList.remove('active', 'done');
      if (cls) n.classList.add(cls);
    };
    // 步骤 1（建应用）发生在插件之外、无法探测，因此只有在"已有凭证"时才推断为已完成；
    // 否则保持在"当前"态，避免一进来就显示绿色对勾误导用户跳过建应用。
    mark('ws-1', hasCred ? 'done' : 'active');
    mark('ws-2', hasCred ? (hasTable ? 'done' : 'active') : '');
    mark('ws-3', hasTable ? 'done' : (hasCred ? 'active' : ''));
  }

  // ===== 飞书开放平台桥接：直接选用已有应用 =====
  // 设计说明：飞书官方「获取企业应用列表」接口需要 tenant_access_token，
  // 而拿 token 又必须先有 App ID/Secret —— 死循环，所以在用户填凭证前
  // 插件无法通过 API 列出应用。改为让内容脚本(feishu-bridge.js)在用户
  // 已经登录的开发者后台页面里读 DOM，把应用回传过来。
  const FEISHU_APP_URL = 'https://open.feishu.cn/app';
  const APP_ID_RE = /cli_[A-Za-z0-9]{10,32}/;

  function appBaseinfoUrl(appId) {
    return `${FEISHU_APP_URL}/${encodeURIComponent(appId)}/baseinfo`;
  }

  function openTab(url) {
    try { chrome.tabs.create({ url }); } catch (e) { window.open(url, '_blank'); }
  }

  let detectedState = null;

  function renderDetected(detected) {
    detectedState = detected || null;
    const box = DOM['feishu-detected'];
    const list = DOM['feishu-detected-list'];
    if (!box || !list) return;

    const items = [];
    const raw = (detected && Array.isArray(detected.list)) ? detected.list.slice() : [];
    raw.forEach(x => { if (x && x.appId) items.push({ appId: String(x.appId), name: String(x.name || '') }); });
    if (detected && detected.appId && !items.some(x => x.appId === detected.appId)) {
      items.unshift({ appId: String(detected.appId), name: String(detected.name || '') });
    }

    // 去重 + 与当前已配置的一致就不再打扰
    const seen = new Set();
    const cur = (DOM['cfg-appId']?.value || '').trim();
    const useful = items.filter(x => {
      if (seen.has(x.appId) || x.appId === cur) return false;
      seen.add(x.appId);
      return true;
    });

    if (!useful.length) { box.classList.add('hidden'); return; }

    list.innerHTML = useful.map(it => `
      <button type="button" class="detected-item" data-appid="${escAttr(it.appId)}">
        <span class="di-name">${escHtml(it.name || '未命名应用')}</span>
        <span class="di-id">${escHtml(it.appId)}</span>
        <span class="di-use">填入 →</span>
      </button>`).join('');

    list.querySelectorAll('.detected-item').forEach(btn => {
      btn.addEventListener('click', () => {
        const id = btn.dataset.appid;
        if (!DOM['cfg-appId']) return;
        DOM['cfg-appId'].value = id;
        DOM['cfg-appId'].dispatchEvent(new Event('input', { bubbles: true }));
        DOM['btn-open-app-baseinfo'].dataset.appid = id;
        showSaveStatus('saved', '已填入 App ID，别忘了点底部「保存配置」');
        renderDetected(detectedState); // 填完就把这条从待选里去掉
      });
    });

    const target = APP_ID_RE.test(cur) ? cur : useful[0].appId;
    DOM['btn-open-app-baseinfo'].dataset.appid = target;
    box.classList.remove('hidden');
  }

  async function refreshDetected() {
    try {
      const r = await send({ type: 'settings:get-detected-app' });
      renderDetected(r && r.detected ? r.detected : null);
    } catch (e) { renderDetected(null); }
  }

  async function probeFeishuApp() {
    const btn = DOM['btn-probe-feishu'];
    const old = btn ? btn.textContent : '';
    if (btn) { btn.disabled = true; btn.textContent = '读取中…'; }
    try {
      const r = await send({ type: 'settings:probe-feishu-app' });
      if (r && r.success) {
        renderDetected(r.detected);
        const n = r.detected && r.detected.list ? r.detected.list.length : 0;
        showSaveStatus('saved', n > 1 ? `读到 ${n} 个应用，挑一个填入` : '已读到应用，点一下填入');
      } else if (r && r.error === 'no-open-tab') {
        showSaveStatus('error', '没找到已打开的飞书开放平台页面，先点左边的按钮打开');
      } else {
        showSaveStatus('error', '页面里没读到应用，确认已经登录并点进了某个应用');
      }
    } catch (e) {
      showSaveStatus('error', '读取失败：' + e.message);
    } finally {
      if (btn) { btn.disabled = false; btn.textContent = old; }
    }
  }

  function setupFeishuBridge() {
    DOM['btn-open-platform']?.addEventListener('click', () => openTab(FEISHU_APP_URL));
    DOM['btn-probe-feishu']?.addEventListener('click', probeFeishuApp);

    DOM['btn-open-app-baseinfo']?.addEventListener('click', (e) => {
      const id = e.currentTarget.dataset.appid;
      if (!APP_ID_RE.test(id || '')) return;
      openTab(appBaseinfoUrl(id));
    });

    DOM['btn-clear-detected']?.addEventListener('click', async () => {
      DOM['feishu-detected']?.classList.add('hidden');
      detectedState = null;
      try { await send({ type: 'settings:clear-detected-app' }); } catch (e) {}
    });

    // 你在飞书那边选好应用后，设置页会实时收到
    chrome.runtime.onMessage.addListener((msg) => {
      if (msg && msg.type === 'feishu:detected') renderDetected(msg.detected);
    });

    // 用户可能直接把应用详情页链接粘进 App ID 框 —— 自动抽出 cli_xxx
    DOM['cfg-appId']?.addEventListener('paste', () => {
      setTimeout(() => {
        const el = DOM['cfg-appId'];
        const m = String(el.value || '').match(APP_ID_RE);
        if (m && m[0] !== el.value.trim()) {
          el.value = m[0];
          showSaveStatus('saved', '已从链接里提取 App ID');
        }
      }, 0);
    });
  }

  // ====== 飞书一键授权（OAuth 2.0 Device Flow · RFC 8628）======
  // 飞书各语言 SDK 里的「一键创建应用」（register_app / registerApp）底层就是这个协议：
  //   begin  → 拿到 device_code + 扫码链接
  //   poll   → 用户扫码确认后，直接返回 App ID + App Secret
  // 端点公开，且扩展页面有 host_permissions、fetch 不受 CORS 限制 —— 所以整条链路
  // 都能在插件里跑完，不需要任何自建后端。
  const AUTH_HOST = 'https://accounts.feishu.cn';
  const AUTH_HOST_LARK = 'https://accounts.larksuite.com';
  const AUTH_PATH = '/oauth/v1/app/registration';
  // ⚠️ 这里必须用「飞书一键建应用」目录里的新式权限点（base:* / docs:*）。
  //    老的 bitable:app / drive:drive 在开发者后台手动开通是有效的，但**不在
  //    launcher 落地页的权限目录里**，写进 addons 会被静默丢掉 → 确认页一条都预填不上。
  //    目录来源：https://open.feishu.cn/lark-cli/apis/scopes.json（v1.0.96，21 个分类 / 467 个权限点）
  //    下面 8 条 = 插件真实调用到的接口所需的最小集合，逐条对应：
  //      base:app:create             POST   /bitable/v1/apps                     建多维表格
  //      base:table:read             GET    .../tables                           列数据表
  //      base:table:create           POST   .../tables                           建数据表
  //      base:table:delete           DELETE .../tables/{tid}                     删掉 Base 自带的空表
  //      base:field:read             GET    .../tables/{tid}/fields              读字段结构（字段映射）
  //      base:field:create           POST   .../tables/{tid}/fields              建字段
  //      base:record:create          POST   .../tables/{tid}/records             写素材
  //      docs:document.media:upload  POST   /drive/v1/medias/upload_prepare…     传封面 / 图片素材
  const AUTH_SCOPES = {
    tenant: [
      'base:app:create',
      'base:table:read',
      'base:table:create',
      'base:table:delete',
      'base:field:read',
      'base:field:create',
      'base:record:create',
      'docs:document.media:upload',
    ],
  };
  const APP_NAME = '前程-灵感素材库';
  const APP_DESC = '把小红书 / 网页素材一键收进飞书多维表格';
  // 应用头像必须是公网可访问的图片，直接用仓库里的图标
  const APP_AVATAR = 'https://raw.githubusercontent.com/pengqiancheng-sys/xhs-collector/main/icons/icon128.png';

  const appAuthUrl = (id) => `https://open.feishu.cn/app/${id}/auth`;
  const appVersionUrl = (id) => `https://open.feishu.cn/app/${id}/version`;

  let authFlow = null;

  // addons 编码（飞书侧固定的解码管线）：
  //   JSON.stringify → gzip → base64 → URL-safe（'+'→'-'、'/'→'_'、去掉末尾 '='）
  // 浏览器里用 CompressionStream('gzip') 就能做，不需要引任何三方库。
  async function encodeAddons(addons) {
    const stream = new Blob([JSON.stringify(addons)]).stream().pipeThrough(new CompressionStream('gzip'));
    const bytes = new Uint8Array(await new Response(stream).arrayBuffer());
    let bin = '';
    for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
    return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  }

  async function authPost(host, params) {
    const res = await fetch(host + AUTH_PATH, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams(params).toString(),
    });
    // ⚠️ RFC 8628 的 authorization_pending / slow_down 是 HTTP 400 回来的，
    //    所以非 2xx 也必须照样解析 body，不能一看到状态码就抛错。
    const text = await res.text();
    try { return JSON.parse(text); }
    catch (e) { throw new Error(`飞书返回了无法解析的内容（HTTP ${res.status}）`); }
  }

  function remainText(expiresAt) {
    const s = Math.max(0, Math.round((expiresAt - Date.now()) / 1000));
    return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
  }

  function renderAuthStatus(level, text) {
    const box = DOM['auth-status'];
    if (!box) return;
    box.className = `auth-status ${level}`;
    box.textContent = text;
  }

  function setAuthButtons(state) {
    const show = (id, on) => DOM[id] && DOM[id].classList.toggle('hidden', !on);
    show('btn-auth-create', state === 'idle');
    show('btn-auth-bind', state === 'idle');
    show('btn-auth-open', state === 'pending' || state === 'done');
    show('btn-auth-cancel', state === 'pending');
  }

  function stopAuthFlow() {
    if (authFlow && authFlow.timer) clearTimeout(authFlow.timer);
    authFlow = null;
    setAuthButtons('idle');
  }

  async function startAuthFlow(mode, appId) {
    stopAuthFlow();
    setAuthButtons('pending');
    renderAuthStatus('loading', '正在向飞书申请授权链接…');
    try {
      const begin = await authPost(AUTH_HOST, {
        action: 'begin',
        archetype: 'PersonalAgent',
        auth_method: 'client_secret',
        request_user_info: 'open_id',
      });
      if (!begin.device_code || !begin.verification_uri_complete) {
        throw new Error(begin.error_description || begin.error || '飞书没有返回 device_code');
      }

      const url = new URL(begin.verification_uri_complete);
      url.searchParams.set('from', 'ext');
      url.searchParams.set('source', 'xhs-collector');
      // ⚠️ 不要传 tp。launcher 里 tp 是「应用底座模板 ID」
      //    （openclaw_plugin_template / lark_cli_template / default / minimal），
      //    一旦 addons 被平台丢弃，tp 会直接顶成 manifestTemplateId —— 传 'ext' 这种
      //    非模板值会走到一个不存在的模板上。来源追踪有 from 就够了。
      url.searchParams.set('name', APP_NAME);
      url.searchParams.set('desc', APP_DESC);
      url.searchParams.set('avatar', APP_AVATAR);
      // addons = 预填到飞书「确认权限」页的配置，用户点确认即生效。
      //   preset:false → 走官方「最小基础模板」(minimal)：最终只包含下面显式声明的权限，
      //                  不会顺带塞进机器人能力 / im / cardkit 等我们用不到的东西。
      //   user:[]      → 显式写空数组（省略也等价于 []，写出来更清楚）。
      // 另外 preset:false 还会命中 launcher 的 isMinimalBaseCreate 分支，
      // 保证「确认权限」这一步一定会出现。
      url.searchParams.set('addons', await encodeAddons({
        scopes: { tenant: AUTH_SCOPES.tenant, user: [] },
        preset: false,
      }));
      if (mode === 'bind') {
        // 带 clientID → 飞书把这条链接当成「更新这个已有应用」，用来增量补权限
        const id = String(appId || '').trim();
        if (!APP_ID_RE.test(id)) throw new Error('请先在第 2 步填入/选好 App ID，再来补权限');
        url.searchParams.set('clientID', id);
      }
      // 新建路径**刻意不传** createOnly：
      //   launcher 内部 canUseExistingAppEntry = !isCreateOnly && from !== 'backend_oneclick'，
      //   只有不带 createOnly 时落地页才会出现「选择已有应用」入口。
      //   → 所以一个二维码就同时覆盖「新建」和「选已有」，用户自己在飞书页面上挑。

      authFlow = {
        host: AUTH_HOST,
        deviceCode: begin.device_code,
        interval: (begin.interval || 5) * 1000,
        expiresAt: Date.now() + (begin.expires_in || 600) * 1000,
        url: url.toString(),
        mode,
        appId: mode === 'bind' ? String(appId || '').trim() : '',
        unknowns: 0,
      };
      openTab(authFlow.url);
      renderScanStatus();
      schedulePoll();
    } catch (e) {
      stopAuthFlow();
      renderAuthStatus('error', `❌ 申请授权链接失败：${e.message}`);
    }
  }

  function renderScanStatus(extra) {
    if (!authFlow) return;
    const tip = authFlow.mode === 'bind'
      ? '已打开飞书授权页 —— 用飞书 App 扫码，给这个应用补上缺的权限'
      : '已打开飞书授权页 —— 用飞书 App 扫码，页面上可以直接「新建应用」，也可以点「选择已有应用」';
    renderAuthStatus('scan', `${extra ? extra + '　' : ''}${tip}（二维码剩余 ${remainText(authFlow.expiresAt)}）`);
  }

  function schedulePoll() {
    if (!authFlow) return;
    authFlow.timer = setTimeout(pollAuth, authFlow.interval);
  }

  async function pollAuth() {
    if (!authFlow) return;
    if (Date.now() > authFlow.expiresAt) {
      stopAuthFlow();
      renderAuthStatus('error', '⏰ 二维码已过期（有效期约 1 小时）。点「↗ 重新打开授权页」再来一次。');
      return;
    }
    const flow = authFlow;
    try {
      const r = await authPost(flow.host, { action: 'poll', device_code: flow.deviceCode });

      // 成功：直接拿到凭据
      if (r.client_id && r.client_secret) return onAuthSuccess(r);
      // 只回 client_id 不回 secret，两种来源都走这里：
      //   ① 走「补权限」按钮绑了已有应用 —— 飞书不会重发已存在应用的 Secret
      //   ② 走「创建」入口、但在飞书页面上点了「选择已有应用」—— 结果同上
      // 两种都只回填 App ID，再提示手动复制 Secret
      // （插件在技术上永远读不到飞书打码的 Secret）。
      if (r.client_id) return onAuthSuccess({ ...r, noSecret: true });
      if (r.error === 'access_denied') {
        stopAuthFlow();
        renderAuthStatus('error', '你在飞书里拒绝了授权。可以点「↗ 重新打开授权页」再试。');
        return;
      }
      if (r.error === 'expired_token') {
        stopAuthFlow();
        renderAuthStatus('error', '⏰ 二维码已过期。点「↗ 重新打开授权页」再来一次。');
        return;
      }
      if (r.error === 'slow_down') {
        flow.interval += 5000;
      } else if (r.error && r.error !== 'authorization_pending') {
        // 未知错误不立刻判死：偶发抖动很常见，连错 6 次才放弃
        if (++flow.unknowns > 6) {
          stopAuthFlow();
          renderAuthStatus('error', `❌ 飞书返回：${r.error_description || r.error}`);
          return;
        }
      } else {
        flow.unknowns = 0;
      }

      // 国际版租户 → 换域名继续轮询
      if (r.user_info && r.user_info.tenant_brand === 'lark') flow.host = AUTH_HOST_LARK;

      renderScanStatus();
      schedulePoll();
    } catch (e) {
      if (++flow.unknowns > 6) {
        stopAuthFlow();
        renderAuthStatus('error', `❌ 轮询失败：${e.message}`);
        return;
      }
      renderScanStatus('网络抖动，正在重试…');
      schedulePoll();
    }
  }

  async function onAuthSuccess(r) {
    stopAuthFlow();

    DOM['cfg-appId'].value = r.client_id;
    DOM['cfg-appId'].dispatchEvent(new Event('input', { bubbles: true }));
    DOM['btn-open-app-baseinfo'].dataset.appid = r.client_id;
    if (DOM['btn-open-app-auth']) DOM['btn-open-app-auth'].dataset.appid = r.client_id;
    if (DOM['btn-open-app-version']) DOM['btn-open-app-version'].dataset.appid = r.client_id;

    if (r.client_secret) {
      DOM['cfg-appSecret'].value = r.client_secret;
      DOM['cfg-appSecret'].dispatchEvent(new Event('input', { bubbles: true }));
      await saveAllConfig();
      setAuthButtons('done');
      renderAuthStatus('ok',
        `✅ 完成！App ID 和 App Secret 已自动填入并保存（${r.client_id}）。` +
        '下一步：去第 3 步点「🏗️ 一键建表并绑定」。');
      showSaveStatus('saved', '凭证已自动填入并保存');
    } else {
      await saveAllConfig();
      setAuthButtons('done');
      renderAuthStatus('ok',
        `✅ 已绑定应用 ${r.client_id}，但这次飞书没有回传 App Secret。` +
        '（如果你在飞书页面上选的是「已有应用」，它不会重发那个应用的 Secret，这是正常的。）' +
        '请点下面的「🔑 去复制 App Secret」，粘到第 2 步的输入框里。');
    }
    setAuthExtraLinks(true);
    refreshWizard();
  }

  function setAuthExtraLinks(show) {
    ['btn-open-app-auth', 'btn-open-app-version'].forEach(id => {
      const el = DOM[id];
      if (!el) return;
      el.classList.toggle('hidden', !show);
      el.dataset.appid = el.dataset.appid || DOM['cfg-appId'].value.trim();
    });
  }

  function setupAuthUI() {
    DOM['btn-auth-create']?.addEventListener('click', () => startAuthFlow('create'));
    DOM['btn-auth-bind']?.addEventListener('click', () => startAuthFlow('bind', DOM['cfg-appId'].value.trim()));
    DOM['btn-auth-open']?.addEventListener('click', () => { if (authFlow) openTab(authFlow.url); });
    DOM['btn-auth-cancel']?.addEventListener('click', () => {
      stopAuthFlow();
      renderAuthStatus('error', '已停止轮询。可以重新发起。');
    });
    DOM['btn-open-app-auth']?.addEventListener('click', (e) => {
      const id = e.currentTarget.dataset.appid || DOM['cfg-appId'].value.trim();
      if (APP_ID_RE.test(id || '')) openTab(appAuthUrl(id));
    });
    DOM['btn-open-app-version']?.addEventListener('click', (e) => {
      const id = e.currentTarget.dataset.appid || DOM['cfg-appId'].value.trim();
      if (APP_ID_RE.test(id || '')) openTab(appVersionUrl(id));
    });

    // 一键建表
    DOM['btn-build-table']?.addEventListener('click', buildItable);
  }

  async function buildItable() {
    const btn = DOM['btn-build-table'];
    const box = DOM['itable-result'];
    const appId = DOM['cfg-appId'].value.trim();
    const appSecret = DOM['cfg-appSecret'].value.trim();
    if (!appId || !appSecret) {
      showConnectionStatus('error', '❌ 请先完成第 1、2 步：拿到并填好 App ID 与 App Secret');
      return;
    }
    if (btn) btn.disabled = true;
    if (box) { box.className = 'connection-result loading'; box.textContent = '⏳ 正在新建多维表格并写入 14 个字段…'; }

    let r;
    try {
      r = await send({ type: 'settings:create-itable', appId, appSecret });
    } catch (e) {
      r = { success: false, error: e.message };
    }
    if (btn) btn.disabled = false;

    if (!r || !r.success) {
      if (box) { box.className = 'connection-result error'; box.textContent = `❌ 建表失败：${r ? r.error : '未知错误'}`; }
      return;
    }

    // 回填并保存
    DOM['cfg-bitableUrl'].value = r.url;
    DOM['cfg-appToken'].value = r.appToken;
    DOM['cfg-tableId'].value = r.tableId;
    DOM['cfg-tableName'].value = r.tableName;
    config.tables = [{ id: r.tableId, name: r.tableName }];
    renderTableSelect(config.tables, r.tableId);

    // 顺手把字段读回来并自动映射 —— 新表就是照规格建的，映射必然全中
    try {
      const rf = await send({ type: 'settings:fetch-fields', appToken: r.appToken, tableId: r.tableId, appId, appSecret });
      if (rf && rf.success) {
        tableFields = rf.fields;
        config.tableFields = rf.fields;
        autoMap();
      }
    } catch (e) { /* 映射失败不影响建表结果 */ }

    await saveAllConfig();

    const warn = r.failed && r.failed.length
      ? `　⚠️ 有 ${r.failed.length} 个字段没建成（${r.failed.join('、')}），去表里手动补一下。`
      : '';
    if (box) {
      box.className = r.failed && r.failed.length ? 'connection-result' : 'connection-result success';
      box.innerHTML = '';
      box.textContent =
        `✅ 已建好「${r.tableName}」，${r.fieldCount}/${r.total} 个字段到位，并已自动绑定 + 完成字段映射。` + warn;
    }
    const link = DOM['itable-link'];
    if (link) { link.href = r.url; link.classList.remove('hidden'); }
    showSaveStatus('saved', '已新建表格并绑定');
    refreshWizard();
  }

  async function copyText(text, btn, okText) {
    const old = btn.textContent;
    try {
      await navigator.clipboard.writeText(text);
    } catch (e) {
      const ta = document.createElement('textarea');
      ta.value = text;
      ta.style.position = 'fixed';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.select();
      try { document.execCommand('copy'); } catch (_) {}
      ta.remove();
    }
    btn.textContent = okText;
    setTimeout(() => { btn.textContent = old; }, 1800);
  }

  function setupWizard() {
    // 第 1 步：复制权限清单
    DOM['btn-copy-perms']?.addEventListener('click', () => {
      copyText(PERM_TEXT, DOM['btn-copy-perms'], '✅ 已复制，去飞书粘贴');
    });

    // 第 2 步：保存并验证凭证
    DOM['btn-verify-cred']?.addEventListener('click', async () => {
      const box = DOM['cred-result'];
      const appId = DOM['cfg-appId'].value.trim();
      const appSecret = DOM['cfg-appSecret'].value.trim();
      box.classList.remove('hidden');
      if (!appId || !appSecret) {
        box.className = 'connection-result error';
        box.textContent = '❌ 请先填写 App ID 和 App Secret';
        return;
      }
      DOM['btn-verify-cred'].disabled = true;
      box.className = 'connection-result loading';
      box.textContent = '⏳ 正在连接飞书验证凭证...';
      await saveAllConfig(true);
      try {
        const r = await send({ type: 'settings:verify-cred', appId, appSecret });
        if (r.success) {
          box.className = 'connection-result success';
          box.textContent = `✅ ${r.message}　→ 下一步：绑定多维表格`;
        } else {
          box.className = 'connection-result error';
          box.textContent = `❌ ${r.error}`;
        }
      } catch (e) {
        box.className = 'connection-result error';
        box.textContent = `❌ ${e.message}`;
      }
      DOM['btn-verify-cred'].disabled = false;
      refreshWizard();
    });

    // 第 3 步：一键绑定（解析 → 选表 → 探测字段 → 智能映射）
    DOM['btn-quick-bind']?.addEventListener('click', async () => {
      const btn = DOM['btn-quick-bind'];
      const parsed = parseBitableUrl(DOM['cfg-bitableUrl'].value);
      if (parsed.appToken) DOM['cfg-appToken'].value = parsed.appToken;
      if (parsed.tableId) DOM['cfg-tableId'].value = parsed.tableId;
      if (!DOM['cfg-appToken'].value.trim()) {
        showConnectionStatus('error', '❌ 没识别到表格 token —— 请确认粘贴的是多维表格完整链接（含 /base/xxx）');
        return;
      }
      if (!DOM['cfg-appId'].value.trim() || !DOM['cfg-appSecret'].value.trim()) {
        showConnectionStatus('error', '❌ 请先完成第 2 步：填好 App ID 和 App Secret');
        return;
      }
      btn.disabled = true;
      showConnectionStatus('loading', '⏳ 正在读取数据表...');
      try {
        const rt = await send({
          type: 'settings:list-tables',
          appToken: DOM['cfg-appToken'].value.trim(),
          appId: DOM['cfg-appId'].value.trim(),
          appSecret: DOM['cfg-appSecret'].value.trim(),
        });
        if (!rt.success) { showConnectionStatus('error', `❌ ${rt.error}`); return; }
        config.tables = rt.tables || [];
        if (!config.tables.length) { showConnectionStatus('error', '❌ 这个多维表格里没有数据表'); return; }
        // 链接里带 table 参数就用它，否则用第一张表
        const wantId = DOM['cfg-tableId'].value.trim();
        const pick = config.tables.find(t => t.id === wantId) || config.tables[0];
        renderTableSelect(config.tables, pick.id);
        DOM['cfg-tableId'].value = pick.id;
        DOM['cfg-tableName'].value = pick.name || '';
        tableFields = [];
        config.tableFields = [];

        showConnectionStatus('loading', `⏳ 已选中「${pick.name}」，正在探测字段...`);
        const rf = await send({
          type: 'settings:fetch-fields',
          appToken: DOM['cfg-appToken'].value.trim(),
          tableId: pick.id,
          appId: DOM['cfg-appId'].value.trim(),
          appSecret: DOM['cfg-appSecret'].value.trim(),
        });
        if (!rf.success) { showConnectionStatus('error', `❌ ${rf.error}`); return; }
        tableFields = rf.fields;
        config.tableFields = rf.fields;
        renderMapping();
        autoMap();
        await saveAllConfig(true);
        showConnectionStatus('success', `✅ 绑定成功：${pick.name}（${rf.fields.length} 个字段）· 已自动完成字段映射`);
      } catch (e) {
        showConnectionStatus('error', `❌ ${e.message}`);
      }
      btn.disabled = false;
      refreshWizard();
    });

    // 体检
    DOM['btn-health-check']?.addEventListener('click', runHealthCheck);
  }

  function autoMap() {
    const rules = {
      title: ['标题', 'title', '选题标题'],
      text: ['正文', '内容', '多行文本', 'desc', 'text'],
      author: ['作者', '来源', 'author'],
      platform: ['平台', '来源平台'],
      sourceUrl: ['链接', '来源链接', 'url'],
      sourceType: ['收录方式', '选题来源', '来源类型'],
      images: ['图片', '素材', '附件'],
      tags: ['标签', 'tag', '话题'],
      publishTime: ['时间', '发布时间', '日期'],
      interactionLikes: ['点赞'],
      interactionCollects: ['收藏'],
      interactionComments: ['评论'],
    };
    config.fieldMapping = { ...(config.fieldMapping || {}) };
    for (const [key, words] of Object.entries(rules)) {
      if (config.fieldMapping[key]) continue;
      const hit = tableFields.find(f => words.some(w => String(f.name).includes(w)));
      if (hit) config.fieldMapping[key] = hit.name;
    }
    // 用表里真实字段名回填默认映射，避免指向不存在的字段
    const names = new Set(tableFields.map(f => f.name));
    for (const [k, v] of Object.entries(config.fieldMapping)) {
      if (v && !names.has(v)) delete config.fieldMapping[k];
    }
    renderMapping();
  }

  // ====== 一键体检 ======
  async function runHealthCheck() {
    const box = DOM['health-list'];
    const btn = DOM['btn-health-check'];
    btn.disabled = true;
    box.innerHTML = '<div class="health-item warn"><span class="h-icon">⏳</span><div>正在逐项检查...</div></div>';
    const items = [];
    const add = (level, text, fix) => items.push({ level, text, fix });

    const appId = DOM['cfg-appId'].value.trim();
    const appSecret = DOM['cfg-appSecret'].value.trim();
    const appToken = DOM['cfg-appToken'].value.trim();
    const tableId = DOM['cfg-tableId'].value.trim();

    // 1 凭证
    if (appId && appSecret) add('ok', '凭证已填写');
    else add('fail', '凭证未填全', '回第 2 步填写 App ID 和 App Secret');

    // 2 凭证有效性
    if (appId && appSecret) {
      try {
        const r = await send({ type: 'settings:verify-cred', appId, appSecret });
        if (r.success) add('ok', '凭证有效（飞书已接受）');
        else add('fail', '凭证无效', r.error);
      } catch (e) { add('fail', '凭证验证失败', e.message); }
    }

    // 3 表格
    if (appToken && tableId) add('ok', '已绑定数据表');
    else add('fail', '未绑定数据表', '回第 3 步粘贴多维表格链接并点「一键绑定」');

    // 4 表格可读写 + 权限
    if (appToken && tableId && appId && appSecret) {
      try {
        const rf = await send({ type: 'settings:fetch-fields', appToken, tableId, appId, appSecret });
        if (rf.success) {
          tableFields = rf.fields; config.tableFields = rf.fields;
          add('ok', `表格可访问，读到 ${rf.fields.length} 个字段`);
        } else {
          const e = String(rf.error || '');
          if (/权限|permission|Forbidden|403/i.test(e)) {
            add('fail', '权限不足', '你的飞书应用开了权限但可能没发布版本。去开放平台「版本管理与发布」创建版本并发布；也可能是该表格没把应用加为协作者');
          } else {
            add('fail', '读取表格失败', e);
          }
        }
      } catch (e) { add('fail', '读取表格失败', e.message); }
    }

    // 5 字段映射
    const fm = config.fieldMapping || {};
    const missing = CAPTURE_FIELDS.filter(f => !fm[f.key]).map(f => f.label);
    if (!missing.length) add('ok', '字段映射完整（12/12）');
    else if (missing.length <= 4) add('warn', `有 ${missing.length} 个字段没映射：${missing.join('、')}`, '去「🔗 字段映射」补上，或用「智能自动匹配」');
    else add('warn', `${missing.length} 个字段没映射`, '去「🔗 字段映射」点「🪄 智能自动匹配」');

    // 6 单选选项预检（防 1254062）
    if (tableFields.length) {
      const problems = [];
      const optionalLack = [];
      for (const [fname, need] of Object.entries(REQUIRED_OPTIONS)) {
        const f = tableFields.find(x => x.name === fname);
        if (!f) continue;                      // 没这个字段就不管（用户可能用了别的名字）
        if (f.type !== 3) { problems.push(`「${fname}」不是单选字段（现在是 ${f.typeName}）`); continue; }
        const have = f.options || [];
        const lack = need.filter(o => !have.includes(o));
        if (lack.length) problems.push(`「${fname}」缺少选项：${lack.join('、')}`);
      }
      for (const [fname, need] of Object.entries(OPTIONAL_OPTIONS)) {
        const f = tableFields.find(x => x.name === fname);
        if (!f || f.type !== 3) continue;
        const have = f.options || [];
        const lack = need.filter(o => !have.includes(o));
        if (lack.length) optionalLack.push(`${fname}（${lack.join('、')}）`);
      }
      if (!problems.length) add('ok', '单选字段选项齐全，不会触发 1254062');
      else add('fail', '单选字段选项缺失，写入会报 1254062', problems.join('；'));
      if (optionalLack.length) {
        add('warn', `可选选项未建：${optionalLack.join('；')}`,
            '不影响使用。只有当你需要收 YouTube 页面时，才要给对应字段补上这些选项');
      }
    }

    box.innerHTML = items.map(it => `
      <div class="health-item ${it.level}">
        <span class="h-icon">${it.level === 'ok' ? '✅' : it.level === 'warn' ? '⚠️' : '❌'}</span>
        <div>${esc(it.text)}${it.fix ? `<span class="h-fix">👉 ${esc(it.fix)}</span>` : ''}</div>
      </div>`).join('');
    btn.disabled = false;
  }

  // ====== 版本与更新 ======
  function setupUpdateUI() {
    if (DOM['cur-version']) {
      DOM['cur-version'].textContent = 'v' + (chrome.runtime.getManifest().version || '');
    }
    DOM['btn-check-update']?.addEventListener('click', async () => {
      const btn = DOM['btn-check-update'];
      const detail = DOM['update-detail'];
      btn.disabled = true;
      detail.classList.remove('hidden');
      detail.className = 'connection-result loading';
      detail.textContent = '⏳ 正在检查...';
      try {
        const r = await send({ type: 'update:check' });
        const up = r?.update || {};
        if (up.hu) {
          DOM['update-box'].classList.add('has-new');
          detail.className = 'connection-result error';
          detail.innerHTML = `🆕 有新版本 <strong>v${esc(up.lv)}</strong>（你当前 v${esc(up.cv)}）。
            去 GitHub 下载新包，解压后覆盖原来的插件文件夹，再到 chrome://extensions/ 点本插件的「刷新 ↻」。`;
        } else {
          DOM['update-box'].classList.remove('has-new');
          detail.className = 'connection-result success';
          detail.textContent = `✅ 已是最新版本 v${up.cv || chrome.runtime.getManifest().version}`;
        }
      } catch (e) {
        detail.className = 'connection-result error';
        detail.textContent = `❌ 检查失败：${e.message}`;
      }
      btn.disabled = false;
    });
  }

  // ====== 建表提示词 Tab ======
  async function setupPromptTab() {
    const box = DOM['prompt-text'];
    const btn = DOM['btn-copy-prompt'];
    const status = DOM['copy-status'];

    // 从包内 setup-prompt.txt 读取提示词全文（不写死在 HTML 里，方便以后替换）
    try {
      const res = await fetch(chrome.runtime.getURL('setup-prompt.txt'));
      box.textContent = await res.text();
    } catch(e) {
      box.textContent = '提示词文件读取失败，请确认扩展目录下存在 setup-prompt.txt。';
      console.error('setupPromptTab:', e);
    }

    btn.addEventListener('click', async () => {
      const text = box.textContent || '';
      try {
        await navigator.clipboard.writeText(text);
        status.textContent = '✅ 已复制，去粘给 AI 吧';
      } catch (e) {
        // 剪贴板 API 不可用时的兜底方案
        try {
          const ta = document.createElement('textarea');
          ta.value = text;
          ta.style.position = 'fixed';
          ta.style.opacity = '0';
          document.body.appendChild(ta);
          ta.select();
          document.execCommand('copy');
          document.body.removeChild(ta);
          status.textContent = '✅ 已复制，去粘给 AI 吧';
        } catch (e2) {
          status.textContent = '⚠️ 复制失败，请手动选中下方文本复制';
        }
      }
      setTimeout(() => { status.textContent = ''; }, 3000);
    });
  }

  async function saveAllConfig() {
    DOM['btn-save-all'].disabled = true;
    try {
      // 收集飞书凭证
      config.appId = DOM['cfg-appId'].value.trim();
      config.appSecret = DOM['cfg-appSecret'].value.trim();
      config.bitableUrl = DOM['cfg-bitableUrl'].value.trim();
      const parsed = parseBitableUrl(config.bitableUrl);
      if (parsed.appToken) DOM['cfg-appToken'].value = parsed.appToken;
      if (parsed.tableId && !DOM['cfg-tableId'].value.trim()) DOM['cfg-tableId'].value = parsed.tableId;
      config.appToken = DOM['cfg-appToken'].value.trim();
      config.tableId = DOM['cfg-tableId'].value.trim();
      config.tableName = DOM['cfg-tableName'].value.trim();

      // 收集功能开关
      config.features = {
        apiIntercept: DOM['cfg-apiIntercept'].checked,
        domParse: DOM['cfg-domParse'].checked,
        imageUpload: DOM['cfg-imageUpload'].checked,
        maxImages: parseInt(DOM['cfg-maxImages'].value) || 9,
      };

      // 收集采集间隔
      config.collectIntervalMs = parseInt(DOM['cfg-collectInterval'].value) || 2500;

      // 收集字段映射
      const fm = {};
      document.querySelectorAll('[data-map-key]').forEach(select => {
        const key = select.dataset.mapKey;
        const val = select.value.trim();
        if (val) fm[key] = val;
      });
      config.fieldMapping = { ...CAPTURE_FIELDS.reduce((acc, cf) => ({ ...acc, [cf.key]: '' }), {}), ...fm };

      // 收集默认值
      const defs = {};
      document.querySelectorAll('#defaults-list .default-item').forEach(item => {
        const key = item.querySelector('.field-key').value.trim();
        const val = item.querySelector('.field-value').value.trim();
        if (key) defs[key] = val;
      });
      config.defaults = defs;

      // 保存表格字段列表
      config.tableFields = tableFields;

      // 发送保存
      const r = await send({ type: 'settings:save-config', config });
      if (r.success) {
        showSaveStatus('saved', '✅ 配置已保存');
        // 通知 sidepanel 更新
        chrome.runtime.sendMessage({ type: 'settings:updated' }).catch(() => {});
      } else {
        showSaveStatus('error', `❌ ${r.error}`);
      }
    } catch(e) {
      showSaveStatus('error', `❌ ${e.message}`);
    }
    DOM['btn-save-all'].disabled = false;
  }

  function showConnectionStatus(type, msg) {
    const el = DOM['connection-result'];
    el.textContent = msg;
    el.className = `connection-result ${type}`;
    el.classList.remove('hidden');
  }

  function showSaveStatus(type, msg) {
    const el = DOM['save-status'];
    el.textContent = msg;
    el.className = `save-status ${type}`;
    setTimeout(() => { el.className = 'save-status'; el.textContent = '就绪'; }, 3000);
  }

  function send(p) {
    return new Promise((resolve) => {
      chrome.runtime.sendMessage(p, (res) => resolve(res || {}));
    });
  }

  function escHtml(s) {
    const d = new Option(s); return d.innerHTML;
  }
  function escAttr(s) {
    return String(s).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }
})();
