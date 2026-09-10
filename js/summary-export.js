// Aoi-system — 汇总表导出（v3.7.0 S5）
// 复刻《7.8汇总表》结构：①「采购表」= 商品维度主表（名称/参考图/日元价/人民币价/需求总数/链接
//   + 购买人×商品分摊矩阵【取限购计划】+ 购入多余部分行【取 plan.remaining】）；
// ② 每活动一个「【活动名】汇总」= 结算矩阵（图片链接行/种类/人民币单价/每款总件数 + 每购买人一行数量矩阵 + 应付总额）。
// 参考图（v3.9.0）：exceljs 通道拉取图床图片转 base64 直接内嵌（复刻参考文件的内嵌图意图），
//   拉取失败/格式不支持（如 webp）→ 回落「图片链接」超链接单元格；SheetJS 回退通道仅超链接。
// 商品跳转链接（链接行）：写入超链接单元格（exceljs hyperlink / SheetJS .l），点击直达；相对链接自动绝对化。
// 架构：buildWorkbook(d, onlyActivity) 为纯函数（数据→描述符，供单测）；
// 渲染层 exceljs（带样式，CDN）优先，SheetJS 回退（仅数值/合并/列宽/超链接）。
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
// sheet = { name, rows: 二维稀疏数组(cell|null), merges: [{r1,c1,r2,c2}], cols: [{w}], freeze: {r,c}, rowHeights: {r: pt} }
// cell = { v: 值, s: { fill, color, bold, fmt, right, center, border, wrap, link, img } }
// s.link = 超链接（可点击直达）；s.img = 内嵌图片 URL（exceljs 通道拉图转 base64 浮动贴入）

