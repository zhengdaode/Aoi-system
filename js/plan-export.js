// Aoi-system — 购买清单表格导出（v3.9.4，取代 v3.9.0 逐账号 PNG 图片方案）
// 限购计划页 / 活动管理展开区「导出购买清单表」：按已存购买计划（d.limitPlans）把整个活动
// 导出为一个 xlsx，每个账号一个 Sheet；版式沿用原图片方案（顶部账号名大标题 + 逐商品行），
// 列 = 参考图（内嵌图片而非链接）/ 商品外文原名 / 型号（中文）/ 外币单价 / 件数 / 外币小计。
// 原名解析与 v3.9.0 一致：商品主档 nameOrig 优先 → PCO 目录按 refUrl/名称回查 jpName → 型号兜底。
// 外币价解析：商品主档 priceOrig/currency 优先 → 订单外币原价均价（Aoi.limits.productsForActivity 同源）。
// 架构：buildWorkbook(d, activity) 为纯函数（数据→与 Aoi.exportSummary 同构的工作簿描述符），
// 渲染复用 exportSummary 的 exceljs 通道（参考图转 base64 内嵌）/ SheetJS 回退（链接形式）。
window.Aoi = window.Aoi || {};
Aoi.planExport = {};

// 原语言名称解析：商品主档 nameOrig（原名元数据，v3.9.2）优先 → PCO 目录按 refUrl/
// 名称互查 jpName → 型号本身含假名视为原文；都没有 → 型号（中文译名）兜底
Aoi.planExport.displayName = function (d, p) {
  var model = (p && p.model) || '';
  if (p && p.nameOrig) return p.nameOrig;
  var refUrl = Aoi.exportSummary.absUrl(p && p.refUrl);
  var items = (d && d.pcoItems) || [];
  for (var i = 0; i < items.length; i++) {
    var it = items[i];
    if (!it || !it.jpName) continue;
    var sameUrl = refUrl && it.url && Aoi.exportSummary.absUrl(it.url) === refUrl;
    var sameName = it.jpName === model || (it.name && it.name === model);
    if (sameUrl || sameName) return it.jpName;
  }
  return model;
};

// 外币金额展示：币种符号 + 千分位（与限购计划商品表 origText 同规则）
Aoi.planExport.origText = function (currency, v) {
  if (v == null || currency == null) return '—';
  return Aoi.currencySymbol(currency) + v.toLocaleString('zh-CN', { maximumFractionDigits: 2 });
};

