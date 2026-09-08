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
    var recs = Aoi.import.parseMatrix(rows, batchFallback);
    if (!recs.length) recs = Aoi.import.parseRecords(rows, batchFallback);
    records = records.concat(recs);
  });
  return records;
}

// —— 记录式表格解析（一行一订单）：识别本站「下载表格」导出的 xlsx/CSV ——
// 本站导出表头：行号 | (勾选空列) | 活动 | 制品类型 | 型号 | 单价(¥) | 外币原价 | 数量 | 购买者 | 备注 | 到货状态 | 到货批次 | 小计 | 操作
// 只映射业务列，UI 噪声列（行号/勾选/到货状态/到货批次/小计/操作）自动忽略。
var RECORD_ALIASES = {
  activity: ['活动', '团期', '活动批次'],
  type: ['制品类型', '分类'],
  model: ['型号', '款式', '谷子'],
  price: ['单价', '人民币价'],
  priceOrig: ['外币原价', '原价'],
  count: ['数量'],
  buyer: ['购买者', '购买人', '买家', '昵称'],
  remark: ['备注']
};
var RECORD_BUYER_SKIP = /总数|总金额|合计|购买者|购买人|买家|昵称|编辑|删除/;

function matchAlias(cell, aliases) {
  for (var i = 0; i < aliases.length; i++) {
    if (cell === aliases[i] || cell.indexOf(aliases[i]) === 0) return true; // 「单价(¥)」命中「单价」
  }
  return false;
}

// 「JP¥1200」/「₩9,000」/「—」→ { value, currency } | null
function parseOrigCell(v) {
  var s = String(v || '').trim();
  if (!s || s === '—' || s === '-') return null;
  var currency = 'cny';
  if (s.indexOf('JP¥') >= 0) currency = 'jpy';
  else if (s.indexOf('₩') >= 0) currency = 'krw';
  var num = parseFloat(s.replace(/[^0-9.]/g, ''));
  return isNaN(num) ? null : { value: num, currency: currency };
}

