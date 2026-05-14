// 前程智囊团 v4.0 — 设置页脚本
(() => {
  let config = null;

  // 采集数据的字段定义（供映射使用）
  const CAPTURE_FIELDS = [
    { key: 'title', label: '笔记标题', desc: 'apiData.title || pageInfo.title' },
    { key: 'text', label: '正文内容', desc: 'apiData.desc || DOM正文' },
    { key: 'author', label: '作者/来源', desc: 'apiData.author.nickname || DOM作者' },
    { key: 'platform', label: '来源平台', desc: '小红书 / YouTube / 网页' },
    { key: 'sourceUrl', label: '来源链接', desc: '笔记URL（超链接字段）' },
    { key: 'sourceType', label: '采集方式', desc: '浏览器采集 / 链接采集 / 批量采集' },
    { key: 'images', label: '素材图片', desc: '笔记图片（附件字段）' },
    { key: 'tags', label: '标签', desc: '话题标签（逗号分隔）' },
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
  }

  function bindElements() {
    const ids = [
      'cfg-appId','cfg-appSecret','cfg-bitableUrl','cfg-appToken','cfg-tableId','cfg-tableSelect','cfg-tableName',
      'cfg-apiIntercept','cfg-domParse','cfg-imageUpload',
      'cfg-maxImages','cfg-collectInterval',
      'btn-toggle-secret','btn-fetch-fields','btn-test-connection',
      'btn-auto-map','btn-add-default','btn-reset-config',
      'btn-export-config','btn-import-config','btn-save-all',
      'connection-result','save-status','mapping-list','defaults-list',
      'import-file','version-tag','about-version',
    ];
    ids.forEach(id => { DOM[id] = document.getElementById(id); });
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
        interactionLikes: ['点赞数', '点赞', 'likes', 'like'],
        interactionCollects: ['收藏数', '收藏', 'collects', 'collect'],
        interactionComments: ['评论数', '评论', 'comments', 'comment'],
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
      a.download = 'xhs-collector-config.json';
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
      btn.addEventListener('click', () => {
        document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        const tabId = btn.dataset.tab;
        document.querySelectorAll('.tab-content').forEach(el => el.classList.remove('active'));
        document.getElementById(`tab-${tabId}`).classList.add('active');
      });
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