// 生成某活动购买计划的逐账号 Sheet 描述（纯数据，供渲染与单测）。
// 返回 { title, sheets: [{ name, rows, merges, cols, freeze, rowHeights }] } —— 与
// Aoi.exportSummary.buildWorkbook 同构，可直接交给 renderExcelJS / renderPlain。
Aoi.planExport.buildWorkbook = function (d, activity) {
  var plan = d && d.limitPlans && d.limitPlans[activity];
  if (!plan || !plan.items) return { title: '', sheets: [] };
  var pmeta = {};
  (((d.activityMeta || {})[activity] || {}).products || []).forEach(function (p) {
    if (p) pmeta[p.type + '|' + p.model] = p;
  });
  // 订单侧外币原价均价兜底（主档缺 priceOrig 时）
  var stat = {};
  try {
    Aoi.limits.productsForActivity(activity).forEach(function (p) { stat[p.type + '|' + p.model] = p; });
  } catch (e) { /* 无订单数据时跳过 */ }

  function origOf(key) {
    var p = pmeta[key];
    if (p && p.priceOrig != null && p.currency && p.currency !== 'cny') return { v: p.priceOrig, cur: p.currency };
    var s = stat[key];
    if (s && s.origAvg != null) return { v: s.origAvg, cur: s.origCurrency };
    return null;
  }

  // Sheet 名净化（≤31 字符、无非法字符、去重；与 exportSummary 同规则）
  var usedNames = {};
  function sheetName(raw) {
    var n = String(raw).replace(/[\\/:*?[\]]/g, '-').substring(0, 31) || 'Sheet';
    if (usedNames[n]) { var i = 2; while (usedNames[n + '_' + i]) i++; n = n + '_' + i; }
    usedNames[n] = 1;
    return n;
  }
  function c(v, s) { return s ? { v: v, s: s } : { v: v }; }

  var HEADERS = ['参考图', '商品名（原文）', '型号', '外币单价', '件数', '外币小计'];
  var COL_W = [{ w: 14 }, { w: 44 }, { w: 20 }, { w: 12 }, { w: 8 }, { w: 12 }];

  var sheets = [];
  var rows = (plan.items || []).filter(function (a) { return a.items && a.items.length; });
  rows.forEach(function (a) {
    var label = Aoi.limits.purchaserLabel(activity, a.index) || ('账号 ' + a.index);
    var sheet = { name: sheetName('账号' + a.index + '-' + label), rows: [], merges: [], cols: COL_W.slice(), freeze: { r: 2, c: 0 }, rowHeights: {} };
    var put = function (r, col, cell) {
      while (sheet.rows.length <= r) sheet.rows.push([]);
      var row = sheet.rows[r];
      while (row.length <= col) row.push(null);
      row[col] = cell;
    };
    // 账号名大标题（沿用图片方案的版式：顶部一行大字账号名）
    put(0, 0, c(label, { fill: 'FFF2CC', bold: true, center: true, size: 16 }));
    sheet.merges.push({ r1: 0, c1: 0, r2: 0, c2: HEADERS.length - 1 });
    HEADERS.forEach(function (h, i) { put(1, i, c(h, { bold: true, border: true, center: true, fill: 'E7E6E6' })); });
    var qtySum = 0, origTotals = {};
    a.items.forEach(function (it, ri) {
      var r = 2 + ri;
      var key = it.type + '|' + it.model;
      var p = pmeta[key] || {};
      var img = Aoi.exportSummary.absUrl(p.refImage || '');
      if (img) {
        // 参考图：内嵌图片 + 链接双保险（内嵌失败时保留可点击链接），整行加高
        put(r, 0, c('图片链接', { link: img, img: img, color: '0000FF' }));
        sheet.rowHeights[r] = 90;
      } else {
        put(r, 0, c('—', { center: true, color: '9CA3AF' }));
      }
      put(r, 1, c(Aoi.planExport.displayName(d, p), { wrap: true }));
      put(r, 2, c(it.model, { wrap: true }));
      var orig = origOf(key);
      put(r, 3, c(orig ? Aoi.planExport.origText(orig.cur, orig.v) : '—', { right: true }));
      put(r, 4, c(it.qty || 0, { right: true, border: true }));
      put(r, 5, c(orig ? Aoi.planExport.origText(orig.cur, Math.round(orig.v * (it.qty || 0) * 100) / 100) : '—', { right: true, bold: true }));
      qtySum += it.qty || 0;
      if (orig) origTotals[orig.cur] = Math.round(((origTotals[orig.cur] || 0) + orig.v * (it.qty || 0)) * 100) / 100;
    });
    // 合计行：件数 + 按币种分组的外币合计（多币种以 + 连接）
    var totalText = Object.keys(origTotals).map(function (cur) { return Aoi.planExport.origText(cur, origTotals[cur]); }).join(' + ');
    var last = 2 + a.items.length;
    put(last, 0, c('合计', { bold: true, center: true, border: true }));
    put(last, 1, c('', { border: true }));
    put(last, 2, c('', { border: true }));
    put(last, 3, c('', { border: true }));
    put(last, 4, c(qtySum, { bold: true, right: true, border: true }));
    put(last, 5, c(totalText || '—', { bold: true, right: true, border: true }));
    sheets.push(sheet);
  });
  return { title: activity, sheets: sheets };
};

// 导出文件基础名：活动名-购买清单表（非法文件名字符 → -）
Aoi.planExport.fileBase = function (activity) {
  return String(activity || '').replace(/[\\/:*?"<>|]/g, '-') + '-购买清单表';
};

// 全活动导出：一个 xlsx，每个账号一个 Sheet（参考图经 exceljs 通道转 base64 内嵌）。
// 入口：限购计划结果区 / 活动管理展开区「导出购买清单表」/ 购买计划弹窗。
Aoi.planExport.exportAll = function (activity) {
  activity = (activity || '').trim();
  if (!activity) { Aoi.toast('请先选择活动', 'warning'); return; }
  var d = Aoi.orders.ensure();
  var desc = Aoi.planExport.buildWorkbook(d, activity);
  if (!desc.sheets.length) { Aoi.toast('该活动还没有购买计划——请先「计算购买计划」', 'warning'); return; }
  var base = Aoi.planExport.fileBase(activity);
  if (typeof window.ExcelJS === 'object' && window.ExcelJS.Workbook) {
    Aoi.showLoading('正在导出购买清单表（' + desc.sheets.length + ' 个账号，参考图内嵌中）…');
    Aoi.exportSummary.renderExcelJS(desc, base).then(function () {
      Aoi.hideLoading();
    }, function () {
      Aoi.hideLoading();
    });
  } else if (typeof XLSX === 'object' && XLSX.utils) {
    Aoi.exportSummary.renderPlain(desc, base);
  } else {
    Aoi.toast('表格组件未加载，无法导出', 'error');
  }
};