// 解析记录式表格，失败返回空数组（由 parse() 回退矩阵式）
Aoi.import.parseRecords = function (rows, batchFallback) {
  var header = null, headerIdx = -1, col = {};
  for (var i = 0; i < Math.min(5, rows.length); i++) {
    var r = rows[i] || [], c = {};
    for (var k in RECORD_ALIASES) {
      for (var j = 0; j < r.length; j++) {
        if (r[j] && matchAlias(r[j], RECORD_ALIASES[k]) && c[k] == null) { c[k] = j; break; }
      }
    }
    if (c.buyer != null && c.model != null && c.price != null) { header = r; headerIdx = i; col = c; break; }
  }
  if (!header) return [];

  var records = [];
  for (var d = headerIdx + 1; d < rows.length; d++) {
    var dr = rows[d] || [];
    var buyer = col.buyer != null ? dr[col.buyer] : '';
    if (!buyer || RECORD_BUYER_SKIP.test(buyer)) continue;
    var model = col.model != null ? dr[col.model] : '';
    if (!model) continue;
    var count = col.count != null ? parseInt(dr[col.count], 10) : 1;
    if (isNaN(count) || count <= 0) count = 1;
    var price = col.price != null ? parseFloat(dr[col.price]) || 0 : 0;
    var orig = col.priceOrig != null ? parseOrigCell(dr[col.priceOrig]) : null;
    records.push({
      id: Aoi.genId(),
      ip: '',
      activity: (col.activity != null ? dr[col.activity] : '') || batchFallback,
      type: (col.type != null ? dr[col.type] : '') || '默认类型',
      model: model,
      price: price,
      priceOrig: orig ? orig.value : null,
      currency: orig ? orig.currency : 'cny',
      count: count,
      buyer: buyer,
      remark: col.remark != null ? dr[col.remark] : '',
      status: '未到货'
    });
  }
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
    status: '未到货'
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

// —— 链接导入：排谷表/汇总表分享直链（如 https://static.zwlhome.com/appMedia/*.xlsx）——
// 实测该类直链响应无 CORS 头（预检 405、无 Access-Control-Allow-Origin），浏览器无法直接
// fetch。候选通道依次尝试（见 netlify.toml /media-proxy /media-relay）：
//   ① /media-proxy —— Netlify 服务端转发（出海→境内，可能超时，公共代理 522 同因）
//   ② /media-relay —— ECS relay /fetch 国内中转（需 ECS 部署含 /fetch 的 relay.js）
//   ③ 直连 fetch  —— 仅当源站补 CORS 头或特殊容器环境时可用
Aoi.import.PROXY_HOSTS = ['static.zwlhome.com'];

// 直链 → 同源代理相对路径；非白名单主机 / file:// 页面返回 null（跳过代理通道）
Aoi.import.mapProxyUrl = function (url) {
  if (typeof location !== 'undefined' && location.protocol === 'file:') return null;
  var m = String(url || '').trim().match(/^https?:\/\/([^\/?#]+)\/(.+)$/);
  if (!m) return null;
  var host = m[1].toLowerCase();
  if (Aoi.import.PROXY_HOSTS.indexOf(host) < 0) return null;
  return '/media-proxy/' + host + '/' + m[2];
};

// 直链 → ECS relay 中转相对路径（白名单同 mapProxyUrl；通道未部署时由回退页/404/405 跳过）
Aoi.import.mapRelayUrl = function (url) {
  var proxied = Aoi.import.mapProxyUrl(url);
  return proxied ? proxied.replace('/media-proxy/', '/media-relay/') : null;
};

// 直链 → 设置页 relay 地址（https，如 Supabase Edge Function qq-relay）的 /fetch 通道。
// GitHub Pages 无服务端重写，前两个同源通道必然 404，此通道是 Pages / 本地环境的
// 唯一代理路径；未配置 relay 或地址非 https 时返回 null。
Aoi.import.mapEdgeUrl = function (url) {
  var relay = '';
  try { relay = (Aoi.bot && Aoi.bot.config && Aoi.bot.config.relay) || ''; } catch (e) {}
  if (!/^https:\/\//i.test(relay)) return null;
  var proxied = Aoi.import.mapProxyUrl(url);
  if (!proxied) return null;
  return relay.replace(/\/+$/, '') + proxied.replace('/media-proxy/', '/fetch/');
};

// 从链接取文件名（仅作批次名兜底，矩阵表实际以内容中的【团期】为准）
Aoi.import.fileNameFromUrl = function (url) {
  var segs = String(url || '').split(/[?#]/)[0].split('/');
  var name = segs.pop() || '';
  try { name = decodeURIComponent(name); } catch (e) { /* 保留原样 */ }
  return name || '链接导入.xlsx';
};

// 拉取链接文件：同源代理 → ECS relay → 设置页 Edge 通道 → 直连逐通道尝试；
// 全部失败返回 { error }，成功返回 { buffer, fileName, via: 'proxy'|'direct' }。
// 返回 200 的 HTML（SPA catch-all 回退页）视为通道不可用，继续下一通道；
// 每通道 20s 超时（Edge 出口偶发网关挂起，实测 ~1/6），Edge 重复入列即自动重试一次。
Aoi.import.fetchFromUrl = async function (url) {
  var u = String(url || '').trim();
  if (!/^https?:\/\//i.test(u)) return { error: '链接需以 http(s):// 开头' };
  var candidates = [];
  var proxied = Aoi.import.mapProxyUrl(u);
  if (proxied) candidates.push(proxied, proxied.replace('/media-proxy/', '/media-relay/'));
  var edge = Aoi.import.mapEdgeUrl(u);
  if (edge) candidates.push(edge, edge);
  candidates.push(u);
  var buf = null, via = null, gone404 = 0;
  for (var i = 0; i < candidates.length && !buf; i++) {
    var timer = null;
    try {
      var opts = { redirect: 'follow' };
      if (typeof AbortController !== 'undefined') {
        var ctrl = new AbortController();
        timer = setTimeout(function () { ctrl.abort(); }, 20000);
        opts.signal = ctrl.signal;
      }
      var res = await fetch(candidates[i], opts);
      if (!res.ok) {
        // 直连通道拿到明确的 404/410 → 链接本身已失效（代理 404 只说明该通道不可用）
        if (candidates[i] === u && (res.status === 404 || res.status === 410)) gone404 = res.status;
        continue;
      }
      var ct = (res.headers.get('content-type') || '').toLowerCase();
      if (ct.indexOf('text/html') >= 0) continue;
      var ab = await res.arrayBuffer();
      if (ab.byteLength >= 4) { buf = ab; via = candidates[i] === u ? 'direct' : 'proxy'; }
    } catch (e) { continue; } // 跨域 / 网络失败 / 超时 → 尝试下一通道
    finally { if (timer !== null) clearTimeout(timer); }
  }
  if (!buf) {
    if (gone404) return { error: '链接已失效（HTTP ' + gone404 + '）：该分享链接可能已被源站清理，请在源 App 重新获取，或下载文件后用上方「选择文件」导入' };
    return { error: '无法从该链接拉取表格：浏览器跨域受限，且直链代理不可用（本地打开、GitHub Pages 通道或代理构建未完成时会出现）。请从 Netlify 站点使用，或点开链接下载文件后选择文件导入' };
  }
  return { buffer: buf, fileName: Aoi.import.fileNameFromUrl(u), via: via };
};
