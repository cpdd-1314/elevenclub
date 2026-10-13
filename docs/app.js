/* 十一愿俱乐部 Web 版
 * 业务逻辑与微信小程序版（miniprogram/pages/index/index.ts）完全一致：
 * 小票识别、陪陪平均分配、月度工资结算。
 * 差异仅在数据层与交互层：
 *   wx.getStorageSync / wx.setStorageSync -> localStorage
 *   wx.showModal -> 自定义模态框（Promise 化）
 *   wx.showToast -> 自定义轻提示
 *   this.setData   -> 状态对象 + 定向渲染
 */
(function () {
  'use strict';

  /* ================= 纯业务逻辑（与小程序版一致） ================= */

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

    var fingerprint = [
      date,
      boss,
      companions.slice().sort().join(','),
      project,
      gift,
      unitPrice === null ? '' : money(unitPrice),
      quantity === null ? '' : String(quantity),
      money(amount),
      stageManager
    ].join('|');

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

  /* ================= 状态与本地存储 ================= */

  var STAFF_KEY = 'clubPayrollStaff_v1';
  var ORDER_KEY = 'clubPayrollOrders_v2';

  var state = {
    tab: 'orders',
    batchText: '',
    previewOrders: [],
    previewMessage: '',
    staff: [],
    orders: [],
    month: currentMonth(),

    staffName: '',
    staffRate: '30',
    staffAllowance: '0',
    staffDeduction: ''
  };

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

  function loadAll() {
    state.staff = readStore(STAFF_KEY);
    state.orders = readStore(ORDER_KEY);
  }

  function saveAll(staff, orders) {
    if (!writeStore(STAFF_KEY, staff)) return false;
    if (!writeStore(ORDER_KEY, orders)) return false;

    state.staff = staff;
    state.orders = orders;

    renderOrdersPanel();
    renderStaffPanel();
    renderPayrollPanel();
    return true;
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

  var modalResolver = null;

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
      modalResolver = resolve;

      function cleanup(confirmed) {
        mask.hidden = true;
        confirmBtn.removeEventListener('click', onConfirm);
        cancelBtn.removeEventListener('click', onCancel);
        mask.removeEventListener('click', onMask);
        modalResolver = null;
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
        '<span class="amount">¥' + escapeHtml(order.amount) + '</span></div>' +
        '<div class="hint">日期：' + escapeHtml(order.date) + '</div>' +
        '<div class="hint">老板：' + escapeHtml(order.boss) + '　场控：' + escapeHtml(order.stageManager || '—') + '</div>' +
        '<div class="hint">陪陪：' + order.companions.map(escapeHtml).join(' ') + '</div>';

      order.allocations.forEach(function (allocation) {
        html += '<div class="allocation-line">' +
          '<span>' + escapeHtml(allocation.staffName) + '</span>' +
          '<span>¥' + escapeHtml(allocation.amount) + '</span></div>';
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

  /* ================= 业务动作（与小程序版一致） ================= */

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

        var updated = existing.concat(newOrders);

        if (saveAll(state.staff, updated)) {
          state.batchText = '';
          state.previewOrders = [];
          state.previewMessage = '';

          $('batchInput').value = '';
          renderPreviewPanel();

          showToast('保存成功');
        }
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

    if (saveAll(updated, state.orders)) {
      $('staffName').value = '';
      $('staffRate').value = '30';
      $('staffAllowance').value = '0';
      $('staffDeduction').value = '0';

      showToast('员工已添加');
    }
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

      saveAll(updated, state.orders);
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

      saveAll(state.staff, updated);
    });
  }

  /* ================= 事件绑定与初始化 ================= */

  function bindEvents() {
    document.querySelectorAll('.tab').forEach(function (btn) {
      btn.addEventListener('click', function () {
        switchTab(btn.dataset.tab);
      });
    });

    $('batchInput').addEventListener('input', function (e) {
      state.batchText = e.target.value;
    });

    $('parseBtn').addEventListener('click', parseBatch);
    $('saveOrdersBtn').addEventListener('click', saveParsedOrders);
    $('addStaffBtn').addEventListener('click', addStaff);

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
    loadAll();
    bindEvents();
    switchTab('orders');
    $('monthInput').value = state.month;
    renderOrdersPanel();
    renderStaffPanel();
    renderPayrollPanel();
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