// 相对/协议相对链接绝对化：'//' → https:；'/xxx' → PCO 主站（目录推入来源）；
// 缺协议但含主机名 → https://；data:image 原样；空 → 空串
Aoi.exportSummary.absUrl = function (url) {
  var s = String(url || '').trim();
  if (!s) return '';
  if (/^data:image\//i.test(s)) return s;
  if (/^\/\//.test(s)) return 'https:' + s;
  if (/^\//.test(s)) return 'https://www.pokemoncenter-online.com' + s;
  if (!/^[a-z][a-z0-9+.-]*:/i.test(s) && /\./.test(s)) return 'https://' + s;
  return s;
};

// 0 基 (行,列) → Excel 地址（如 2,4 → 'E3'；供 SheetJS 回退通道写超链接）
Aoi.exportSummary.cellAddr = function (r, c) {
  var s = '';
  c++;
  while (c > 0) {
    var m = (c - 1) % 26;
    s = String.fromCharCode(65 + m) + s;
    c = Math.floor((c - 1) / 26);
  }
  return s + (r + 1);
};

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
    this.name = name; this.rows = []; this.merges = []; this.cols = []; this.freeze = null; this.rowHeights = {};
    this.put = function (r, col, cell) {
      while (this.rows.length <= r) this.rows.push([]);
      var row = this.rows[r];
      while (row.length <= col) row.push(null);
      row[col] = cell;
    };
    this.merge = function (r1, c1, r2, c2) { this.merges.push({ r1: r1, c1: c1, r2: r2, c2: c2 }); };
  }

  // 参考图单元格：内嵌图片 + 超链接双保险（内嵌失败时保留可点击链接），并把该行加高
  function imgCell(sheet, r, col, url) {
    var u = Aoi.exportSummary.absUrl(url);
    sheet.put(r, col, c('图片链接', { link: u, img: u, color: '0000FF' }));
    sheet.rowHeights[r] = 90;
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
      if (p.refImage) imgCell(pc, 2, colIdx, p.refImage);
      if (p.origAvg != null && p.origCurrency === 'jpy') {
        pc.put(3, colIdx, c(p.origAvg, { right: true }));
        totalJpy += p.origAvg * p.qty;
      }
      if (p.priceAvg != null) pc.put(4, colIdx, c(p.priceAvg, { fmt: '0.00', right: true }));
      pc.put(5, colIdx, c(p.qty, { fill: pi % 2 === 0 ? 'FFCDD2' : 'E2EFDA', right: true }));
      var link = Aoi.exportSummary.absUrl(p.refUrl || g.link);
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
    // 参考图内嵌行（r1）
    g.products.forEach(function (p, pi) {
      if (p.refImage) imgCell(sh, 1, 2 + pi, p.refImage);
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

// —— 渲染层 1：exceljs（带样式 + 参考图内嵌）——

// exceljs 支持的图片格式（其余如 webp 不内嵌，保留链接单元格）
Aoi.exportSummary.IMG_EXT = { 'image/png': 'png', 'image/jpeg': 'jpeg', 'image/jpg': 'jpeg', 'image/gif': 'gif' };

// 拉取图片转 base64 dataURL（供 wb.addImage）：data: URL 直通；http(s) fetch 后按
// content-type 识别格式（非 png/jpeg/gif 返回 null）；任何失败返回 null（不阻断导出）
Aoi.exportSummary.fetchImageBase64 = async function (url) {
  var s = String(url || '').trim();
  if (!s) return null;
  var dm = s.match(/^data:image\/(png|jpe?g|gif)/i);
  if (dm) return { dataUrl: s, ext: dm[1].toLowerCase() === 'jpg' ? 'jpeg' : dm[1].toLowerCase() };
  try {
    var res = await fetch(s, { redirect: 'follow' });
    if (!res.ok) return null;
    var ct = (res.headers.get('content-type') || '').toLowerCase().split(';')[0].trim();
    var ext = Aoi.exportSummary.IMG_EXT[ct];
    if (!ext) return null;
    var ab = await res.arrayBuffer();
    if (!ab.byteLength) return null;
    var u8 = new Uint8Array(ab), bin = '', CH = 8192;
    for (var i = 0; i < u8.length; i += CH) bin += String.fromCharCode.apply(null, u8.subarray(i, i + CH));
    return { dataUrl: 'data:' + ct + ';base64,' + btoa(bin), ext: ext };
  } catch (e) { return null; }
};

// 收集描述符中全部内嵌图片单元格 → [{ si, ri, ci, url }]（si: sheet 下标，0 基；供渲染层与单测）
Aoi.exportSummary.collectImageCells = function (desc) {
  var jobs = [];
  (desc.sheets || []).forEach(function (sh, si) {
    (sh.rows || []).forEach(function (row, ri) {
      (row || []).forEach(function (cell, ci) {
        if (cell && cell.s && cell.s.img) jobs.push({ si: si, ri: ri, ci: ci, url: cell.s.img });
      });
    });
  });
  return jobs;
};

Aoi.exportSummary.renderExcelJS = function (desc, base) {
  var wb = new window.ExcelJS.Workbook();
  var wss = [];
  desc.sheets.forEach(function (sh) {
    var ws = wb.addWorksheet(sh.name);
    (sh.cols || []).forEach(function (cfg, i) { if (cfg && cfg.w) ws.getColumn(i + 1).width = cfg.w; });
    if (sh.freeze) ws.views = [{ state: 'frozen', xSplit: sh.freeze.c || 0, ySplit: sh.freeze.r || 0 }];
    (sh.merges || []).forEach(function (m) { ws.mergeCells(m.r1 + 1, m.c1 + 1, m.r2 + 1, m.c2 + 1); });
    Object.keys(sh.rowHeights || {}).forEach(function (r) {
      ws.getRow(parseInt(r, 10) + 1).height = sh.rowHeights[r];
    });
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
    wss.push(ws);
  });
  // 参考图内嵌：拉取成功 → addImage 浮动贴入单元格（覆盖「图片链接」文字）；
  // 失败/格式不支持 → 保留链接单元格不动。并行拉取，单张失败不阻断。
  var jobs = Aoi.exportSummary.collectImageCells(desc);
  var failed = 0;
  Promise.all(jobs.map(function (j) {
    return Aoi.exportSummary.fetchImageBase64(j.url).then(function (im) {
      if (!im) { failed++; return; }
      var id = wb.addImage({ base64: im.dataUrl, extension: im.ext });
      wss[j.si].addImage(id, { tl: { col: j.ci, row: j.ri }, ext: { width: 108, height: 82 } });
    }).catch(function () { failed++; });
  })).then(function () {
    return wb.xlsx.writeBuffer();
  }).then(function (buf) {
    Aoi.exportSummary.download(new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }), base + '.xlsx');
    var extra = jobs.length
      ? (failed ? '（' + (jobs.length - failed) + '/' + jobs.length + ' 张参考图已内嵌，其余保留链接）' : '（参考图已全部内嵌）')
      : '';
    Aoi.toast('已导出「' + base + '」.xlsx（含样式）' + extra, 'success');
  }).catch(function (e) {
    Aoi.toast('汇总表导出失败：' + (e && e.message ? e.message : e), 'error');
  });
};

// —— 渲染层 2：SheetJS 回退（数值/合并/列宽/超链接，无样式与内嵌图）——
Aoi.exportSummary.renderPlain = function (desc, base) {
  var wb = XLSX.utils.book_new();
  desc.sheets.forEach(function (sh) {
    var aoa = sh.rows.map(function (row) {
      return row.map(function (cell) { return cell ? cell.v : null; });
    });
    var ws = XLSX.utils.aoa_to_sheet(aoa);
    // 超链接写在单元格 .l（图片链接/商品跳转链接保持可点击直达）
    (sh.rows || []).forEach(function (row, ri) {
      (row || []).forEach(function (cell, ci) {
        if (cell && cell.s && cell.s.link) {
          var addr = XLSX.utils.encode_cell({ r: ri, c: ci });
          var c0 = ws[addr];
          if (!c0) c0 = ws[addr] = { t: 's', v: String(cell.v == null ? '' : cell.v) };
          c0.l = { Target: cell.s.link };
        }
      });
    });
    ws['!merges'] = (sh.merges || []).map(function (m) {
      return { s: { r: m.r1, c: m.c1 }, e: { r: m.r2, c: m.c2 } };
    });
    ws['!cols'] = (sh.cols || []).map(function (cfg) { return { wch: cfg && cfg.w ? cfg.w : 12 }; });
    XLSX.utils.book_append_sheet(wb, ws, sh.name);
  });
  XLSX.writeFile(wb, base + '.xlsx');
  Aoi.toast('已导出「' + base + '」.xlsx（参考图以链接形式保留，跳转链接可点击）', 'success');
};

Aoi.exportSummary.download = function (blob, filename) {
  var a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  a.click();
  URL.revokeObjectURL(a.href);
};
