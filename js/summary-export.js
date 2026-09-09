// Aoi-system — 汇总表导出（v3.7.0 S5）
// 复刻《7.8汇总表》结构：①「采购表」= 商品维度主表（名称/参考图/日元价/人民币价/需求总数/链接
//   + 购买人×商品分摊矩阵【取限购计划】+ 购入多余部分行【取 plan.remaining】）；
// ② 每活动一个「【活动名】汇总」= 结算矩阵（图片链接行/种类/人民币单价/每款总件数 + 每购买人一行数量矩阵 + 应付总额）。
// 与参考文件的预期偏差：参考图行以内嵌 WPS DISPIMG 实现（24MB），浏览器端改为「图片链接」单元格。
// 架构：buildWorkbook(d, onlyActivity) 为纯函数（数据→描述符，供单测）；
// 渲染层 exceljs（带样式，CDN）优先，SheetJS 回退（仅数值/合并/列宽）。
window.Aoi = window.Aoi || {};
Aoi.exportSummary = function (onlyActivity) {
  var d = Aoi.orders.ensure();
  var desc = Aoi.exportSummary.buildWorkbook(d, onlyActivity || null);
  if (!desc.sheets.length) { Aoi.toast('没有可导出的活动（需已有订单或登记商品）', 'warning'); return; }
  var base = onlyActivity ? String(onlyActivity).replace(/[\\/:*?"<>|]/g, '-') + '-汇总表' : '汇总表_全部活动';
  if (typeof window.ExcelJS === 'object' && window.ExcelJS.Workbook) {
    Aoi.exportSummary.renderExcelJS(desc, base);
  } else if (typeof XLSX === 'object' && XLSX.utils) {
    Aoi.exportSummary.renderPlain(desc, base);
  } else {
    Aoi.toast('表格组件未加载，无法导出', 'error');
  }
};

// —— 纯函数：数据 → 工作簿描述符（单元测试覆盖此层）——
// sheet = { name, rows: 二维稀疏数组(cell|null), merges: [{r1,c1,r2,c2}], cols: [{w}], freeze: {r,c} }
// cell = { v: 值, s: { fill, color, bold, fmt, right, center, border, wrap, link } }
Aoi.exportSummary.buildWorkbook = function (d, onlyActivity) {
  var R2 = function (n) { return Math.round(n * 100) / 100; };

  // 样式速记
  function c(v, s) { return s ? { v: v, s: s } : { v: v }; }
  function FW(fill) { return { fill: fill, color: 'FFFFFF' }; }

  // 工作表名净化（≤31 字符、无非法字符、去重）
  var usedNames = {};
  function sheetName(raw) {
    var n = String(raw).replace(/[\\/:*?[\]]/g, '-').substring(0, 31) || 'Sheet';
    if (usedNames[n]) { var i = 2; while (usedNames[n + '_' + i]) i++; n = n + '_' + i; }
    usedNames[n] = 1;
    return n;
  }

  // 稀疏行写入
  function Sheet(name) {
    this.name = name; this.rows = []; this.merges = []; this.cols = []; this.freeze = null;
    this.put = function (r, col, cell) {
      while (this.rows.length <= r) this.rows.push([]);
      var row = this.rows[r];
      while (row.length <= col) row.push(null);
      row[col] = cell;
    };
    this.merge = function (r1, c1, r2, c2) { this.merges.push({ r1: r1, c1: c1, r2: r2, c2: c2 }); };
  }

  // 活动筛选：有订单或登记商品的活动才导出
  var acts = (d.activities || []).filter(function (a) {
    if (onlyActivity && a !== onlyActivity) return false;
    var hasProducts = d.activityMeta[a] && (d.activityMeta[a].products || []).length;
    var hasOrders = (d.orders || []).some(function (o) { return o.activity === a; });
    return hasProducts || hasOrders;
  });

  // 每活动：登记商品 ∪ 订单组合，聚合 qty / 人民币均价（按件加权）/ 外币均价（主流币种）
  function groupsOf(a) {
    var meta = d.activityMeta[a] || {};
    var agg = {};
    (d.orders || []).forEach(function (o) {
      if (o.activity !== a || !o.type || !o.model) return;
      var key = o.type + '|' + o.model;
      if (!agg[key]) agg[key] = { qty: 0, priceW: 0, hasPrice: false, origs: {} };
      var g = agg[key];
      g.qty += o.count || 0;
      if (o.price != null) { g.hasPrice = true; g.priceW += o.price * (o.count || 0); }
      if (o.priceOrig != null && o.currency && o.currency !== 'cny') {
        (g.origs[o.currency] = g.origs[o.currency] || []).push(o.priceOrig);
      }
    });
    var seen = {};
    var list = [];
    (meta.products || []).forEach(function (p) {
      var key = p.type + '|' + p.model;
      seen[key] = 1;
      list.push(mk(p, agg[key]));
    });
    Object.keys(agg).sort().forEach(function (key) {
      if (!seen[key]) {
        var parts = key.split('|');
        list.push(mk({ type: parts[0], model: parts[1], refImage: '', refUrl: '' }, agg[key]));
      }
    });
    function mk(p, g) {
      var priceAvg = null, origAvg = null, origCurrency = null;
      if (g && g.hasPrice && g.qty) priceAvg = R2(g.priceW / g.qty);
      else if (p.price != null) priceAvg = p.price;
      if (g && Object.keys(g.origs).length) {
        origCurrency = Object.keys(g.origs).sort(function (x, y) { return g.origs[y].length - g.origs[x].length; })[0];
        var arr = g.origs[origCurrency];
        origAvg = R2(arr.reduce(function (s, v) { return s + v; }, 0) / arr.length);
      } else if (p.priceOrig != null && p.currency && p.currency !== 'cny') {
        origAvg = p.priceOrig; origCurrency = p.currency;
      }
      return {
        key: p.type + '|' + p.model, type: p.type, model: p.model,
        refImage: p.refImage || '', refUrl: p.refUrl || '', limit: p.limit,
        qty: g ? g.qty : 0, priceAvg: priceAvg, origAvg: origAvg, origCurrency: origCurrency
      };
    }
    return { name: a, link: meta.link || '', products: list };
  }

  var groups = acts.map(groupsOf);
  if (!groups.length) return { sheets: [], notes: [] };

  // —— Sheet 1：采购表 ——
  var pc = new Sheet(sheetName('采购表'));
  var col = 4; // A–D 列留给行标签与购买人子表（A=标签/购买人，B=金额，C=总数，D=实际），商品组自 E 列起（同参考文件）
  groups.forEach(function (g) {
    g.colStart = col;
    g.colEnd = col + Math.max(1, g.products.length) - 1;
    col = g.colEnd + 1;
  });
  var totalCols = col;
  pc.cols = [{ w: 16 }, { w: 14 }, { w: 10 }, { w: 12 }];
  for (var i = 4; i < totalCols; i++) pc.cols.push({ w: 16 });
  pc.freeze = { r: 2, c: 1 };

  // 组标题行（r0）
  var GROUP_FILLS = ['FFF2CC', 'DAE3F3'];
  groups.forEach(function (g, gi) {
    pc.put(0, g.colStart, c(g.name, { fill: GROUP_FILLS[gi % 2], bold: true, center: true }));
    if (g.colEnd > g.colStart) pc.merge(0, g.colStart, 0, g.colEnd);
  });
  // 行标签 + 商品行
  var LABELS = ['名称', '参考图', '价格（日元）', '价格（人民币）', '需求总数', '链接'];
  LABELS.forEach(function (label, r) {
    pc.put(r + 1, 0, c(label, { bold: true, center: true }));
  });
  var totalQty = 0, totalJpy = 0;
  groups.forEach(function (g) {
    var ps = g.products.length ? g.products : [{ model: '（无商品）', key: '|' }];
    ps.forEach(function (p, pi) {
      var colIdx = g.colStart + pi;
      var checker = pi % 2 === 0 ? '595959' : 'D9D9D9';
      pc.put(1, colIdx, c(p.model, { fill: checker, color: pi % 2 === 0 ? 'FFFFFF' : undefined, wrap: true, center: true }));
      if (p.refImage) pc.put(2, colIdx, c('图片链接', { link: p.refImage, color: '0000FF' }));
      if (p.origAvg != null && p.origCurrency === 'jpy') {
        pc.put(3, colIdx, c(p.origAvg, { right: true }));
        totalJpy += p.origAvg * p.qty;
      }
      if (p.priceAvg != null) pc.put(4, colIdx, c(p.priceAvg, { fmt: '0.00', right: true }));
      pc.put(5, colIdx, c(p.qty, { fill: pi % 2 === 0 ? 'FFCDD2' : 'E2EFDA', right: true }));
      var link = p.refUrl || g.link;
      if (link) pc.put(6, colIdx, c('点击链接', { link: link, color: '0000FF' }));
      totalQty += p.qty;
    });
  });
  pc.put(5, 1, c(totalQty, { bold: true, right: true }));
  if (totalJpy) pc.put(5, 2, c(R2(totalJpy), { bold: true, right: true }));

  // 购买人子表（r8 表头，r9+ 数据；分摊数量取限购计划）
  var SUB_HEAD = 8;
  ['购买人', '购买金额(¥)', '购买总数', '实际购买总数'].forEach(function (label, i) {
    pc.put(SUB_HEAD, i, c(label, { bold: true, border: true, center: true }));
  });
  groups.forEach(function (g) {
    pc.put(SUB_HEAD, g.colStart, c('分摊 →', { bold: true, center: true, fill: 'E7E6E6' }));
  });
  var row = SUB_HEAD + 1;
  var anyRemaining = [];
  groups.forEach(function (g) {
    var plan = d.limitPlans && d.limitPlans[g.name];
    if (!plan) return;
    var buyers = (d.activityMeta[g.name] || {}).buyers || [];
    (plan.items || []).forEach(function (slot) {
      var b = buyers[slot.index - 1] || {};
      var label = (b.buyer || '账号 ' + slot.index) + (b.account ? '（' + b.account + '）' : '');
      var pieces = 0, done = 0;
      var qtyByCol = {};
      (slot.items || []).forEach(function (it) {
        pieces += it.qty || 0;
        if (it.status === '已购买') done += it.qty || 0;
        for (var pi = 0; pi < g.products.length; pi++) {
          if (g.products[pi].key === it.type + '|' + it.model) {
            var ci = g.colStart + pi;
            qtyByCol[ci] = (qtyByCol[ci] || 0) + (it.qty || 0);
            break;
          }
        }
      });
      pc.put(row, 0, c(label, { border: true, wrap: true }));
      pc.put(row, 1, c(slot.total || 0, { fmt: '0.00', right: true, border: true }));
      pc.put(row, 2, c(pieces, { right: true, border: true }));
      pc.put(row, 3, c(done, { right: true, border: true }));
      Object.keys(qtyByCol).forEach(function (ci) {
        pc.put(row, parseInt(ci, 10), c(qtyByCol[ci], { fill: 'B4C7E7', right: true, border: true }));
      });
      row++;
    });
    (plan.remaining || []).forEach(function (r0) {
      anyRemaining.push(g.name + ' ' + r0.type + '-' + r0.model + ' ×' + r0.qty);
      for (var pi = 0; pi < g.products.length; pi++) {
        if (g.products[pi].key === r0.type + '|' + r0.model) {
          pc.put(row, g.colStart + pi, c(r0.qty, { fill: 'FFE699', right: true, border: true }));
          break;
        }
      }
    });
  });
  if (anyRemaining.length) {
    pc.put(row, 0, c('购入多余部分（未分配）', { bold: true, border: true, wrap: true }));
    pc.merge(row, 0, row, 3);
  }

  var sheets = [pc];

  // —— Sheet 2..n：每活动【活动名】汇总 ——
  var HEAD_FILLS = [
    { label: '689F38', cells: ['C6E0B4', '689F38'] },   // 种类
    { label: 'E65100', cells: ['FFB74D', 'E65100'] },  // 单价
    { label: '0288D1', cells: ['4FC3F7', '0288D1'] }   // 总数
  ];
  groups.forEach(function (g) {
    var sh = new Sheet(sheetName('【' + g.name + '】汇总'));
    var n = Math.max(1, g.products.length);
    sh.cols = [{ w: 12 }, { w: 14 }];
    for (var i = 0; i < n; i++) sh.cols.push({ w: 16 });
    sh.freeze = { r: 5, c: 2 };
    // 标题
    sh.put(0, 0, c('【' + g.name + '】汇总', { fill: 'FFF2CC', bold: true, center: true, size: 16 }));
    sh.merge(0, 0, 0, 1 + n);
    // 参考图链接行（r1）
    g.products.forEach(function (p, pi) {
      if (p.refImage) sh.put(1, 2 + pi, c('图片链接', { link: p.refImage, color: '0000FF' }));
    });
    // 种类 / 单价 / 总数
    sh.put(2, 1, c('种类', FW(HEAD_FILLS[0].label)));
    sh.put(3, 1, c('单价', FW(HEAD_FILLS[1].label)));
    sh.put(4, 0, c('总金额', { bold: true, center: true }));
    sh.put(4, 1, c('昵称/总数', FW(HEAD_FILLS[2].label)));
    g.products.forEach(function (p, pi) {
      var alt = pi % 2;
      sh.put(2, 2 + pi, c(p.type + ' ' + p.model, { fill: HEAD_FILLS[0].cells[alt], color: alt ? 'FFFFFF' : undefined, wrap: true }));
      sh.put(3, 2 + pi, c(p.priceAvg != null ? p.priceAvg : '', { fill: HEAD_FILLS[1].cells[alt], color: alt ? 'FFFFFF' : undefined, fmt: p.priceAvg != null ? '0.00' : undefined }));
      sh.put(4, 2 + pi, c(p.qty, { fill: HEAD_FILLS[2].cells[alt], color: alt ? 'FFFFFF' : undefined, right: true }));
    });
    if (!g.products.length) {
      sh.put(2, 2, c('（无商品）', { fill: HEAD_FILLS[0].cells[0] }));
    }
    // 买家矩阵（按订单逐单累计金额，数量按 type+model 归位）
    var buyers = {};
    (d.orders || []).forEach(function (o) {
      if (o.activity !== g.name || !o.buyer) return;
      var b = buyers[o.buyer] || (buyers[o.buyer] = { qty: {}, amount: 0 });
      var key = o.type + '|' + o.model;
      b.qty[key] = (b.qty[key] || 0) + (o.count || 0);
      if (o.price != null) b.amount += o.price * (o.count || 0);
    });
    var names = Object.keys(buyers).sort(function (a, b2) { return a.localeCompare(b2, 'zh-Hans-CN'); });
    names.forEach(function (name, ri) {
      var b = buyers[name];
      var r = 5 + ri;
      sh.put(r, 0, c(R2(b.amount), { fmt: '0.00', right: true, border: true }));
      sh.put(r, 1, c(name, { fill: ri % 2 ? '7F7F7F' : 'BFBFBF', color: ri % 2 ? 'FFFFFF' : undefined }));
      g.products.forEach(function (p, pi) {
        var q = b.qty[p.key];
        if (q) sh.put(r, 2 + pi, c(q, { fill: ri % 2 ? 'FFE699' : 'BDD7EE', right: true }));
      });
    });
    sheets.push(sh);
  });

  return { sheets: sheets, notes: anyRemaining };
};

// —— 渲染层 1：exceljs（带样式）——
Aoi.exportSummary.renderExcelJS = function (desc, base) {
  var wb = new window.ExcelJS.Workbook();
  desc.sheets.forEach(function (sh) {
    var ws = wb.addWorksheet(sh.name);
    (sh.cols || []).forEach(function (cfg, i) { if (cfg && cfg.w) ws.getColumn(i + 1).width = cfg.w; });
    if (sh.freeze) ws.views = [{ state: 'frozen', xSplit: sh.freeze.c || 0, ySplit: sh.freeze.r || 0 }];
    (sh.merges || []).forEach(function (m) { ws.mergeCells(m.r1 + 1, m.c1 + 1, m.r2 + 1, m.c2 + 1); });
    sh.rows.forEach(function (row, ri) {
      (row || []).forEach(function (cell, ci) {
        if (!cell) return;
        var rc = ws.getCell(ri + 1, ci + 1);
        var s = cell.s || {};
        if (s.link) rc.value = { text: String(cell.v == null ? '' : cell.v), hyperlink: s.link };
        else rc.value = cell.v;
        if (s.fill) rc.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF' + s.fill } };
        if (s.color || s.bold || s.size) rc.font = { color: s.color ? { argb: 'FF' + s.color } : undefined, bold: !!s.bold, size: s.size || 11 };
        if (s.fmt) rc.numFmt = s.fmt;
        if (s.right) rc.alignment = { horizontal: 'right', vertical: 'middle' };
        else if (s.center) rc.alignment = { horizontal: 'center', vertical: 'middle' };
        else if (s.wrap) rc.alignment = { vertical: 'middle', wrapText: true };
        if (s.border) rc.border = { top: { style: 'thin' }, left: { style: 'thin' }, bottom: { style: 'thin' }, right: { style: 'thin' } };
      });
    });
  });
  wb.xlsx.writeBuffer().then(function (buf) {
    Aoi.exportSummary.download(new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }), base + '.xlsx');
    Aoi.toast('已导出「' + base + '」.xlsx（含样式）', 'success');
  }).catch(function (e) {
    Aoi.toast('汇总表导出失败：' + (e && e.message ? e.message : e), 'error');
  });
};

// —— 渲染层 2：SheetJS 回退（数值/合并/列宽，无样式）——
Aoi.exportSummary.renderPlain = function (desc, base) {
  var wb = XLSX.utils.book_new();
  desc.sheets.forEach(function (sh) {
    var aoa = sh.rows.map(function (row) {
      return row.map(function (cell) { return cell ? cell.v : null; });
    });
    var ws = XLSX.utils.aoa_to_sheet(aoa);
    ws['!merges'] = (sh.merges || []).map(function (m) {
      return { s: { r: m.r1, c: m.c1 }, e: { r: m.r2, c: m.c2 } };
    });
    ws['!cols'] = (sh.cols || []).map(function (cfg) { return { wch: cfg && cfg.w ? cfg.w : 12 }; });
    XLSX.utils.book_append_sheet(wb, ws, sh.name);
  });
  XLSX.writeFile(wb, base + '.xlsx');
  Aoi.toast('已导出「' + base + '」.xlsx', 'success');
};

Aoi.exportSummary.download = function (blob, filename) {
  var a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  a.click();
  URL.revokeObjectURL(a.href);
};
