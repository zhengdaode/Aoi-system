// 谷圈限购计算器 — 界面逻辑（经典脚本，ES2017）
// 容器 CSP 禁止内联脚本与行内事件：全部逻辑在此文件，事件用 addEventListener 绑定。
// 存储：容器注入的 window.xhs.miniTool 本地缓存（小工具在线文档 §3.1，客户端 ≥9.46）；
// 按容器规范不回退 localStorage / IndexedDB —— 存储不可用时工具照常运行、仅不保存。
(function () {
  'use strict';

  var CORE = window.LimitCalcCore;
  var SAVE_KEY = 'limitcalc_state_v1';
  var SAVE_DELAY = 400;

  // —— 轻量 DOM 工具 ——
  function $(id) { return document.getElementById(id); }

  function el(tag, cls, text) {
    var node = document.createElement(tag);
    if (cls) node.className = cls;
    if (text != null) node.textContent = text;
    return node;
  }

  function fmtMoney(v) { return '¥' + (Math.round(v * 100) / 100).toFixed(2); }

  var toastTimer = null;
  function toast(msg) {
    var t = $('toast');
    if (!t) return;
    t.textContent = msg;
    t.hidden = false;
    if (toastTimer) clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { t.hidden = true; }, 2600);
  }

  // —— 平台存储（不可用时不保存、不回退浏览器存储）——
  function getMiniTool() {
    var mt = window.xhs && window.xhs.miniTool;
    if (mt && typeof mt.setStorage === 'function' && typeof mt.getStorage === 'function') return mt;
    return null;
  }

  var miniTool = getMiniTool();
  var saveTimer = null;

  function setSaveStatus(text) {
    var s = $('saveStatus');
    if (s) s.textContent = text;
  }

  function scheduleSave() {
    if (!miniTool) return;
    if (saveTimer) clearTimeout(saveTimer);
    saveTimer = setTimeout(saveNow, SAVE_DELAY);
  }

  function saveNow() {
    if (!miniTool) return;
    if (saveTimer) { clearTimeout(saveTimer); saveTimer = null; }
    var payload;
    try { payload = JSON.stringify(collectState()); } catch (e) { return; }
    Promise.resolve(miniTool.setStorage({ key: SAVE_KEY, data: payload }))
      .then(function (ok) {
        // 文档约定：需处理 setStorage 返回 false 的情况，保留输入并提示未保存
        if (ok === false) setSaveStatus('当前环境暂未保存本次修改');
        else setSaveStatus('已自动保存到本机');
      })
      .catch(function () { setSaveStatus('保存失败，修改仅保留在当前页面'); });
  }

  function loadSaved() {
    if (!miniTool) return Promise.resolve(null);
    return Promise.resolve(miniTool.getStorage({ key: SAVE_KEY }))
      .then(function (res) {
        var data = res && res.data;
        if (!data) return null;
        try { return JSON.parse(data); } catch (e) { return null; }
      })
      .catch(function () { return null; });
  }

  // —— 状态读写 ——
  function readSettings() {
    return {
      name: $('inName').value,
      free: $('inFree').value,
      accounts: $('inAccounts').value,
      maxTypes: $('inMaxTypes').value
    };
  }

  function applySettings(s) {
    if (!s) return;
    $('inName').value = s.name || '';
    $('inFree').value = s.free == null ? '' : String(s.free);
    $('inAccounts').value = s.accounts == null ? '' : String(s.accounts);
    $('inMaxTypes').value = s.maxTypes == null ? '' : String(s.maxTypes);
  }

  function readRow(row) {
    return {
      name: row.querySelector('.p-name').value,
      qty: row.querySelector('.p-qty').value,
      price: row.querySelector('.p-price').value,
      limit: row.querySelector('.p-limit').value
    };
  }

  function collectState() {
    var rows = [];
    var list = $('productList');
    Array.prototype.forEach.call(list.querySelectorAll('.prow'), function (row) {
      rows.push(readRow(row));
    });
    return { v: 1, settings: readSettings(), products: rows };
  }

  // —— 商品行渲染 ——
  function numField(label, cls, step, value, placeholder, inputMode) {
    var wrap = el('label', 'pnum');
    wrap.appendChild(el('span', 'pnum-label', label));
    var input = el('input', 'input ' + cls);
    input.type = 'number';
    input.min = '0';
    input.step = step;
    input.inputMode = inputMode || 'numeric';
    input.placeholder = placeholder || '';
    input.value = value == null ? '' : String(value);
    wrap.appendChild(input);
    return wrap;
  }

  function makeRow(data) {
    var row = el('div', 'prow');
    var top = el('div', 'prow-top');
    var name = el('input', 'input p-name');
    name.type = 'text';
    name.placeholder = '商品名（如 吧唧·小夜灯）';
    name.maxLength = 30;
    name.value = (data && data.name) || '';
    var del = el('button', 'p-del', '×');
    del.type = 'button';
    del.setAttribute('aria-label', '删除该商品');
    top.appendChild(name);
    top.appendChild(del);
    var nums = el('div', 'prow-nums');
    nums.appendChild(numField('数量', 'p-qty', '1', data ? data.qty : '', '1', 'numeric'));
    nums.appendChild(numField('单价 ¥', 'p-price', '0.01', data ? data.price : '', '0', 'decimal'));
    nums.appendChild(numField('单账号限购', 'p-limit', '1', data ? data.limit : '', '不限', 'numeric'));
    row.appendChild(top);
    row.appendChild(nums);
    return row;
  }

  function renderProducts(products) {
    var list = $('productList');
    list.textContent = '';
    var data = products && products.length ? products : [{}];
    data.forEach(function (p) { list.appendChild(makeRow(p)); });
  }

  // —— 事件 ——
  function bindEvents() {
    $('btnAdd').addEventListener('click', function () {
      $('productList').appendChild(makeRow(null));
      scheduleSave();
    });

    $('btnExample').addEventListener('click', fillExample);
    $('btnClear').addEventListener('click', onClear);
    $('btnCompute').addEventListener('click', onCompute);

    var list = $('productList');
    list.addEventListener('click', function (e) {
      var btn = e.target.closest ? e.target.closest('.p-del') : null;
      if (!btn) return;
      var row = e.target.closest('.prow');
      if (row && row.parentNode === list) list.removeChild(row);
      if (!list.querySelector('.prow')) list.appendChild(makeRow(null));
      scheduleSave();
    });
    list.addEventListener('input', scheduleSave);
    list.addEventListener('change', scheduleSave);

    ['inName', 'inFree', 'inAccounts', 'inMaxTypes'].forEach(function (id) {
      $(id).addEventListener('input', scheduleSave);
      $(id).addEventListener('change', scheduleSave);
    });
  }

  var EXAMPLE = {
    settings: { name: '示例：8.23 涩谷痛包团', free: '168', accounts: '4', maxTypes: '' },
    products: [
      { name: '痛包·单肩', qty: '4', price: '128', limit: '1' },
      { name: '吧唧·角色A', qty: '8', price: '25', limit: '2' },
      { name: '立牌·亚克力', qty: '6', price: '58', limit: '2' },
      { name: '色纸·收藏卡', qty: '10', price: '12', limit: '3' }
    ]
  };

  function fillExample() {
    applySettings(EXAMPLE.settings);
    renderProducts(EXAMPLE.products);
    toast('已填入示例数据，可直接计算');
    saveNow();
  }

  function onClear() {
    if (typeof window.confirm === 'function' && !window.confirm('清空商品清单与方案设置？')) return;
    applySettings({ name: '', free: '', accounts: '', maxTypes: '' });
    renderProducts(null);
    $('resultBox').hidden = true;
    setSaveStatus('');
    saveNow();
  }

  // —— 计算与结果渲染 ——
  function collectProductsForCompute() {
    var rows = Array.prototype.slice.call($('productList').querySelectorAll('.prow'));
    var products = [];
    for (var i = 0; i < rows.length; i++) {
      var r = readRow(rows[i]);
      var hasName = r.name.trim() !== '';
      var hasQty = r.qty.trim() !== '';
      var hasPrice = r.price.trim() !== '';
      if (!hasName && !hasQty && !hasPrice) continue;   // 整行留空跳过
      var qty = parseInt(r.qty, 10);
      if (!(qty >= 1)) { toast('第 ' + (i + 1) + ' 行请填写有效的数量（≥1）'); return null; }
      var price = parseFloat(r.price);
      if (isNaN(price) || price < 0) price = 0;
      var limit = parseInt(r.limit, 10);
      products.push({
        type: r.name.trim() || ('商品' + (products.length + 1)),
        model: '',
        qty: qty,
        price: price,
        limit: isNaN(limit) || limit <= 0 ? null : limit
      });
    }
    if (!products.length) { toast('请先添加商品并填写数量'); return null; }
    return products;
  }

  function hideResult() { $('resultBox').hidden = true; }

  function renderResult(result, ctx) {
    var box = $('resultBox');
    var accounts = result.accounts || [];
    var reachedCnt = accounts.filter(function (a) { return a.reached; }).length;
    var pieces = accounts.reduce(function (s, a) {
      return s + a.items.reduce(function (t, it) { return t + it.qty; }, 0);
    }, 0);

    var sum = $('resultSummary');
    sum.textContent = (ctx.name ? '「' + ctx.name + '」' : '')
      + '分配 ' + accounts.length + ' 个账号 · 共 ' + pieces + ' 件'
      + (ctx.free > 0 ? ' · ' + reachedCnt + '/' + accounts.length + ' 达标包邮（线 ' + fmtMoney(ctx.free) + '）' : '');

    var cards = $('resultCards');
    cards.textContent = '';
    accounts.forEach(function (a) {
      var card = el('div', 'acard' + (a.reached ? ' acard-ok' : ''));
      var head = el('div', 'acard-head');
      head.appendChild(el('span', 'acard-idx', '账号 ' + a.index));
      head.appendChild(el('span', 'acard-total', fmtMoney(a.total)));
      var shipText = a.reached ? '已达包邮' : (ctx.free > 0 ? '差 ' + fmtMoney(a.diff) : '');
      if (shipText) head.appendChild(el('span', 'acard-ship ' + (a.reached ? 'ship-ok' : 'ship-warn'), shipText));
      card.appendChild(head);

      var items = el('ul', 'acard-items');
      a.items.forEach(function (it) {
        var li = el('li', 'acard-item');
        li.appendChild(el('span', 'acard-item-name', it.type + (it.model ? '·' + it.model : '') + ' ×' + it.qty));
        li.appendChild(el('span', 'acard-item-amt', fmtMoney(it.amount)));
        items.appendChild(li);
      });
      card.appendChild(items);
      card.appendChild(el('div', 'acard-foot', '共 ' + a.items.reduce(function (t, it) { return t + it.qty; }, 0) + ' 件'));
      cards.appendChild(card);
    });

    var remain = $('resultRemain');
    if (result.remaining && result.remaining.length) {
      remain.textContent = '⚠️ 剩余未分配（受限购 / 种类上限装不下，需加账号或放宽限购）：'
        + result.remaining.map(function (r) { return r.type + ' ×' + r.qty; }).join('，');
      remain.hidden = false;
    } else {
      remain.hidden = true;
    }

    box.hidden = false;
    if (typeof box.scrollIntoView === 'function') {
      try { box.scrollIntoView({ behavior: 'smooth', block: 'start' }); } catch (e) { /* 环境不支持则忽略 */ }
    }
  }

  function onCompute() {
    if (!CORE || typeof CORE.planCore !== 'function') {
      toast('计算引擎未加载，请退出后重新打开');
      return;
    }
    var products = collectProductsForCompute();
    if (!products) return;
    var accounts = parseInt($('inAccounts').value, 10);
    if (!(accounts >= 1)) { toast('请填写可用账号数（≥1）'); $('inAccounts').focus(); return; }
    var free = parseFloat($('inFree').value);
    if (isNaN(free) || free < 0) free = 0;
    var maxTypes = parseInt($('inMaxTypes').value, 10);
    if (isNaN(maxTypes) || maxTypes <= 0) maxTypes = 0;
    var result = CORE.planCore(products, { freeShip: free, accounts: accounts, maxTypes: maxTypes });
    renderResult(result, { name: $('inName').value.trim(), free: free, accounts: accounts });
    saveNow();
  }

  // —— 启动 ——
  function boot() {
    if (!CORE || typeof CORE.planCore !== 'function') {
      // 启动失败可识别：保留可读提示，禁用依赖引擎的操作
      var btn = $('btnCompute');
      if (btn) btn.disabled = true;
      var box = $('resultBox');
      if (box) {
        box.hidden = false;
        var sum = $('resultSummary');
        if (sum) sum.textContent = '计算引擎未加载，请退出后重新打开小工具。';
      }
      return;
    }
    bindEvents();
    renderProducts(null);
    loadSaved().then(function (saved) {
      if (saved && typeof saved === 'object') {
        if (saved.settings) applySettings(saved.settings);
        if (saved.products) renderProducts(saved.products);
      }
      if (!miniTool) setSaveStatus('当前环境不支持本地保存，关闭后数据不会保留');
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})();
