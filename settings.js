// 前程-灵感素材库 v4.1 — 设置页脚本
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
    setupPromptTab();
    setupWizard();
    setupUpdateUI();
    refreshWizard();
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
              <option value="" style="color:#868e96;">-- 不映射 --</option>
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
    `).join('') || '<div style="color:#868e96;font-size:12px;padding:8px 0;">暂无默认值</div>';
  }

  function getMappedDataKey(fieldName) {
    // 反向查找: 表格字段名 → 采集数据 key
    const fm = config.fieldMapping || {};
    for (const [key, val] of Object.entries(fm)) {
      if (val === fieldName) return key;
    }
    return '';
  }

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
  const PERM_TEXT = `请在飞书开放平台为你的应用开通以下权限（左侧「权限管理」里搜索关键词开通）：

1. 多维表格 — 查看
2. 多维表格 — 查看、评论、编辑和管理
3. 云空间 — 查看、评论、编辑和管理云空间中所有文件

⚠️ 开完权限后，必须去「版本管理与发布」创建一个版本并发布，权限才会真正生效。
   不发布版本 = 接口一直返回「权限不足」，这是最常见的坑。`;

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
    mark('ws-1', 'done');
    mark('ws-2', hasCred ? 'done' : 'active');
    mark('ws-3', hasTable ? 'done' : (hasCred ? 'active' : ''));
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
