// Aoi-system — Excel 导入：排谷表 / 拼谷表 / 闲鱼 三格式识别
window.Aoi = window.Aoi || {};
Aoi.import = {};

// 标签列关键字（非制品列）
var LABEL = ['分类', '种类', '谷子', '款式', '昵称', '单价'];
// 非制品汇总列（闲鱼汇总表的「已收定金」等）
function isSummaryCol(name) {
  return /定金|尾款|邮费|金额汇总|已收/.test(name);
}

// 读取 workbook（ArrayBuffer）→ 统一订单记录数组
Aoi.import.parse = function (arrayBuffer, fileName) {
  var wb = XLSX.read(arrayBuffer, { type: 'array' });
  var batchFallback = String(fileName || '').replace(/\.(xlsx|xls|csv)$/i, '');

  // 选取要解析的 sheet：跳过发货/补邮；明细+汇总并存时只取汇总（数据一致，避免重复）
  var sheets = wb.SheetNames.filter(function (sn) { return !/发货|补邮/.test(sn); });
  if (sheets.some(function (sn) { return /汇总/.test(sn); })) {
    sheets = sheets.filter(function (sn) { return !/明细/.test(sn); });
  }

  var records = [];
  sheets.forEach(function (sn) {
    var rows = XLSX.utils.sheet_to_json(wb.Sheets[sn], { header: 1, raw: false, defval: '' })
      .map(function (r) { return r.map(function (c) { return c == null ? '' : String(c).trim(); }); });
    records = records.concat(Aoi.import.parseMatrix(rows, batchFallback));
  });
  return records;
};

// 解析单 sheet 的矩阵（明细型 / 汇总型），失败返回空数组
Aoi.import.parseMatrix = function (rows, batchFallback) {
  // 1. 定位单价行
  var priceIdx = -1;
  for (var i = 0; i < rows.length; i++) {
    if (rows[i].some(function (c) { return c === '单价' || c.indexOf('单价') === 0; })) { priceIdx = i; break; }
  }
  if (priceIdx < 1) return [];
  var header = rows[priceIdx - 1] || [];
  var priceRow = rows[priceIdx];

  // 2. 团期名：前几行找 【...】
  var batch = batchFallback;
  for (var b = 0; b < Math.min(3, rows.length); b++) {
    var m = (rows[b] || []).join('').match(/【(.+?)】/);
    if (m) { batch = m[1]; break; }
  }

  // 3. 分类行（可选）
  var catRow = null;
  if (priceIdx - 2 >= 0 && rows[priceIdx - 2].some(function (c) { return c === '分类' || c === '种类'; })) {
    catRow = rows[priceIdx - 2];
  }

  // 4. 制品列：header 中非标签、非汇总列
  var itemCols = [];
  header.forEach(function (c, idx) {
    if (!c) return;
    if (LABEL.indexOf(c) >= 0) return;
    if (isSummaryCol(c)) return;
    itemCols.push(idx);
  });
  if (!itemCols.length) return [];

  // 5. 汇总型（有「总数/总金额」行）vs 明细型
  var isSummary = rows.some(function (r) {
    return r.some(function (c) { return c.indexOf('总数') >= 0 || c.indexOf('总金额') >= 0; });
  });

  var records = [];
  if (isSummary) {
    // 买家昵称列
    var buyerCol = -1;
    for (var i2 = 0; i2 < rows.length && buyerCol < 0; i2++) {
      for (var j2 = 0; j2 < rows[i2].length; j2++) {
        var cell = rows[i2][j2];
        if (cell.indexOf('昵称') >= 0 && (cell.indexOf('总数') >= 0 || cell.indexOf('闲鱼') >= 0)) { buyerCol = j2; break; }
      }
    }
    if (buyerCol < 0) {
      for (var k = 0; k < header.length; k++) {
        if (header[k] && itemCols.indexOf(k) < 0 && LABEL.indexOf(header[k]) < 0) { buyerCol = k; break; }
      }
    }
    for (var d = priceIdx + 1; d < rows.length; d++) {
      var dr = rows[d];
      var buyer = buyerCol >= 0 ? dr[buyerCol] : '';
      if (!buyer || buyer.indexOf('总数') >= 0 || buyer.indexOf('昵称') >= 0 || buyer.indexOf('总金额') >= 0) continue;
      itemCols.forEach(function (ci) {
        var n = parseInt(dr[ci], 10);
        if (isNaN(n) || n <= 0) return;
        records.push(makeRecord(batch, catRow, header, priceRow, ci, n, buyer));
      });
    }
  } else {
    // 明细型：制品列每个非空单元格 = 一位买家
    for (var d2 = priceIdx + 1; d2 < rows.length; d2++) {
      var dr2 = rows[d2];
      itemCols.forEach(function (ci) {
        var buyer2 = dr2[ci];
        if (!buyer2) return;
        records.push(makeRecord(batch, catRow, header, priceRow, ci, 1, buyer2));
      });
    }
  }
  return records;
};

function makeRecord(batch, catRow, header, priceRow, ci, count, buyer) {
  var model = (header[ci] || '').replace(/^款式[:：]\s*/, '');
  // 制品类型：分类行从该列向左前向填充（合并单元格）
  var type = '默认类型';
  if (catRow) {
    for (var c = ci; c >= 0; c--) {
      if (catRow[c] && catRow[c] !== '分类' && catRow[c] !== '种类') { type = catRow[c]; break; }
    }
  }
  return {
    id: Aoi.genId(),
    ip: '',          // IP（作品）由管理员在确认弹窗中选填，不从团期名推
    activity: batch, // 团期名 = 活动批次
    type: type,
    model: model,
    price: parseFloat(priceRow[ci]) || 0,
    count: count,
    buyer: buyer,
    status: '未到货',
    paid: '未交'
  };
}

// 识别活动名（首条非空，供管理员确认/编辑）
Aoi.import.detectActivity = function (records) {
  for (var i = 0; i < records.length; i++) {
    if (records[i].activity) return records[i].activity;
  }
  return '';
};

// 识别 IP（作品）：优先匹配已知 IP 中「活动批次」的前缀（如「术力口」⊆「术力口-初音未来17周年」）
Aoi.import.detectIp = function (records) {
  var act = Aoi.import.detectActivity(records);
  if (!act) return '';
  var d = Aoi.orders.ensure();
  var ips = Aoi.orders.collectIps(d);
  for (var i = 0; i < ips.length; i++) {
    if (ips[i] && act.indexOf(ips[i]) === 0) return ips[i];
  }
  return '';
};
