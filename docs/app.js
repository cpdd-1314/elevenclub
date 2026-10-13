/* 十一愿俱乐部 Web 版
 * 业务逻辑与原小程序版一致：小票识别、陪陪分配、工资结算。
 * 数据层：
 *   - 已配置 Supabase（docs/config.js）：云端存储 + Realtime 实时同步，
 *     任何设备录入，其他设备秒级自动更新
 *   - 未配置：自动降级为浏览器 localStorage（仅当前浏览器可用）
 */
(function () {
  'use strict';

  /* ================= 纯业务逻辑（与原小程序版一致） ================= */

  function makeId() {
    return Date.now().toString() + Math.random().toString(36).slice(2, 8);
  }

  function money(value) {
    return (Math.round(value * 100) / 100).toFixed(2);
  }

  function currentMonth() {
    var d = new Date();
    return d.getFullYear() + '-' +
      String(d.getMonth() + 1).padStart(2, '0');
  }

  function getField(text, name) {
    var lines = text.split(/\r?\n/);

    for (var i = 0; i < lines.length; i++) {
      var line = lines[i].trim();
      var re = new RegExp(
        '^(?:💫|🪐)?\\s*' + name + '\\s*[:：]\\s*(.*)$'
      );
      var match = line.match(re);

      if (match) return match[1].trim();
    }

    return '';
  }

  function getNumberField(text, name) {
    var value = getField(text, name).replace(/[￥¥元,\s，]/g, '');

    if (!value || !/^\d+(\.\d+)?$/.test(value)) {
      return null;
    }

    return Number(value);
  }

  function parseDate(value) {
    var year = new Date().getFullYear();
    var match = value.match(
      /^(\d{4})[-/.年](\d{1,2})[-/.月](\d{1,2})日?$/
    );

    if (match) {
      return match[1] + '-' +
        match[2].padStart(2, '0') + '-' +
        match[3].padStart(2, '0');
    }

    match = value.match(/^(\d{1,2})[-/.月](\d{1,2})日?$/);

    if (match) {
      return year + '-' +
        match[1].padStart(2, '0') + '-' +
        match[2].padStart(2, '0');
    }

    return '';
  }

  function parseCompanions(value) {
    var parts = value.split(/[\s、,，;；|]+/);
    var names = [];

    parts.forEach(function (part) {
      var name = part.trim();

      if (name && names.indexOf(name) === -1) {
        names.push(name);
      }
    });

    return names;
  }

  function splitAmount(names, total) {
    if (names.length === 0) return [];

    var cents = Math.round(total * 100);
    var base = Math.floor(cents / names.length);
    var remainder = cents % names.length;

    return names.map(function (name, index) {
      var assignedCents = base + (index < remainder ? 1 : 0);

      return {
        staffName: name,
        amount: assignedCents / 100
      };
    });
  }

  /* 订单指纹：与 parseReceipt 保持一致，快捷录单复用同一算法以保证查重有效 */
  function buildFingerprint(date, boss, companions, project, gift, unitPrice, quantity, amount, stageManager) {
    return [
      date,
      boss,
      companions.slice().sort().join(','),
      project,
      gift,
      money(unitPrice),
      String(quantity),
      money(amount),
      stageManager
    ].join('|');
  }

  function parseReceipt(text) {
    var boss = getField(text, '老板');
    var companions = parseCompanions(getField(text, '陪陪'));
    var project = getField(text, '项目');
    var gift = getField(text, '礼物');
    var unitPrice = getNumberField(text, '金额');
    var quantity = getNumberField(text, '数量');
    var printedTotal = getNumberField(text, '总额');
    var stageManager = getField(text, '场控');
    var date = parseDate(getField(text, '日期'));

    var warnings = [];
    var amount = 0;

    if (printedTotal !== null) {
      amount = printedTotal;
    } else if (unitPrice !== null && quantity !== null) {
      amount = Math.round(unitPrice * quantity * 100) / 100;
      warnings.push('没有识别到总额，已按单价乘数量计算');
    } else {
      warnings.push('无法识别订单总额');
    }

    if (!boss) warnings.push('缺少老板');
    if (companions.length === 0) warnings.push('缺少陪陪名单');
    if (!project) warnings.push('缺少项目');
    if (unitPrice === null) warnings.push('无法识别金额');
    if (quantity === null) warnings.push('无法识别数量');
    if (!date) warnings.push('无法识别日期');

    var mismatch =
      printedTotal !== null &&
      unitPrice !== null &&
      quantity !== null &&
      Math.abs(printedTotal - unitPrice * quantity) > 0.011;

    if (mismatch) {
      warnings.push('总额与金额乘数量不一致，请核对');
    }

    var fingerprint = buildFingerprint(
      date, boss, companions, project, gift,
      unitPrice === null ? 0 : unitPrice,
      quantity === null ? 0 : quantity,
      amount, stageManager
    );

    var valid =
      !!boss &&
      companions.length > 0 &&
      !!project &&
      unitPrice !== null &&
      quantity !== null &&
      !!date &&
      printedTotal !== null &&
      !mismatch;

    return {
      id: makeId(),
      fingerprint: fingerprint,
      date: date,
      boss: boss,
      companions: companions,
      project: project,
      gift: gift,
      unitPrice: unitPrice === null ? 0 : unitPrice,
      quantity: quantity === null ? 0 : quantity,
      amount: amount,
      stageManager: stageManager,
      allocations: splitAmount(companions, amount),
      valid: valid,
      warning: warnings.join('；')
    };
  }

  function computePayroll(staff, orders, month) {
    var m = month || currentMonth();

    var monthOrders = orders.filter(function (order) {
      return order.date.indexOf(m) === 0;
    });

    var orderCents = 0;

    monthOrders.forEach(function (order) {
      orderCents += Math.round(order.amount * 100);
    });

    var allocationCents = 0;
    var commissionCents = 0;
    var payableCents = 0;

    var rows = staff.map(function (person) {
      var allocated = 0;
      var count = 0;

      monthOrders.forEach(function (order) {
        order.allocations.forEach(function (allocation) {
          if (allocation.staffName === person.name) {
            allocated += Math.round(allocation.amount * 100);
            count++;
          }
        });
      });

      var commission = Math.round(allocated * person.rate / 100);
      var allowance = count > 0 ?
        Math.round(person.allowance * 100) : 0;
      var deduction = count > 0 ?
        Math.round(person.deduction * 100) : 0;
      var payable = commission + allowance - deduction;

      allocationCents += allocated;
      commissionCents += commission;
      payableCents += payable;

      return {
        id: person.id,
        name: person.name,
        orderCount: count,
        allocatedText: money(allocated / 100),
        commissionText: money(commission / 100),
        allowanceText: money(allowance / 100),
        deductionText: money(deduction / 100),
        payableText: money(payable / 100)
      };
    });

    return {
      rows: rows,
      orderTotal: money(orderCents / 100),
      allocationTotal: money(allocationCents / 100),
      commissionTotal: money(commissionCents / 100),
      payableTotal: money(payableCents / 100)
    };
  }

  /* ================= 状态 ================= */

  var STAFF_KEY = 'clubPayrollStaff_v1';
  var ORDER_KEY = 'clubPayrollOrders_v2';
  var PRESETS_KEY = 'clubPayrollPresets_v1';
  var MODE_KEY = 'clubPayrollMode_v1';

  var DEFAULT_PRESETS = { projects: [], bosses: [], stageManagers: [], gifts: [] };

  var state = {
    tab: 'orders',
    mode: 'paste', // paste=粘贴识别 quick=快捷录单
    batchText: '',
    previewOrders: [],
    previewMessage: '',
    staff: [],
    orders: [],
    month: currentMonth(),
    presets: { projects: [], bosses: [], stageManagers: [], gifts: [] }
  };

  /* 快捷录单表单状态 */
  var quickForm = {
    date: today(),
    boss: '',
    project: '',
    staffNames: [],
    stageManager: '',
    gift: '',
    unitPrice: '',
    quantity: '1',
    amount: '',
    amountTouched: false
  };

  function today() {
    var d = new Date();
    return d.getFullYear() + '-' +
      String(d.getMonth() + 1).padStart(2, '0') + '-' +
      String(d.getDate()).padStart(2, '0');
  }

  /* ================= 云端（Supabase）数据层 ================= */

  var cloud = {
    enabled: false,
    client: null,
    lastWriteAt: 0,
    channel: null
  };

  function isSupabaseConfigured() {
    return typeof SUPABASE_CONFIG !== 'undefined' &&
      SUPABASE_CONFIG.supabaseUrl &&
      SUPABASE_CONFIG.supabaseAnonKey &&
      SUPABASE_CONFIG.supabaseUrl.indexOf('YOUR-PROJECT') === -1 &&
      SUPABASE_CONFIG.supabaseAnonKey.indexOf('YOUR-ANON-KEY') === -1;
  }

  function loadScript(src) {
    return new Promise(function (resolve, reject) {
      var s = document.createElement('script');
      s.src = src;
      s.onload = resolve;
      s.onerror = function () { reject(new Error('SDK 加载失败')); };
      document.head.appendChild(s);
    });
  }

  function setSyncStatus(text, online) {
    var el = document.getElementById('syncStatus');
    if (!el) return;
    el.textContent = text;
    el.classList.toggle('online', !!online);
  }

  function initCloud() {
    if (!isSupabaseConfigured()) {
      setSyncStatus('本地模式', false);
      return Promise.resolve(false);
    }

    return loadScript('https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2')
      .then(function () {
        cloud.client = window.supabase.createClient(
          SUPABASE_CONFIG.supabaseUrl,
          SUPABASE_CONFIG.supabaseAnonKey
        );
        cloud.enabled = true;
        setSyncStatus('云端实时同步', true);
        subscribeRealtime();
        return true;
      })
      .catch(function (e) {
        showToast('云端连接失败，已切换本地模式');
        setSyncStatus('本地模式', false);
        return false;
      });
  }

  /* 订阅其他设备的数据变更：一端写入，其他设备秒级刷新 */
  function subscribeRealtime() {
    cloud.channel = cloud.client
      .channel('club-state-changes')
      .on('postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'club_state',
          filter: 'id=eq.main'
        },
        function (payload) {
          var row = payload && payload.new;
          if (!row) return;

          var remoteAt = new Date(row.updated_at).getTime();
          if (remoteAt <= cloud.lastWriteAt) return; // 自己刚写入的回显，忽略

          cloud.lastWriteAt = remoteAt;
          state.staff = row.staff || [];
          state.orders = row.orders || [];
          if (row.presets) {
            state.presets = Object.assign(
              { projects: [], bosses: [], stageManagers: [], gifts: [] },
              row.presets
            );
          }

          renderAll();
          renderQuickPanel();
          showToast('已同步其他设备的新数据');
        })
      .subscribe();
  }

  /* ================= 本地存储（降级模式） ================= */

  function readStore(key) {
    try {
      var raw = localStorage.getItem(key);
      return raw ? JSON.parse(raw) : [];
    } catch (e) {
      showToast('读取数据失败');
      return [];
    }
  }

  function writeStore(key, value) {
    try {
      localStorage.setItem(key, JSON.stringify(value));
      return true;
    } catch (e) {
      showToast('保存失败');
      return false;
    }
  }

  /* ================= 数据读写（统一入口） ================= */

  function loadAll() {
    if (cloud.enabled) {
      return cloud.client
        .from('club_state')
        .select('staff, orders, presets, updated_at')
        .eq('id', 'main')
        .single()
        .then(function (res) {
          if (res.error) {
            if (res.error.code === 'PGRST116') return; // 行不存在，保持空数据
            throw res.error;
          }
          if (res.data) {
            state.staff = res.data.staff || [];
            state.orders = res.data.orders || [];
            if (res.data.presets) {
              state.presets = Object.assign(
                { projects: [], bosses: [], stageManagers: [], gifts: [] },
                res.data.presets
              );
            }
            cloud.lastWriteAt = new Date(res.data.updated_at).getTime();
          }
        })
        .catch(function (e) {
          showToast('云端读取失败：' + (e.message || e));
        });
    }

    state.staff = readStore(STAFF_KEY);
    state.orders = readStore(ORDER_KEY);

    var savedPresets = readStore(PRESETS_KEY);
    if (savedPresets && !Array.isArray(savedPresets)) {
      state.presets = Object.assign({}, DEFAULT_PRESETS, savedPresets);
    }
    return Promise.resolve();
  }

  /* 返回 Promise<boolean>：是否保存成功 */
  function saveAll(staff, orders, presets) {
    state.staff = staff;
    state.orders = orders;
    if (presets) state.presets = presets;
    renderAll();

    if (cloud.enabled) {
      return cloud.client
        .from('club_state')
        .upsert({
          id: 'main',
          staff: staff,
          orders: orders,
          presets: state.presets
        })
        .select('updated_at')
        .single()
        .then(function (res) {
          if (res.error) {
            showToast('云端保存失败：' + res.error.message);
            return false;
          }
          cloud.lastWriteAt = new Date(res.data.updated_at).getTime();
          return true;
        })
        .catch(function (e) {
          showToast('云端保存失败：' + (e.message || e));
          return false;
        });
    }

    if (!writeStore(STAFF_KEY, staff)) return Promise.resolve(false);
    if (!writeStore(ORDER_KEY, orders)) return Promise.resolve(false);
    writeStore(PRESETS_KEY, state.presets);
    return Promise.resolve(true);
  }

  /* ================= UI 基础：轻提示 / 模态框 ================= */

  var toastTimer = null;

  function showToast(title) {
    var el = document.getElementById('toast');
    el.textContent = title;
    el.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () {
      el.hidden = true;
    }, 2000);
  }

  function showModal(options) {
    return new Promise(function (resolve) {
      var mask = document.getElementById('modalMask');
      var titleEl = document.getElementById('modalTitle');
      var contentEl = document.getElementById('modalContent');
      var cancelBtn = document.getElementById('modalCancel');
      var confirmBtn = document.getElementById('modalConfirm');

      titleEl.textContent = options.title || '';
      contentEl.textContent = options.content || '';
      confirmBtn.textContent = options.confirmText || '确定';

      if (options.showCancel === false) {
        cancelBtn.hidden = true;
      } else {
        cancelBtn.hidden = false;
        cancelBtn.textContent = options.cancelText || '取消';
      }

      mask.hidden = false;

      function cleanup(confirmed) {
        mask.hidden = true;
        confirmBtn.removeEventListener('click', onConfirm);
        cancelBtn.removeEventListener('click', onCancel);
        mask.removeEventListener('click', onMask);
        resolve({ confirm: confirmed });
      }

      function onConfirm() { cleanup(true); }
      function onCancel() { cleanup(false); }
      function onMask(e) { if (e.target === mask) cleanup(false); }

      confirmBtn.addEventListener('click', onConfirm);
      cancelBtn.addEventListener('click', onCancel);
      mask.addEventListener('click', onMask);
    });
  }

  /* ================= 渲染 ================= */

  function escapeHtml(value) {
    return String(value == null ? '' : value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function $(id) {
    return document.getElementById(id);
  }

  function renderAll() {
    renderOrdersPanel();
    renderStaffPanel();
    renderPayrollPanel();
  }

  function switchTab(tab) {
    state.tab = tab;

    var tabs = document.querySelectorAll('.tab');
    tabs.forEach(function (btn) {
      btn.classList.toggle('active', btn.dataset.tab === tab);
    });

    $('panel-orders').hidden = tab !== 'orders';
    $('panel-staff').hidden = tab !== 'staff';
    $('panel-payroll').hidden = tab !== 'payroll';

    if (tab === 'payroll') {
      renderPayrollPanel();
    }
    if (tab === 'orders') {
      applyMode();
    }
  }

  /* 录单方式切换：粘贴小票 / 快捷录单（记住上次选择） */
  function switchMode(mode) {
    state.mode = mode;
    try { localStorage.setItem(MODE_KEY, mode); } catch (e) {}
    applyMode();
  }

  function applyMode() {
    var isQuick = state.mode === 'quick';

    document.querySelectorAll('.mode-btn').forEach(function (btn) {
      btn.classList.toggle('active', btn.dataset.mode === state.mode);
    });

    $('mode-paste').hidden = isQuick;
    $('mode-quick').hidden = !isQuick;

    // 离开快捷模式时收起选项选择器
    if (!isQuick && selectPicker.group) closeSelectPicker();
    if (!isQuick && selectPicker.multi) closeSelectPicker();

    if (isQuick) {
      renderQuickPanel();
    }
  }

  /* ================= 快捷录单 ================= */

  var PRESET_GROUPS = [
    { key: 'bosses', label: '老板', field: 'boss' },
    { key: 'projects', label: '项目', field: 'project' },
    { key: 'stageManagers', label: '场控', field: 'stageManager' },
    { key: 'gifts', label: '礼物', field: 'gift' }
  ];

  /* 更新一组选择按钮的显示文本 */
  function renderSelectField(group) {
    var el = $(group.field + 'SelectText');
    var value = quickForm[group.field];
    el.textContent = value || '请选择' + group.label;
    el.classList.toggle('placeholder', !value);
  }

  function renderStaffSelect() {
    var el = $('staffSelectText');
    var names = quickForm.staffNames;
    if (names.length === 0) {
      el.textContent = '请选择陪陪';
      el.classList.add('placeholder');
    } else if (names.length <= 2) {
      el.textContent = names.join('、');
      el.classList.remove('placeholder');
    } else {
      el.textContent = names.slice(0, 2).join('、') + ' 等 ' + names.length + ' 人';
      el.classList.remove('placeholder');
    }
  }

  function renderQuickPanel() {
    // 表单回填（不覆盖用户正在输入的内容由 input 事件保证）
    $('qDate').value = quickForm.date;
    $('qUnitPrice').value = quickForm.unitPrice;
    $('qQuantity').value = quickForm.quantity;
    $('qAmount').value = quickForm.amount;

    PRESET_GROUPS.forEach(renderSelectField);
    renderStaffSelect();

    renderQuickPreview();
  }

  /* 实时预览将生成的订单与分配 */
  function renderQuickPreview() {
    var box = $('qPreview');
    var unitPrice = Number(quickForm.unitPrice);
    var quantity = Number(quickForm.quantity);
    var amount = Number(quickForm.amount);

    if (!quickForm.boss || quickForm.staffNames.length === 0) {
      box.innerHTML = '<div class="hint">选择老板和陪陪后，这里会显示分配预览。</div>';
      return;
    }

    var total = Number.isFinite(amount) && amount > 0 ? amount :
      (Number.isFinite(unitPrice) && Number.isFinite(quantity) ? unitPrice * quantity : 0);

    if (!(total > 0)) {
      box.innerHTML = '<div class="hint">填写单价和数量后显示分配预览。</div>';
      return;
    }

    var allocations = splitAmount(quickForm.staffNames, total);
    var html = '<div class="quick-preview-title">将生成订单 · ' +
      escapeHtml(quickForm.boss) + ' · ' + escapeHtml(quickForm.project || '未填项目') +
      ' · ' + quickForm.staffNames.length + ' 人 · 总额 ¥' + money(total) + '</div>';
    allocations.forEach(function (a) {
      html += '<div class="allocation-line"><span>' + escapeHtml(a.staffName) +
        '</span><span>¥' + escapeHtml(money(a.amount)) + '</span></div>';
    });
    box.innerHTML = html;
  }

  /* 批量添加预设（去重，最多保留 30 个，一次保存） */
  function quickAddPresets(groupKey, values) {
    var existing = state.presets[groupKey] || [];
    var additions = [];
    values.forEach(function (raw) {
      var v = (raw || '').trim();
      if (!v) return;
      if (existing.indexOf(v) !== -1) return;
      if (additions.indexOf(v) !== -1) return;
      additions.push(v);
    });
    if (additions.length === 0) return Promise.resolve(false);

    var list = additions.concat(existing);
    if (list.length > 30) list = list.slice(0, 30);
    state.presets[groupKey] = list;

    return saveAll(state.staff, state.orders, state.presets).then(function () {
      renderQuickPanel();
      return true;
    });
  }

  function quickRemovePreset(groupKey, value) {
    var list = (state.presets[groupKey] || []).filter(function (item) {
      return item !== value;
    });
    state.presets[groupKey] = list;

    return saveAll(state.staff, state.orders, state.presets).then(function () {
      renderQuickPanel();
    });
  }

  /* ================= 选项选择器：按一下弹出全部，点一下选中 ================= */

  var selectPicker = { group: null, multi: false };

  /* 从历史订单收集某组的候选值：去重、去空，已是预设的标记出来 */
  function collectCandidates(groupKey) {
    var group = PRESET_GROUPS.filter(function (g) { return g.key === groupKey; })[0];
    if (!group) return [];

    var seen = {};
    var list = [];
    state.orders.forEach(function (order) {
      var value = (order[group.field] || '').trim();
      if (!value || seen[value]) return;
      seen[value] = true;
      list.push(value);
    });

    var presets = state.presets[groupKey] || [];
    return list.map(function (value) {
      return { value: value, added: presets.indexOf(value) !== -1 };
    });
  }

  function openSelectPicker(groupKey) {
    var group = PRESET_GROUPS.filter(function (g) { return g.key === groupKey; })[0];
    if (!group) return;

    selectPicker.group = group;
    selectPicker.multi = false;
    $('selectPickerTitle').textContent = '选择' + group.label;
    $('selectPickerDone').hidden = true;
    $('selectPickerInput').value = '';
    renderSelectPicker();
    $('selectPicker').hidden = false;
  }

  function openStaffPicker() {
    selectPicker.group = null;
    selectPicker.multi = true;
    $('selectPickerTitle').textContent = '选择陪陪';
    $('selectPickerInput').value = '';
    renderSelectPicker();
    updateStaffDoneText();
    $('selectPicker').hidden = false;
  }

  function closeSelectPicker() {
    $('selectPicker').hidden = true;
    selectPicker.group = null;
    selectPicker.multi = false;
  }

  function updateStaffDoneText() {
    $('selectPickerDone').textContent = '完成（已选 ' + quickForm.staffNames.length + ' 人）';
  }

  /* 一行选项：✓ 表示已选，＋ 表示来自历史待添加，× 删除预设 */
  function selectRowHtml(value, opts) {
    opts = opts || {};
    var cls = 'select-row';
    if (opts.active) cls += ' active';
    if (opts.add) cls += ' add-row';

    var mark = opts.add ? '＋' : '✓';
    var html = '<div class="' + cls + '" data-value="' + escapeHtml(value) + '">' +
      '<span class="select-row-mark">' + mark + '</span>' +
      '<span class="select-row-text">' + escapeHtml(value) + '</span>';
    if (opts.deletable) {
      html += '<button type="button" class="select-row-del" data-value="' +
        escapeHtml(value) + '" title="删除这个预设">×</button>';
    }
    return html + '</div>';
  }

  function renderSelectPicker() {
    var html = '';
    var manual = $('selectPickerList').parentElement.querySelector('.picker-manual');
    var doneBtn = $('selectPickerDone');

    if (selectPicker.multi) {
      // 陪陪多选
      manual.hidden = true;
      if (state.staff.length === 0) {
        html = '<div class="picker-empty">还没有陪陪，请先到「员工管理」页添加。</div>';
        doneBtn.hidden = true;
      } else {
        doneBtn.hidden = false;
        html = '<div class="picker-tip">点一下选择，可多选，选完点「完成」：</div>' +
          state.staff.map(function (person) {
            var active = quickForm.staffNames.indexOf(person.name) !== -1;
            return '<div class="select-row' + (active ? ' active' : '') +
              '" data-staff="' + escapeHtml(person.name) + '">' +
              '<span class="select-row-mark">✓</span>' +
              '<span class="select-row-text">' + escapeHtml(person.name) + '</span></div>';
          }).join('');
      }
    } else {
      manual.hidden = false;
      doneBtn.hidden = true;

      var group = selectPicker.group;
      if (!group) return;
      var presets = state.presets[group.key] || [];

      if (presets.length > 0) {
        html += '<div class="picker-tip">点一下选择：</div>' + presets.map(function (value) {
          return selectRowHtml(value, {
            active: quickForm[group.field] === value,
            deletable: true
          });
        }).join('');
      }

      // 历史订单里出现过、但还没加为预设的值
      var candidates = collectCandidates(group.key).filter(function (c) {
        return !c.added;
      });
      if (candidates.length > 0) {
        html += '<div class="picker-subtitle">从历史订单添加</div>' +
          candidates.map(function (c) {
            return selectRowHtml(c.value, { add: true });
          }).join('');
      }

      if (presets.length === 0 && candidates.length === 0) {
        html = '<div class="picker-empty">还没有' + escapeHtml(group.label) +
          '可选，在下方手动输入，添加后这里就能直接选。</div>';
      }
    }

    $('selectPickerList').innerHTML = html;
  }

  /* 单选组：选中某项 */
  function selectPresetValue(value) {
    var group = selectPicker.group;
    if (!group) return;
    quickForm[group.field] = value;
    renderQuickPanel();
    closeSelectPicker();
  }

  /* 历史候选：先添加为预设，再选中 */
  function selectCandidateValue(value) {
    var group = selectPicker.group;
    if (!group) return;
    quickAddPresets(group.key, [value]).then(function () {
      quickForm[group.field] = value;
      renderQuickPanel();
      closeSelectPicker();
      showToast('已选择「' + value + '」');
    });
  }

  function toggleStaffInPicker(name) {
    var idx = quickForm.staffNames.indexOf(name);
    if (idx === -1) {
      quickForm.staffNames.push(name);
    } else {
      quickForm.staffNames.splice(idx, 1);
    }
    renderQuickPanel();
    renderSelectPicker();
    updateStaffDoneText();
  }

  /* 手动输入：添加为预设并直接选中 */
  function selectPickerManualAdd() {
    if (!selectPicker.group) return;
    var v = $('selectPickerInput').value.trim();
    if (!v) { showToast('请输入名称'); return; }

    quickAddPresets(selectPicker.group.key, [v]).then(function (added) {
      $('selectPickerInput').value = '';
      quickForm[selectPicker.group.field] = v;
      renderQuickPanel();
      closeSelectPicker();
      showToast(added ? '已添加并选择「' + v + '」' : '已选择「' + v + '」');
    });
  }

  function quickSubmit() {
    var boss = quickForm.boss.trim();
    var project = quickForm.project.trim();
    var date = quickForm.date;
    var unitPrice = Number(quickForm.unitPrice);
    var quantity = Number(quickForm.quantity);
    var amount = Number(quickForm.amount);

    if (!date) { showToast('请选择日期'); return; }
    if (!boss) { showToast('请选择或输入老板'); return; }
    if (quickForm.staffNames.length === 0) { showToast('请选择陪陪'); return; }
    if (!Number.isFinite(unitPrice) || unitPrice < 0) { showToast('请填写正确的单价'); return; }
    if (!Number.isFinite(quantity) || quantity < 1) { showToast('请填写正确的数量'); return; }

    var total = Number.isFinite(amount) && amount > 0
      ? Math.round(amount * 100) / 100
      : Math.round(unitPrice * quantity * 100) / 100;

    if (!(total > 0)) { showToast('请填写总额'); return; }

    var companions = quickForm.staffNames.slice();
    var order = {
      id: makeId(),
      fingerprint: buildFingerprint(date, boss, companions, project,
        quickForm.gift.trim(), unitPrice, quantity, total, quickForm.stageManager.trim()),
      date: date,
      boss: boss,
      companions: companions,
      project: project,
      gift: quickForm.gift.trim(),
      unitPrice: unitPrice,
      quantity: quantity,
      amount: total,
      stageManager: quickForm.stageManager.trim(),
      allocations: splitAmount(companions, total)
    };

    var existing = state.orders.slice();
    var duplicate = existing.some(function (o) {
      return o.fingerprint === order.fingerprint;
    });

    function confirmSave() {
      showModal({
        title: '确认结单',
        content: '确定保存这笔订单吗？\n' +
          order.boss + ' · ' + (order.project || '未填项目') + ' · ' +
          order.companions.length + ' 人 · 总额 ¥' + money(order.amount),
        confirmText: '确认保存',
        cancelText: '返回检查'
      }).then(function (res) {
        if (!res.confirm) return;

        saveAll(state.staff, existing.concat([order]), state.presets).then(function (ok) {
          if (!ok) return;

          // 重置金额类字段，保留常用选择便于连续录单
          quickForm.unitPrice = '';
          quickForm.quantity = '1';
          quickForm.amount = '';
          quickForm.amountTouched = false;
          quickForm.date = today();
          renderQuickPanel();
          showToast('保存成功');
        });
      });
    }

    if (duplicate) {
      showModal({
        title: '⚠️ 发现相同订单',
        content: '已存在内容完全相同的订单。相同内容可能是正常下单，请核对后选择是否继续保存。',
        confirmText: '继续确认',
        cancelText: '返回检查'
      }).then(function (res) {
        if (res.confirm) confirmSave();
      });
    } else {
      confirmSave();
    }
  }

  function renderPreviewPanel() {
    var list = $('previewList');
    var message = $('previewMessage');
    var saveBtn = $('saveOrdersBtn');

    if (state.previewMessage) {
      message.textContent = state.previewMessage;
      message.hidden = false;
    } else {
      message.hidden = true;
    }

    list.innerHTML = state.previewOrders.map(function (preview, index) {
      var html = '<div class="card">' +
        '<div class="section-title">识别结果 ' + (index + 1) + '</div>' +
        '<div class="data-line"><span>老板</span><span>' + escapeHtml(preview.boss || '（未识别）') + '</span></div>' +
        '<div class="data-line"><span>日期</span><span>' + escapeHtml(preview.date || '（未识别）') + '</span></div>' +
        '<div class="data-line"><span>项目</span><span>' + escapeHtml(preview.project || '（未识别）') + '</span></div>' +
        '<div class="data-line"><span>礼物</span><span>' + escapeHtml(preview.gift || '—') + '</span></div>' +
        '<div class="data-line"><span>单价</span><span>' + escapeHtml(preview.unitPrice) + '</span></div>' +
        '<div class="data-line"><span>数量</span><span>' + escapeHtml(preview.quantity) + '</span></div>' +
        '<div class="data-line"><span>总额</span><span class="amount">¥' + escapeHtml(preview.amount) + '</span></div>' +
        '<div class="data-line"><span>场控</span><span>' + escapeHtml(preview.stageManager || '—') + '</span></div>';

      if (preview.allocations.length > 0) {
        html += '<div class="sub-title">陪陪平均分配</div>';
        preview.allocations.forEach(function (allocation) {
          html += '<div class="allocation-line">' +
            '<span>' + escapeHtml(allocation.staffName) + '</span>' +
            '<span>¥' + escapeHtml(allocation.amount) + '</span></div>';
        });
      }

      if (preview.valid) {
        html += '<div class="status-ok">基本检查通过</div>';
      }
      if (preview.warning) {
        html += '<div class="warning">' + escapeHtml(preview.warning) + '</div>';
      }

      return html + '</div>';
    }).join('');

    saveBtn.hidden = state.previewOrders.length === 0;
  }

  function renderOrdersPanel() {
    $('orderCount').textContent = state.orders.length;
    $('orderEmpty').style.display = state.orders.length === 0 ? '' : 'none';

    var list = $('orderList');
    list.innerHTML = state.orders.map(function (order) {
      var html = '<div class="order-item">' +
        '<div class="order-top"><span>' + escapeHtml(order.project) + '</span>' +
        '<span class="amount">¥' + escapeHtml(money(order.amount)) + '</span></div>' +
        '<div class="hint">日期：' + escapeHtml(order.date) + '</div>' +
        '<div class="hint">老板：' + escapeHtml(order.boss) + '　场控：' + escapeHtml(order.stageManager || '—') + '</div>' +
        '<div class="hint">陪陪：' + order.companions.map(escapeHtml).join(' ') + '</div>';

      order.allocations.forEach(function (allocation) {
        html += '<div class="allocation-line">' +
          '<span>' + escapeHtml(allocation.staffName) + '</span>' +
          '<span>¥' + escapeHtml(money(allocation.amount)) + '</span></div>';
      });

      html += '<button class="delete-btn" type="button" data-action="delete-order" data-id="' + escapeHtml(order.id) + '">删除订单</button>';
      return html + '</div>';
    }).join('');
  }

  function renderStaffPanel() {
    $('staffCount').textContent = state.staff.length;
    $('staffEmpty').style.display = state.staff.length === 0 ? '' : 'none';

    var list = $('staffList');
    list.innerHTML = state.staff.map(function (person) {
      return '<div class="staff-item">' +
        '<div class="staff-info">' +
        '<div class="staff-name">' + escapeHtml(person.name) + '</div>' +
        '<div class="hint">提成 ' + escapeHtml(person.rate) + '% · 补贴 ¥' + escapeHtml(person.allowance) + ' · 扣款 ¥' + escapeHtml(person.deduction) + '</div>' +
        '</div>' +
        '<button class="delete-btn" type="button" data-action="delete-staff" data-id="' + escapeHtml(person.id) + '">删除</button>' +
        '</div>';
    }).join('');
  }

  function renderPayrollPanel() {
    var result = computePayroll(state.staff, state.orders, state.month);

    $('payrollOrderTotal').textContent = '¥' + result.orderTotal;
    $('payrollAllocationTotal').textContent = '¥' + result.allocationTotal;
    $('payrollCommissionTotal').textContent = '¥' + result.commissionTotal;
    $('payrollPayableTotal').textContent = '¥' + result.payableTotal;

    var list = $('payrollRows');
    list.innerHTML = result.rows.map(function (person) {
      return '<div class="card">' +
        '<div class="staff-name">' + escapeHtml(person.name) + '</div>' +
        '<div class="data-line"><span>参与分配次数</span><span>' + escapeHtml(person.orderCount) + '</span></div>' +
        '<div class="data-line"><span>分配金额</span><span>¥' + escapeHtml(person.allocatedText) + '</span></div>' +
        '<div class="data-line"><span>提成</span><span>¥' + escapeHtml(person.commissionText) + '</span></div>' +
        '<div class="data-line"><span>补贴</span><span>¥' + escapeHtml(person.allowanceText) + '</span></div>' +
        '<div class="data-line"><span>扣款</span><span>¥' + escapeHtml(person.deductionText) + '</span></div>' +
        '<div class="data-line"><span>应发工资</span><span class="amount">¥' + escapeHtml(person.payableText) + '</span></div>' +
        '</div>';
    }).join('');
  }

  /* ================= 业务动作（与原小程序版一致） ================= */

  function parseBatch() {
    var raw = (state.batchText || '').trim();

    if (!raw) {
      showToast('请先粘贴小票');
      return;
    }

    var chunks = raw
      .split(/(?=(?:💫|🪐)?\s*老板\s*[:：])/)
      .filter(function (part) {
        return /老板\s*[:：]/.test(part);
      });

    if (chunks.length === 0) {
      showModal({
        title: '没有识别到小票',
        content: '请确认小票包含“老板：”字段。',
        showCancel: false
      });
      return;
    }

    var previews = chunks.map(function (chunk) {
      return parseReceipt(chunk);
    });

    var validCount = previews.filter(function (order) {
      return order.valid;
    }).length;

    state.previewOrders = previews;
    state.previewMessage = '共识别 ' + previews.length +
      ' 张小票，其中 ' + validCount + ' 张通过基本检查。';

    renderPreviewPanel();

    // 识别时就检查与已保存订单是否相同，只提醒，不删除
    var savedFingerprints = state.orders.map(function (order) {
      return order.fingerprint;
    });

    var duplicates = previews.filter(function (order) {
      return order.valid &&
        savedFingerprints.indexOf(order.fingerprint) !== -1;
    }).length;

    if (duplicates > 0) {
      showModal({
        title: '发现相同订单',
        content: '发现 ' + duplicates +
          ' 张与已保存订单内容相同的小票。相同内容也可能是正常订单，系统不会自动取消或跳过。',
        confirmText: '知道了',
        showCancel: false
      });
    }
  }

  function saveParsedOrders() {
    var previews = state.previewOrders;
    var existing = state.orders.slice();

    if (previews.length === 0) {
      showToast('请先识别小票');
      return;
    }

    var existingFingerprints = existing.map(function (order) {
      return order.fingerprint;
    });

    var newOrders = [];
    var invalid = 0;
    var duplicate = 0;
    var seen = existingFingerprints.slice();

    previews.forEach(function (item) {
      if (!item.valid) {
        invalid++;
        return;
      }

      if (seen.indexOf(item.fingerprint) !== -1) {
        duplicate++;
      }

      // 即使内容相同，也保留该订单，不自动跳过
      newOrders.push({
        id: item.id,
        fingerprint: item.fingerprint,
        date: item.date,
        boss: item.boss,
        companions: item.companions,
        project: item.project,
        gift: item.gift,
        unitPrice: item.unitPrice,
        quantity: item.quantity,
        amount: item.amount,
        stageManager: item.stageManager,
        allocations: item.allocations
      });

      seen.push(item.fingerprint);
    });

    if (newOrders.length === 0) {
      showModal({
        title: '没有有效订单',
        content: '有 ' + invalid + ' 张小票未通过检查，请核对后再保存。',
        showCancel: false
      });
      return;
    }

    function confirmSave() {
      showModal({
        title: '确认保存订单',
        content: '确定保存这 ' + newOrders.length +
          ' 张订单吗？保存后会计入工资统计。未通过检查的 ' +
          invalid + ' 张不会保存。',
        confirmText: '确认保存',
        cancelText: '返回检查'
      }).then(function (res) {
        if (!res.confirm) return;

        saveAll(state.staff, existing.concat(newOrders), state.presets).then(function (ok) {
          if (!ok) return;

          state.batchText = '';
          state.previewOrders = [];
          state.previewMessage = '';

          $('batchInput').value = '';
          renderPreviewPanel();

          showToast('保存成功');
        });
      });
    }

    if (duplicate > 0) {
      showModal({
        title: '⚠️ 发现相同订单',
        content: '发现 ' + duplicate +
          ' 张内容相同的订单。相同内容可能是正常下单，请核对。选择“继续确认”后还会再询问一次是否保存。',
        confirmText: '继续确认',
        cancelText: '返回检查'
      }).then(function (res) {
        if (res.confirm) {
          confirmSave();
        }
      });
    } else {
      confirmSave();
    }
  }

  function addStaff() {
    var name = $('staffName').value.trim();
    var rate = Number($('staffRate').value);
    var allowance = Number($('staffAllowance').value);
    var deduction = Number($('staffDeduction').value);

    if (!name) {
      showToast('请输入员工姓名');
      return;
    }

    if (state.staff.some(function (person) {
      return person.name === name;
    })) {
      showToast('员工已存在');
      return;
    }

    if (
      !Number.isFinite(rate) || rate < 0 || rate > 100 ||
      !Number.isFinite(allowance) || allowance < 0 ||
      !Number.isFinite(deduction) || deduction < 0
    ) {
      showToast('请检查工资设置');
      return;
    }

    var updated = state.staff.concat([{
      id: makeId(),
      name: name,
      rate: rate,
      allowance: allowance,
      deduction: deduction
    }]);

    saveAll(updated, state.orders, state.presets).then(function (ok) {
      if (!ok) return;

      $('staffName').value = '';
      $('staffRate').value = '30';
      $('staffAllowance').value = '0';
      $('staffDeduction').value = '0';

      showToast('员工已添加');
    });
  }

  function deleteStaff(id) {
    var person = state.staff.find(function (item) {
      return item.id === id;
    });

    if (!person) return;

    var used = state.orders.some(function (order) {
      return order.allocations.some(function (allocation) {
        return allocation.staffName === person.name;
      });
    });

    if (used) {
      showModal({
        title: '不能删除',
        content: '该员工已出现在订单记录中，为保留历史数据，暂不允许删除。',
        showCancel: false
      });
      return;
    }

    showModal({
      title: '删除员工',
      content: '确定删除 ' + person.name + ' 吗？'
    }).then(function (res) {
      if (!res.confirm) return;

      var updated = state.staff.filter(function (item) {
        return item.id !== id;
      });

      saveAll(updated, state.orders, state.presets);
    });
  }

  function deleteOrder(id) {
    showModal({
      title: '删除订单',
      content: '确定删除这笔订单吗？删除后该订单不再计入工资统计。'
    }).then(function (res) {
      if (!res.confirm) return;

      var updated = state.orders.filter(function (order) {
        return order.id !== id;
      });

      saveAll(state.staff, updated, state.presets);
    });
  }

  /* ================= 事件绑定与初始化 ================= */

  function bindEvents() {
    document.querySelectorAll('.tab').forEach(function (btn) {
      btn.addEventListener('click', function () {
        switchTab(btn.dataset.tab);
      });
    });

    document.querySelectorAll('.mode-btn').forEach(function (btn) {
      btn.addEventListener('click', function () {
        switchMode(btn.dataset.mode);
      });
    });

    $('batchInput').addEventListener('input', function (e) {
      state.batchText = e.target.value;
    });

    $('parseBtn').addEventListener('click', parseBatch);
    $('saveOrdersBtn').addEventListener('click', saveParsedOrders);
    $('addStaffBtn').addEventListener('click', addStaff);

    /* ---- 快捷录单事件 ---- */
    $('quickSubmitBtn').addEventListener('click', quickSubmit);

    $('qDate').addEventListener('input', function (e) {
      quickForm.date = e.target.value;
    });

    $('qUnitPrice').addEventListener('input', function (e) {
      quickForm.unitPrice = e.target.value;
      if (!quickForm.amountTouched) {
        var p = Number(quickForm.unitPrice);
        var q = Number(quickForm.quantity);
        quickForm.amount =
          Number.isFinite(p) && Number.isFinite(q) && p > 0 && q > 0
            ? String(Math.round(p * q * 100) / 100)
            : '';
        $('qAmount').value = quickForm.amount;
      }
      renderQuickPreview();
    });

    $('qQuantity').addEventListener('input', function (e) {
      quickForm.quantity = e.target.value;
      if (!quickForm.amountTouched) {
        var p = Number(quickForm.unitPrice);
        var q = Number(quickForm.quantity);
        quickForm.amount =
          Number.isFinite(p) && Number.isFinite(q) && p > 0 && q > 0
            ? String(Math.round(p * q * 100) / 100)
            : '';
        $('qAmount').value = quickForm.amount;
      }
      renderQuickPreview();
    });

    $('qAmount').addEventListener('input', function (e) {
      quickForm.amount = e.target.value;
      quickForm.amountTouched = true;
      renderQuickPreview();
    });

    // 选择按钮：老板 / 项目 / 场控 / 礼物 → 弹出选项
    PRESET_GROUPS.forEach(function (group) {
      $(group.field + 'Select').addEventListener('click', function () {
        openSelectPicker(group.key);
      });
    });
    // 陪陪选择按钮 → 弹多选
    $('staffSelect').addEventListener('click', openStaffPicker);

    // 选项选择器
    $('selectPickerClose').addEventListener('click', closeSelectPicker);
    $('selectPicker').addEventListener('click', function (e) {
      if (e.target === this) closeSelectPicker();
    });
    $('selectPickerDone').addEventListener('click', closeSelectPicker);
    $('selectPickerInputAdd').addEventListener('click', selectPickerManualAdd);
    $('selectPickerInput').addEventListener('keydown', function (e) {
      if (e.key === 'Enter') {
        e.preventDefault();
        selectPickerManualAdd();
      }
    });
    $('selectPickerList').addEventListener('click', function (e) {
      // 行内删除预设
      var del = e.target.closest('.select-row-del');
      if (del) {
        e.stopPropagation();
        if (selectPicker.group) {
          quickRemovePreset(selectPicker.group.key, del.dataset.value).then(function () {
            renderSelectPicker();
          });
        }
        return;
      }

      var row = e.target.closest('.select-row');
      if (!row) return;

      // 陪陪多选
      if (selectPicker.multi) {
        if (row.dataset.staff !== undefined) toggleStaffInPicker(row.dataset.staff);
        return;
      }

      // 历史候选：添加并选中；预设：直接选中
      if (row.classList.contains('add-row')) {
        selectCandidateValue(row.dataset.value);
      } else {
        selectPresetValue(row.dataset.value);
      }
    });

    $('monthInput').addEventListener('input', function (e) {
      state.month = e.target.value;
      renderPayrollPanel();
    });

    // 列表删除按钮事件委托
    document.addEventListener('click', function (e) {
      var btn = e.target.closest('[data-action]');
      if (!btn) return;

      var action = btn.dataset.action;
      var id = btn.dataset.id;

      if (action === 'delete-order') {
        deleteOrder(id);
      } else if (action === 'delete-staff') {
        deleteStaff(id);
      }
    });
  }

  function init() {
    try {
      var savedMode = localStorage.getItem(MODE_KEY);
      if (savedMode === 'paste' || savedMode === 'quick') {
        state.mode = savedMode;
      }
    } catch (e) {}

    bindEvents();
    switchTab('orders');
    $('monthInput').value = state.month;
    renderAll();

    initCloud()
      .then(loadAll)
      .then(function () {
        renderAll();
        applyMode();
      })
      .catch(function (e) {
        console.error('初始化失败:', e);
      });
  }

  if (typeof document !== 'undefined' && document.readyState !== 'loading') {
    init();
  } else if (typeof document !== 'undefined') {
    document.addEventListener('DOMContentLoaded', init);
  }

  /* Node 环境下导出纯逻辑，便于自动化测试 */
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = {
      parseReceipt: parseReceipt,
      computePayroll: computePayroll,
      money: money,
      currentMonth: currentMonth,
      splitAmount: splitAmount,
      parseDate: parseDate,
      parseCompanions: parseCompanions,
      getField: getField,
      getNumberField: getNumberField,
      makeId: makeId
    };
  }
})();
