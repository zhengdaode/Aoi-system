// 谷圈限购计算器 — 界面逻辑（经典脚本，ES2017）
// 容器 CSP 禁止内联脚本与行内事件：全部逻辑在此文件，事件用 addEventListener 绑定。
// 存储：容器注入的 window.xhs.miniTool 本地缓存（小工具在线文档 §3.1，客户端 ≥9.46）；
// 按容器规范不回退 localStorage / IndexedDB —— 存储不可用时工具照常运行、仅不保存。
// 导出：容器禁用文件下载（a[download]/blob 下载），结果图经 Canvas 绘制后走
// writeTempFile → saveImageToPhotosAlbum 保存到系统相册（需 photos 授权）。
// 币种：与主系统 Aoi.calc 同口径 —— 人民币基准，日韩各带汇率+加价、0.5 圆整。
(function () {
  'use strict';

  var CORE = window.LimitCalcCore;
  var SAVE_KEY = 'limitcalc_state_v1';
  var SAVE_DELAY = 400;

  // —— 币种（与主系统一致：人民币 / 日元 / 韩元）——
  var CURRENCIES = [
    { code: 'cny', short: '¥', label: '¥ 人民币' },
    { code: 'jpy', short: 'JP¥', label: 'JP¥ 日元' },
    { code: 'krw', short: '₩', label: '₩ 韩元' }
  ];
  var DEFAULT_RATES = {
    jpy: { rate: 0.048, markup: 0.005 },
    krw: { rate: 0.0052, markup: 0.0001 }
  };

  function currencySymbol(code) {
    return code === 'jpy' ? 'JP¥' : (code === 'krw' ? '₩' : '¥');
  }

  function currencySelect(cls, value) {
    var sel = el('select', 'sel ' + cls);
    CURRENCIES.forEach(function (c) {
      var opt = el('option', null, c.short);
      opt.value = c.code;
      if (c.code === (value || 'cny')) opt.selected = true;
      sel.appendChild(opt);
    });
    return sel;
  }

  // —— 轻量 DOM 工具 ——
  function $(id) { return document.getElementById(id); }

  function el(tag, cls, text) {
    var node = document.createElement(tag);
    if (cls) node.className = cls;
    if (text != null) node.textContent = text;
    return node;
  }

  function fmtMoney(v) { return '¥' + (Math.round(v * 100) / 100).toFixed(2); }

  function fmtNum(v) {
    var r = Math.round(v * 100) / 100;
    try { return r.toLocaleString('zh-CN', { maximumFractionDigits: 2 }); }
    catch (e) { return String(r); }
  }

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
      freeCur: $('freeCur').value,
      accounts: $('inAccounts').value,
      maxTypes: $('inMaxTypes').value
    };
  }

  function applySettings(s) {
    if (!s) return;
    $('inName').value = s.name || '';
    $('inFree').value = s.free == null ? '' : String(s.free);
    $('freeCur').value = s.freeCur || 'cny';
    $('inAccounts').value = s.accounts == null ? '' : String(s.accounts);
    $('inMaxTypes').value = s.maxTypes == null ? '' : String(s.maxTypes);
  }

  function readRates() {
    function pick(id, dflt) {
      var v = parseFloat($(id).value);
      return (isNaN(v) || v < 0) ? dflt : v;
    }
    return {
      jpy: { rate: pick('jpyRate', DEFAULT_RATES.jpy.rate), markup: pick('jpyMarkup', DEFAULT_RATES.jpy.markup) },
      krw: { rate: pick('krwRate', DEFAULT_RATES.krw.rate), markup: pick('krwMarkup', DEFAULT_RATES.krw.markup) }
    };
  }

  function applyRates(r) {
    if (!r) return;
    if (r.jpyRate != null) $('jpyRate').value = String(r.jpyRate);
    if (r.jpyMarkup != null) $('jpyMarkup').value = String(r.jpyMarkup);
    if (r.krwRate != null) $('krwRate').value = String(r.krwRate);
    if (r.krwMarkup != null) $('krwMarkup').value = String(r.krwMarkup);
  }

  function readRow(row) {
    return {
      name: row.querySelector('.p-name').value,
      qty: row.querySelector('.p-qty').value,
      price: row.querySelector('.p-price').value,
      cur: row.querySelector('.p-cur').value,
      limit: row.querySelector('.p-limit').value
    };
  }

  function collectState() {
    var rows = [];
    var list = $('productList');
    Array.prototype.forEach.call(list.querySelectorAll('.prow'), function (row) {
      rows.push(readRow(row));
    });
    return {
      v: 2,
      settings: readSettings(),
      rates: {
        jpyRate: $('jpyRate').value,
        jpyMarkup: $('jpyMarkup').value,
        krwRate: $('krwRate').value,
        krwMarkup: $('krwMarkup').value
      },
      products: rows
    };
  }

  // —— 商品行渲染 ——
  function numCell(label, cls, step, value, placeholder, inputMode, extra) {
    var wrap = el('label', 'pnum');
    wrap.appendChild(el('span', 'pnum-label', label));
    var inner = el('div', 'pnum-inline');
    var input = el('input', 'input ' + cls);
    input.type = 'number';
    input.min = '0';
    input.step = step;
    input.inputMode = inputMode || 'numeric';
    input.placeholder = placeholder || '';
    input.value = value == null ? '' : String(value);
    inner.appendChild(input);
    if (extra) inner.appendChild(extra);
    wrap.appendChild(inner);
    return wrap;
  }

  function makeRow(data) {
    var row = el('div', 'prow');
    var top = el('div', 'prow-top');
    var name = el('input', 'input p-name');
    name.type = 'text';
    name.maxLength = 30;
    name.value = (data && data.name) || '';
    var del = el('button', 'p-del', '×');
    del.type = 'button';
    del.setAttribute('aria-label', '删除该商品');
    top.appendChild(name);
    top.appendChild(del);
    var nums = el('div', 'prow-nums');
    nums.appendChild(numCell('数量', 'p-qty', '1', data ? data.qty : '', '1', 'numeric', null));
    nums.appendChild(numCell('单价', 'p-price', '0.01', data ? data.price : '', '0', 'decimal', currencySelect('p-cur', data ? data.cur : 'cny')));
    nums.appendChild(numCell('单账号限购', 'p-limit', '1', data ? data.limit : '', '不限', 'numeric', null));
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

    $('btnClear').addEventListener('click', onClear);
    $('btnCompute').addEventListener('click', onCompute);
    $('btnExport').addEventListener('click', onExport);

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

    ['inName', 'inFree', 'freeCur', 'inAccounts', 'inMaxTypes',
      'jpyRate', 'jpyMarkup', 'krwRate', 'krwMarkup'].forEach(function (id) {
      $(id).addEventListener('input', scheduleSave);
      $(id).addEventListener('change', scheduleSave);
    });
  }

  function onClear() {
    if (typeof window.confirm === 'function' && !window.confirm('清空商品清单与方案设置？')) return;
    applySettings({ name: '', free: '', freeCur: 'cny', accounts: '', maxTypes: '' });
    renderProducts(null);
    $('resultBox').hidden = true;
    lastResult = null;
    setSaveStatus('');
    saveNow();
  }

  // —— 计算与结果渲染 ——
  function collectProductsForCompute(rates) {
    var rows = Array.prototype.slice.call($('productList').querySelectorAll('.prow'));
    var products = [];
    var meta = {};
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
      var cur = r.cur || 'cny';
      var limit = parseInt(r.limit, 10);
      var type = r.name.trim() || ('商品' + (products.length + 1));
      products.push({
        type: type,
        model: '',
        qty: qty,
        price: CORE.toRmb(price, cur, rates),   // 折算人民币参与分配与包邮判断
        limit: isNaN(limit) || limit <= 0 ? null : limit
      });
      meta[type + '|'] = { currency: cur, unit: price };   // 原币单价（展示用）
    }
    if (!products.length) { toast('请先添加商品并填写数量'); return null; }
    return { products: products, meta: meta };
  }

  var lastResult = null;

  function hideResult() { $('resultBox').hidden = true; }

  function summaryText(bundle) {
    var result = bundle.result;
    var ctx = bundle.ctx;
    var accounts = result.accounts || [];
    var reachedCnt = accounts.filter(function (a) { return a.reached; }).length;
    var pieces = accounts.reduce(function (s, a) {
      return s + a.items.reduce(function (t, it) { return t + it.qty; }, 0);
    }, 0);
    var lineText = '';
    if (ctx.free > 0) {
      lineText = ctx.freeCur === 'cny'
        ? '（线 ' + fmtMoney(ctx.free) + '）'
        : '（线 ' + currencySymbol(ctx.freeCur) + fmtNum(ctx.free) + ' ≈ ' + fmtMoney(ctx.freeRmb) + '）';
    }
    return (ctx.name ? '「' + ctx.name + '」' : '')
      + '分配 ' + accounts.length + ' 个账号 · 共 ' + pieces + ' 件'
      + (ctx.free > 0 ? ' · ' + reachedCnt + '/' + accounts.length + ' 达标包邮' + lineText : '');
  }

  function renderResult(bundle) {
    var box = $('resultBox');
    var result = bundle.result;
    var meta = bundle.meta;
    var ctx = bundle.ctx;
    var accounts = result.accounts || [];

    $('resultSummary').textContent = summaryText(bundle);

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
      var foreign = {};
      a.items.forEach(function (it) {
        var m = meta[it.type + '|' + (it.model || '')];
        var cur = m ? m.currency : 'cny';
        var li = el('li', 'acard-item');
        var row = el('div', 'acard-item-row');
        row.appendChild(el('span', 'acard-item-name', it.type + (it.model ? '·' + it.model : '') + ' ×' + it.qty));
        row.appendChild(el('span', 'acard-item-amt', fmtMoney(it.amount)));
        li.appendChild(row);
        if (m && cur !== 'cny') {
          var orig = Math.round(it.qty * m.unit * 100) / 100;
          li.appendChild(el('div', 'acard-item-orig', currencySymbol(cur) + fmtNum(orig)));
          foreign[cur] = Math.round(((foreign[cur] || 0) + orig) * 100) / 100;
        }
        items.appendChild(li);
      });
      card.appendChild(items);

      var footText = '共 ' + a.items.reduce(function (t, it) { return t + it.qty; }, 0) + ' 件';
      var fKeys = Object.keys(foreign);
      if (fKeys.length) {
        footText += ' · 外币合计 ' + fKeys.map(function (c) { return currencySymbol(c) + fmtNum(foreign[c]); }).join(' + ');
      }
      card.appendChild(el('div', 'acard-foot', footText));
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
    var rates = readRates();
    var collected = collectProductsForCompute(rates);
    if (!collected) return;
    var accounts = parseInt($('inAccounts').value, 10);
    if (!(accounts >= 1)) { toast('请填写可用账号数（≥1）'); $('inAccounts').focus(); return; }
    var free = parseFloat($('inFree').value);
    if (isNaN(free) || free < 0) free = 0;
    var freeCur = $('freeCur').value;
    var freeRmb = CORE.toRmb(free, freeCur, rates);
    var maxTypes = parseInt($('inMaxTypes').value, 10);
    if (isNaN(maxTypes) || maxTypes <= 0) maxTypes = 0;
    var result = CORE.planCore(collected.products, { freeShip: freeRmb, accounts: accounts, maxTypes: maxTypes });
    lastResult = {
      result: result,
      meta: collected.meta,
      ctx: { name: $('inName').value.trim(), free: free, freeCur: freeCur, freeRmb: freeRmb, accounts: accounts }
    };
    renderResult(lastResult);
    saveNow();
  }

  // —— 导出：结果图绘制 + 保存到相册 ——
  function dateStr() {
    var d = new Date();
    function p2(n) { return (n < 10 ? '0' : '') + n; }
    return d.getFullYear() + '-' + p2(d.getMonth() + 1) + '-' + p2(d.getDate());
  }

  function wrapLines(mg, text, font, maxWidth) {
    mg.font = font;
    var lines = [];
    var cur = '';
    for (var i = 0; i < text.length; i++) {
      var next = cur + text.charAt(i);
      if (mg.measureText(next).width > maxWidth && cur) { lines.push(cur); cur = text.charAt(i); }
      else cur = next;
    }
    if (cur) lines.push(cur);
    return lines;
  }

  function drawResultCanvas(bundle) {
    var result = bundle.result;
    var meta = bundle.meta;
    var ctx = bundle.ctx;
    var W = 750;
    var pad = 26;
    var COL = {
      bg: '#faf7f2', card: '#ffffff', coral: '#cc785c', ink: '#33302e', sub: '#8a837c',
      ok: '#2e9e6b', warn: '#d97706', amberBg: 'rgba(217, 119, 6, 0.12)', amberInk: '#8a5a10'
    };

    var mg = document.createElement('canvas');
    mg.width = W;
    mg.height = 10;
    mg = mg.getContext && mg.getContext('2d');
    if (!mg) return null;   // 环境无 Canvas（如 jsdom）

    function rrPath(g, x, y, w, h, r) {
      g.beginPath();
      g.moveTo(x + r, y);
      g.arcTo(x + w, y, x + w, y + h, r);
      g.arcTo(x + w, y + h, x, y + h, r);
      g.arcTo(x, y + h, x, y, r);
      g.arcTo(x, y, x + w, y, r);
      g.closePath();
    }

    var ops = [];
    var innerX = pad + 20;
    var innerW = W - 2 * pad - 40;

    // 头部珊瑚带
    var sumText = summaryText(bundle);
    var nameText = ctx.name ? '「' + ctx.name + '」' : '';
    ops.push({ h: 132, fn: function (g) {
      g.fillStyle = COL.coral;
      g.fillRect(0, 0, W, 132);
      g.fillStyle = '#ffffff';
      g.font = 'bold 36px sans-serif';
      g.fillText('谷圈限购计算器', pad, 56);
      var ty = 56;
      if (nameText) { g.font = '18px sans-serif'; g.globalAlpha = 0.9; g.fillText(nameText, pad, 86); ty = 86; g.globalAlpha = 1; }
      g.font = '17px sans-serif';
      g.globalAlpha = 0.95;
      wrapLines(mg, sumText, '17px sans-serif', W - 2 * pad).slice(0, 2).forEach(function (line, i) {
        g.fillText(line, pad, ty + 26 + i * 22);
      });
      g.globalAlpha = 1;
    } });
    ops.push({ h: 18, fn: function () {} });

    // 账号卡
    result.accounts.forEach(function (a) {
      var rows = [];
      var foreign = {};
      a.items.forEach(function (it) {
        var m = meta[it.type + '|' + (it.model || '')];
        var cur = m ? m.currency : 'cny';
        var orig = (m && cur !== 'cny') ? Math.round(it.qty * m.unit * 100) / 100 : null;
        if (orig != null) foreign[cur] = Math.round(((foreign[cur] || 0) + orig) * 100) / 100;
        rows.push({
          name: it.type + ' ×' + it.qty,
          amt: fmtMoney(it.amount),
          orig: orig,
          origText: orig != null ? currencySymbol(cur) + fmtNum(orig) : ''
        });
      });
      var itemsH = rows.reduce(function (s, r) { return s + 30 + (r.orig != null ? 20 : 0); }, 0);
      var fKeys = Object.keys(foreign);
      var footText = '共 ' + a.items.reduce(function (t, it) { return t + it.qty; }, 0) + ' 件'
        + (fKeys.length ? ' · 外币合计 ' + fKeys.map(function (c) { return currencySymbol(c) + fmtNum(foreign[c]); }).join(' + ') : '');
      var cardH = 18 + 36 + 6 + itemsH + 8 + 22 + 14;
      ops.push({ h: cardH + 14, fn: function (g, y) {
        rrPath(g, pad, y, W - 2 * pad, cardH, 18);
        g.fillStyle = COL.card;
        g.fill();
        var hy = y + 18 + 26;
        g.fillStyle = COL.ink;
        g.font = 'bold 26px sans-serif';
        g.fillText('账号 ' + a.index, innerX, hy);
        var xr = W - pad - 20;
        var shipText = a.reached ? '已达包邮' : (ctx.free > 0 ? '差 ' + fmtMoney(a.diff) : '');
        if (shipText) {
          g.fillStyle = a.reached ? COL.ok : COL.warn;
          g.font = 'bold 19px sans-serif';
          var sw = g.measureText(shipText).width;
          g.fillText(shipText, xr - sw, hy);
          xr -= sw + 16;
        }
        g.fillStyle = COL.ink;
        g.font = 'bold 24px sans-serif';
        var tw = g.measureText(fmtMoney(a.total)).width;
        g.fillText(fmtMoney(a.total), xr - tw, hy);
        var iy = y + 18 + 36 + 6;
        rows.forEach(function (r) {
          g.fillStyle = COL.ink;
          g.font = '20px sans-serif';
          g.fillText(r.name, innerX, iy + 20);
          var aw = g.measureText(r.amt).width;
          g.fillText(r.amt, W - pad - 20 - aw, iy + 20);
          iy += 30;
          if (r.orig != null) {
            g.fillStyle = COL.sub;
            g.font = '15px sans-serif';
            var ow = g.measureText(r.origText).width;
            g.fillText(r.origText, W - pad - 20 - ow, iy + 2);
            iy += 20;
          }
        });
        g.fillStyle = COL.sub;
        g.font = '15px sans-serif';
        g.fillText(footText, innerX, y + cardH - 14);
      } });
    });

    // 剩余未分配
    if (result.remaining && result.remaining.length) {
      var remainText = '⚠️ 剩余未分配（受限购 / 种类上限装不下，需加账号或放宽限购）：'
        + result.remaining.map(function (r) { return r.type + ' ×' + r.qty; }).join('，');
      var lines = wrapLines(mg, remainText, '17px sans-serif', innerW);
      var boxH = 16 + lines.length * 24 + 16;
      ops.push({ h: boxH + 14, fn: function (g, y) {
        rrPath(g, pad, y, W - 2 * pad, boxH, 14);
        g.fillStyle = COL.amberBg;
        g.fill();
        g.fillStyle = COL.amberInk;
        g.font = '17px sans-serif';
        lines.forEach(function (line, i) { g.fillText(line, innerX, y + 16 + 18 + i * 24); });
      } });
    }

    // 落款
    ops.push({ h: 56, fn: function (g, y) {
      g.fillStyle = COL.sub;
      g.font = '14px sans-serif';
      g.textAlign = 'center';
      g.fillText('谷圈限购计算器 · ' + dateStr(), W / 2, y + 28);
      g.textAlign = 'left';
    } });

    var H = 0;
    ops.forEach(function (op) { H += op.h; });
    var canvas = document.createElement('canvas');
    canvas.width = W;
    canvas.height = H;
    var g = canvas.getContext && canvas.getContext('2d');
    if (!g) return null;
    g.fillStyle = COL.bg;
    g.fillRect(0, 0, W, H);
    var y = 0;
    ops.forEach(function (op) { op.fn(g, y); y += op.h; });
    return canvas;
  }

  function onExport() {
    if (!lastResult) { toast('请先计算购买计划'); return; }
    var canvas = drawResultCanvas(lastResult);
    if (!canvas) { toast('当前环境不支持生成图片'); return; }
    var dataUrl;
    try { dataUrl = canvas.toDataURL('image/png'); } catch (e) { toast('生成图片失败，请重试'); return; }
    var mt = window.xhs && window.xhs.miniTool;
    if (!mt || typeof mt.saveImageToPhotosAlbum !== 'function') { toast('当前环境不支持保存图片'); return; }
    function save(filePath) {
      Promise.resolve(mt.saveImageToPhotosAlbum({ filePath: filePath }))
        .then(function (r) {
          if (r === false || (r && r.errMsg && r.errMsg.indexOf(':fail') >= 0)) {
            toast('保存失败' + (r && r.errMsg ? '：' + r.errMsg : '，请重试'));
          } else {
            toast('已保存到系统相册');
          }
        })
        .catch(function (e) {
          toast('保存失败：' + ((e && e.errMsg) || '请重试'));
        });
    }
    if (typeof mt.writeTempFile === 'function') {
      // 大图先落临时文件（官方建议），失败回落直接传 dataUrl
      Promise.resolve(mt.writeTempFile({ data: dataUrl }))
        .then(function (r) { save(r && r.filePath ? r.filePath : dataUrl); })
        .catch(function () { save(dataUrl); });
    } else {
      save(dataUrl);
    }
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
        if (saved.rates) applyRates(saved.rates);
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
