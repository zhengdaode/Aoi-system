// Aoi-system — blob diff 引擎（方案 C P3，docs/PLAN-C-SCHEMA-SPLIT.md §四）
//
// Aoi.blobDiff(baseline, data) → 变更集 | null（无变化）
//   baseline = 上次 aoi_get_all / 同步成功时的 blob 形状深拷贝；
//   data = 业务模块改完的内存对象。输出 aoi_sync 的 p_changes。
//
// ── 形状纪律（与 aoi_get_all / aoi_sync / 迁移脚本四处闭环，改一处须同步其余）──
//   · null ≡ undefined ≡ ''（文本空值语义同「未填」）；
//   · false ≡ undefined（可选布尔开关缺省关：sent/listed/watched/…/_aiAligned）；
//   · 数字 0 / 空数组 / 空对象有语义，原样保留；
//   · 数组集合的顺序 = 渲染序，行位置变化也算变更（upsert 带 sortOrder）；
//   · 无稳定 id 的子行（buyers/trackings/logs/entries/settlements/ips）用「整体替换」语义；
//   · 未映射顶层键自动落入 settings KV（前向兼容：未来新增 blob 键无需改 RPC）。
window.Aoi = window.Aoi || {};

Aoi.blobDiff = (function () {
  // —— 语义归一化：比较与变更检测共用 ——
  function norm(v) {
    if (v === null || v === undefined || v === '' || v === false) return null;
    if (Array.isArray(v)) return v.map(norm);
    if (typeof v === 'object') {
      var o = {};
      Object.keys(v).sort().forEach(function (k) {
        var n = norm(v[k]);
        if (n !== null) o[k] = n;
      });
      return o;
    }
    return v; // number / string / true
  }
  function eq(a, b) { return JSON.stringify(norm(a)) === JSON.stringify(norm(b)); }
  function withSort(row, i) {
    var r = {};
    Object.keys(row).forEach(function (k) { if (k !== 'sortOrder') r[k] = row[k]; });
    r.sortOrder = i;
    return r;
  }
  // 行级 diff（有稳定 id 的数组集合）：按 id 对齐，行内容或位置变化 → upsert（携带新位置）
  function diffRows(baseArr, dataArr, idKey) {
    var baseById = {};
    (baseArr || []).forEach(function (r, i) {
      if (r && r[idKey] != null) baseById[r[idKey]] = { row: r, idx: i };
    });
    var upsert = [];
    var seen = {};
    (dataArr || []).forEach(function (r, i) {
      if (!r || r[idKey] == null) return;
      seen[r[idKey]] = 1;
      var b = baseById[r[idKey]];
      if (!b || !eq(b.row, r) || b.idx !== i) upsert.push(withSort(r, i));
    });
    var del = Object.keys(baseById).filter(function (id) { return !seen[id]; });
    return (upsert.length || del.length) ? { upsert: upsert, delete: del } : null;
  }
  // 无 id 子数组：内容不同 → 整体替换（行带 sortOrder）
  function diffReplace(baseArr, dataArr) {
    return eq(baseArr, dataArr) ? null : (dataArr || []).map(function (r, i) {
      return (r && typeof r === 'object' && !Array.isArray(r)) ? withSort(r, i) : r;
    });
  }

  // —— 未映射顶层键（settings KV 兜底；calc/botConfig/imgHost/ipTypes 亦走 KV）——
  var KNOWN = {
    activities: 1, activityMeta: 1, orders: 1, batches: 1, payments: 1, notifications: 1,
    announcements: 1, cnChanges: 1, pcoItems: 1, reservoirs: 1, paigu: 1, limitPlans: 1,
    typeMeta: 1, ips: 1, memberMeta: 1, addresses: 1,
    calc: 1, botConfig: 1, imgHost: 1, ipTypes: 1
  };

  return function (base, data) {
    base = base || {};
    var ch = {
      activities: { upsert: [], delete: [] },
      orders: { upsert: [], delete: [] },
      products: { upsert: [], delete: [] },
      activityBuyers: { replace: {} },
      activityTrackings: { replace: {} },
      batches: { upsert: [], delete: [] },
      payments: { upsert: [], delete: [] },
      notifications: { upsert: [], delete: [] },
      announcements: { upsert: [], delete: [] },
      cnChanges: { upsert: [], delete: [] },
      pcoItems: { upsert: [], delete: [] },
      paiguSlots: { upsert: [], delete: [] },
      paiguLogs: { replace: {} },
      paiguMeta: { upsert: [], delete: [] },
      reservoirs: { upsert: [], delete: [] },
      reservoirEntries: { replace: {} },
      reservoirSettlements: { replace: {} },
      limitPlans: { upsert: [], delete: [] },
      typeMeta: { upsert: [], delete: [] },
      memberMeta: { upsert: [], delete: [] },
      addresses: { upsert: [], delete: [] },
      settings: { upsert: [], delete: [] }
    };

    // —— ① 活动与 activityMeta（标量行 / products 行级 / buyers·trackings 替换）——
    var baseMeta = base.activityMeta || {};
    var dataMeta = data.activityMeta || {};
    var names = {};
    Object.keys(dataMeta).forEach(function (n) { names[n] = 1; });
    Object.keys(baseMeta).forEach(function (n) { names[n] = 1; });
    var SCALARS = ['ip', 'status', 'buyDate', 'shipDate', 'shipDateFuzzy', 'deadline', 'link', 'cover', 'remark', 'createdAt', 'updatedAt'];
    Object.keys(names).forEach(function (name) {
      var b = baseMeta[name];
      var d = dataMeta[name];
      var idx = (data.activities || []).indexOf(name);
      if (!d) { // 活动被删（orders 等由业务代码另行清理；子表靠 FK 级联）
        ch.activities.delete.push(name);
        return;
      }
      var row = {
        name: name, sortOrder: idx >= 0 ? idx : 999999,
        ip: d.ip, status: d.status, buyDate: d.buyDate, shipDate: d.shipDate,
        shipDateFuzzy: d.shipDateFuzzy, deadline: d.deadline, link: d.link,
        cover: d.cover, remark: d.remark, createdAt: d.createdAt, updatedAt: d.updatedAt
      };
      if (!b) {
        ch.activities.upsert.push(row);
        (d.products || []).forEach(function (p, i) {
          if (p) { var r = withSort(p, i); r.activity = name; ch.products.upsert.push(r); }
        });
        if (!eq(b && b.buyers, d.buyers)) ch.activityBuyers.replace[name] = diffReplace(b && b.buyers, d.buyers) || [];
        if (!eq(b && b.trackings, d.trackings)) ch.activityTrackings.replace[name] = diffReplace(b && b.trackings, d.trackings) || [];
        return;
      }
      // 都有：标量任一变化（含位置变化）→ upsert 活动行
      var rowChanged = base.activities.indexOf(name) !== idx;
      for (var si = 0; si < SCALARS.length; si++) { if (!eq(b[SCALARS[si]], d[SCALARS[si]])) { rowChanged = true; break; } }
      if (rowChanged) ch.activities.upsert.push(row);
      var pch = diffRows(b.products, d.products, 'id');
      if (pch) {
        pch.upsert.forEach(function (r) { r.activity = name; ch.products.upsert.push(r); });
        pch.delete.forEach(function (id) { ch.products.delete.push(id); });
      }
      if (!eq(b.buyers, d.buyers)) ch.activityBuyers.replace[name] = diffReplace(b.buyers, d.buyers) || [];
      if (!eq(b.trackings, d.trackings)) ch.activityTrackings.replace[name] = diffReplace(b.trackings, d.trackings) || [];
    });

    // —— ② 顶层简单集合 ——
    var simple = [['orders', 'id'], ['batches', 'id'], ['payments', 'id'], ['notifications', 'id'],
                  ['announcements', 'id'], ['cnChanges', 'id'], ['pcoItems', 'id']];
    simple.forEach(function (pair) {
      var c = diffRows(base[pair[0]], data[pair[0]], pair[1]);
      if (c) { ch[pair[0]] = c; }
    });

  // —— ③ 排谷表（slots 行级跨键对齐 + logs 替换）——
  function flatSlots(act, actName) {
    var out = [];
    var slots = (act || {}).slots || {};
    Object.keys(slots).forEach(function (key) {
      var parts = String(key).split('|');
      var type = parts[0] || '';
      var model = parts.slice(1).join('|') || '';
      (slots[key] || []).forEach(function (s, i) {
        if (!s) return;
        var r = withSort(s, i);
        r.activity = actName;
        r.type = type;
        r.model = model;
        r.sort = i;
        out.push(r);
      });
    });
    return out;
  }
  var basePaigu = base.paigu || {};
  var dataPaigu = data.paigu || {};
  var pnames = {};
  Object.keys(dataPaigu).forEach(function (n) { pnames[n] = 1; });
  Object.keys(basePaigu).forEach(function (n) { pnames[n] = 1; });
  Object.keys(pnames).forEach(function (name) {
    var b = basePaigu[name];
    var d = dataPaigu[name];
    if (!d) {
      // paigu 活动键被删：slots 按 baseline 收集 id 逐个删；logs 置空
      flatSlots(b, name).forEach(function (s) { ch.paiguSlots.delete.push(s.id); });
      ch.paiguLogs.replace[name] = [];
      return;
    }
    var sch = diffRows(flatSlots(b, name), flatSlots(d, name), 'id');
    if (sch) {
      sch.upsert.forEach(function (r) { r.activity = name; ch.paiguSlots.upsert.push(r); });
      sch.delete.forEach(function (id) { ch.paiguSlots.delete.push(id); });
    }
    if (!eq(b && b.log, d.log)) ch.paiguLogs.replace[name] = (d.log || []).map(function (l, i) { return withSort(l, i); });
      if (!eq(b && b.updatedAt, d.updatedAt)) ch.paiguMeta.upsert.push({ activity: name, updatedAt: d.updatedAt || null });
  });

    // —— ④ 蓄水池（池标量行级；entries/settlements 由 replace 段负责，不参与池行比较）——
    var baseRes = base.reservoirs || [];
    var dataRes = data.reservoirs || [];
    var resBaseById = {};
    baseRes.forEach(function (r) { if (r && r.id != null) resBaseById[r.id] = r; });
    var resSeen = {};
    dataRes.forEach(function (r) {
      if (!r || r.id == null) return;
      resSeen[r.id] = 1;
      var b = resBaseById[r.id];
      if (!b) {
        ch.reservoirs.upsert.push(withSort(r, 0));
        if ((r.entries || []).length) ch.reservoirEntries.replace[r.id] = diffReplace(null, r.entries) || [];
        if ((r.settlements || []).length) ch.reservoirSettlements.replace[r.id] = diffReplace(null, r.settlements) || [];
        return;
      }
      if (!eq({ name: b.name, sideA: b.sideA, sideB: b.sideB, rates: b.rates },
              { name: r.name, sideA: r.sideA, sideB: r.sideB, rates: r.rates })) {
        var row = withSort(r, 0);
        delete row.entries;
        delete row.settlements;
        ch.reservoirs.upsert.push(row);
      }
      if (!eq(b.entries, r.entries)) ch.reservoirEntries.replace[r.id] = diffReplace(b.entries, r.entries) || [];
      if (!eq(b.settlements, r.settlements)) ch.reservoirSettlements.replace[r.id] = diffReplace(b.settlements, r.settlements) || [];
    });
    Object.keys(resBaseById).forEach(function (id) {
      if (!resSeen[id]) ch.reservoirs.delete.push(id);
    });

    // —— ⑤ limitPlans / typeMeta / memberMeta / addresses（键值对象）——
    // limitPlans
    (function () {
      var keys = {};
      Object.keys(data.limitPlans || {}).forEach(function (k) { keys[k] = 1; });
      Object.keys(base.limitPlans || {}).forEach(function (k) { keys[k] = 1; });
      Object.keys(keys).forEach(function (k) {
        var b = (base.limitPlans || {})[k];
        var d = (data.limitPlans || {})[k];
        if (d === undefined) ch.limitPlans.delete.push(k);
        else if (!eq(b, d)) ch.limitPlans.upsert.push({ activity: k, payload: d });
      });
    })();
    // typeMeta
    (function () {
      var keys = {};
      Object.keys(data.typeMeta || {}).forEach(function (k) { keys[k] = 1; });
      Object.keys(base.typeMeta || {}).forEach(function (k) { keys[k] = 1; });
      Object.keys(keys).forEach(function (k) {
        var b = (base.typeMeta || {})[k];
        var d = (data.typeMeta || {})[k];
        if (d === undefined) ch.typeMeta.delete.push(k);
        else if (!eq(b, d)) ch.typeMeta.upsert.push({ type: k, route: (d || {}).route });
      });
    })();
    // memberMeta（qq 显式列，其余进 extras）
    (function () {
      var keys = {};
      Object.keys(data.memberMeta || {}).forEach(function (k) { keys[k] = 1; });
      Object.keys(base.memberMeta || {}).forEach(function (k) { keys[k] = 1; });
      Object.keys(keys).forEach(function (k) {
        var b = (base.memberMeta || {})[k];
        var d = (data.memberMeta || {})[k];
        if (d === undefined) ch.memberMeta.delete.push(k);
        else if (!eq(b, d)) {
          var extras = {};
          Object.keys(d || {}).forEach(function (kk) { if (kk !== 'qq') extras[kk] = d[kk]; });
          ch.memberMeta.upsert.push({ cn: k, qq: (d || {}).qq, extras: extras });
        }
      });
    })();
    // addresses
    (function () {
      var keys = {};
      Object.keys(data.addresses || {}).forEach(function (k) { keys[k] = 1; });
      Object.keys(base.addresses || {}).forEach(function (k) { keys[k] = 1; });
      Object.keys(keys).forEach(function (k) {
        var b = (base.addresses || {})[k];
        var d = (data.addresses || {})[k];
        if (d === undefined) ch.addresses.delete.push(k);
        else if (!eq(b, d)) ch.addresses.upsert.push({ cn: k, address: d });
      });
    })();
    // ips（无 id 字符串数组 → 替换）
    if (!eq(base.ips, data.ips)) ch.settings.upsert.push({ key: 'ips', value: data.ips || [] });
    // —— ⑥ settings KV：calc/botConfig/imgHost/ipTypes + 一切未映射顶层键 ——
    var keys = {};
    Object.keys(data).forEach(function (k) { if (!KNOWN[k]) keys[k] = 1; });
    Object.keys(base).forEach(function (k) { if (!KNOWN[k]) keys[k] = 1; });
    ['calc', 'botConfig', 'imgHost', 'ipTypes'].forEach(function (k) { keys[k] = 1; });
    Object.keys(keys).forEach(function (k) {
      var b = base[k];
      var d = data[k];
      if (d === undefined) ch.settings.delete.push(k);
      else if (!eq(b, d)) ch.settings.upsert.push({ key: k, value: d });
    });

    // —— 裁空：全空返回 null ——
    var any = false;
    Object.keys(ch).forEach(function (k) {
      var c = ch[k];
      var has = (c.upsert && c.upsert.length) || (c.delete && c.delete.length) ||
                (c.replace && Object.keys(c.replace).length);
      if (!has) delete ch[k]; else any = true;
    });
    return any ? ch : null;
  };
})();
