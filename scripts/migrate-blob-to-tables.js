#!/usr/bin/env node
// Aoi-system — 方案 C 迁移：blob → aoi_* 规范表（docs/PLAN-C-SCHEMA-SPLIT.md）
//
// 三种模式：
//   node scripts/migrate-blob-to-tables.js <backup-dir>                    # dry-run：生成 + 对账，不写库
//   node scripts/migrate-blob-to-tables.js <backup-dir> --emit <dir>       # 生成 SQL 文件供审查
//   node scripts/migrate-blob-to-tables.js <backup-dir> --apply            # 生成并经 Management API 逐条执行
//
// 纪律（P4）：--apply 前必须 dry-run 对账全绿；apply 完成后再导一次快照互验。
// 安全：脚本只 INSERT aoi_* 表，绝不触碰 team_data（旧 blob 只读保留 = 回退锚点）。
'use strict';
const fs = require('fs');
const path = require('path');

for (const envFile of ['.env', 'relay/.env']) {
  try {
    const fp = path.join(__dirname, '..', envFile);
    fs.readFileSync(fp, 'utf8').split(/\r?\n/).forEach(function (line) {
      const m = line.match(/^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*)\s*$/);
      if (m && !(m[1] in process.env)) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
    });
  } catch (e) { /* 无文件跳过 */ }
}
function projectRef() {
  if (process.env.SUPABASE_PROJECT_REF) return process.env.SUPABASE_PROJECT_REF;
  try {
    const cfg = fs.readFileSync(path.join(__dirname, '..', 'js', 'config.js'), 'utf8');
    const m = cfg.match(/SUPABASE_URL:\s*'https:\/\/([a-z0-9]+)\.supabase\.co'/);
    if (m) return m[1];
  } catch (e) { /* ignore */ }
  return null;
}

const args = process.argv.slice(2);
const srcDir = args[0];
const emitDir = args.indexOf('--emit') >= 0 ? args[args.indexOf('--emit') + 1] : null;
const APPLY = args.includes('--apply');
const RESET = args.includes('--reset');
if (!srcDir || (args.includes('--emit') && !emitDir)) {
  console.error('用法：node scripts/migrate-blob-to-tables.js <backup-dir> [--emit <dir>] [--apply]');
  process.exit(1);
}

const rows = JSON.parse(fs.readFileSync(path.join(srcDir, 'team_data.json'), 'utf8'));
if (rows.length !== 1) { console.error('[migrate] 期望 team_data 恰 1 行，实得 ' + rows.length); process.exit(1); }
const TEAM_ID = rows[0].team_id;
const blob = rows[0].data || {};

// —— 值转 SQL 字面量 ——
function toJb(v) { return "'" + JSON.stringify(v).replace(/'/g, "''") + "'::jsonb"; }
function q(v) {
  if (v && typeof v === 'object' && typeof v.__raw === 'string') return v.__raw; // toJb 片段穿透
  if (v === null || v === undefined) return 'null';
  if (typeof v === 'number') return String(v);
  if (typeof v === 'boolean') return v ? 'true' : 'false';
  if (typeof v === 'object') return "'" + JSON.stringify(v).replace(/'/g, "''") + "'::jsonb";
  return "'" + String(v).replace(/'/g, "''") + "'";
}
function cols(obj) { return Object.keys(obj).map(function (k) { return '"' + k + '"'; }).join(', '); }
function vals(obj) { return Object.keys(obj).map(function (k) { return q(obj[k]); }).join(', '); }
function insert(table, obj) {
  return 'insert into ' + table + ' (team_id, ' + cols(obj) + ') values (\'' + TEAM_ID + '\', ' + vals(obj) + ') on conflict do nothing;';
}

const statements = [];   // {table, sql}
const tally = {};        // 表名 → 生成行数（对账用）
function add(table, obj) {
  statements.push({ table: table, sql: insert(table, obj) });
  tally[table] = (tally[table] || 0) + 1;
}

// —— 1. 活动（数组顺序 = sort_order；meta 字段并入列）——
(blob.activities || []).forEach(function (name, idx) {
  const m = (blob.activityMeta || {})[name] || {};
  add('aoi_activities', {
    name: name, sort_order: idx,
    ip: m.ip || null, status: m.status || null,
    buy_date: m.buyDate || null, ship_date: m.shipDate || null, ship_date_fuzzy: m.shipDateFuzzy || null,
    deadline: m.deadline || null, link: m.link || null, cover: m.cover || null, remark: m.remark || null
  });
});
// meta 中存在但 activities 数组缺失的活动（防御：补录，sort 接尾）
Object.keys(blob.activityMeta || {}).forEach(function (name) {
  if ((blob.activities || []).indexOf(name) >= 0) return;
  const m = blob.activityMeta[name] || {};
  add('aoi_activities', {
    name: name, sort_order: (blob.activities || []).length,
    ip: m.ip || null, status: m.status || null, buy_date: m.buyDate || null, ship_date: m.shipDate || null,
    ship_date_fuzzy: m.shipDateFuzzy || null, deadline: m.deadline || null, link: m.link || null,
    cover: m.cover || null, remark: m.remark || null
  });
  console.error('[migrate] 警告：activityMeta 有而 activities 数组无 → 补录 ' + name);
});

// —— 2. 商品主档（保留 p_ id）——
Object.keys(blob.activityMeta || {}).forEach(function (name) {
  ((blob.activityMeta[name] || {}).products || []).forEach(function (p, pi) {
    add('aoi_products', {
      id: p.id, activity_name: name,
      type: p.type || null, model: p.model || null, name_orig: p.nameOrig || null,
      ref_image: p.refImage || null, ref_url: p.refUrl || null,
      price: p.price == null ? null : Number(p.price), price_orig: p.priceOrig == null ? null : Number(p.priceOrig),
      currency: p.currency || null,
      limit: p.limit == null ? null : Number(p.limit), stock: p.stock == null ? null : Number(p.stock),
      listed: p.listed ? true : null, sort: pi
    });
    // buyers / trackings（v3.34 摸底：buyers 为对象行，trackings 为字符串数组）
    ((blob.activityMeta[name] || {}).buyers || []).forEach(function (b, bi2) {
      add('aoi_activity_buyers', { activity_name: name, buyer: b.buyer || null, account: b.account || null, address: b.address || null, sort: bi2 });
    });
    ((blob.activityMeta[name] || {}).trackings || []).forEach(function (t, ti) {
      add('aoi_activity_trackings', { activity_name: name, tracking_no: typeof t === 'string' ? t : (t && t.no) || '', sort: ti });
    });
  });
});

// —— 3. 订单（保留 o_ id，数组序 = sort_order）——
(blob.orders || []).forEach(function (o, idx) {
  add('aoi_orders', {
    id: o.id, activity_name: o.activity,
    ip: o.ip || null, type: o.type || null, model: o.model || null, buyer: o.buyer || null,
    currency: o.currency || null,
    price: (o.price == null || o.price === '') ? null : Number(o.price), price_orig: (o.priceOrig == null || o.priceOrig === '') ? null : Number(o.priceOrig),
    count: (o.count == null || o.count === '') ? 1 : Number(o.count),
    status: o.status || null, remark: o.remark || null, batch_id: o.batchId || null,
    intl_fee: (o.intlFee == null || o.intlFee === '') ? null : Number(o.intlFee),
    shipped: o.shipped || null, shipped_at: o.shippedAt || null,
    shop_order_id: o.shopOrderId || null, shop_order_no: o.shopOrderNo || null,
    ai_aligned: o._aiAligned === undefined ? null : { __raw: toJb(o._aiAligned) }, sort_order: idx
  });
});

// —— 4. 批次 / 交费 / 通知 / 公告 / 改圈名 / PCO 目录 ——
(blob.batches || []).forEach(function (b, bi) {
  add('aoi_batches', {
    id: b.id, name: b.name || null, date: b.date || null,
    manual_fees: b.manualFees || null, target_amount: b.targetAmount == null ? null : Number(b.targetAmount),
    weights: b.weights || null, sort: bi
  });
});
(blob.payments || []).forEach(function (p, pi) {
  add('aoi_payments', {
    id: p.id, buyer: p.buyer || null, batch_id: p.batchId || null,
    intl_fee: (p.intlFee == null || p.intlFee === '') ? null : Number(p.intlFee),
    domestic_fee: (p.domesticFee == null || p.domesticFee === '') ? null : Number(p.domesticFee),
    status: p.status || null, sort: pi
  });
});
(blob.notifications || []).forEach(function (n, ni) {
  add('aoi_notifications', {
    id: n.id, type: n.type || null, title: n.title || null, body: n.body || null,
    buyer: n.buyer || null, batch_id: n.batchId || null, date: n.date || null,
    sent: n.sent ? true : null, sort: ni
  });
});
(blob.announcements || []).forEach(function (a, ai) {
  add('aoi_announcements', { id: a.id, date: a.date || null, text: a.text || null, sort: ai });
});
(blob.cnChanges || []).forEach(function (c, ci) {
  add('aoi_cn_changes', { id: c.id, old_cn: c.oldCn || null, new_cn: c.newCn || null, qq: c.qq || null, status: c.status || null, date: c.date || null, sort: ci });
});
(blob.pcoItems || []).forEach(function (p, pi) {
  add('aoi_pco_items', {
    id: p.id, jp_name: p.jpName || null, name: p.name || null, type: p.type || null, type_suggest: p.typeSuggest || null,
    url: p.url || null, image: p.image || null,
    price_jpy: (p.priceJpy == null || p.priceJpy === '') ? null : Number(p.priceJpy), price_cny: (p.priceCny == null || p.priceCny === '') ? null : Number(p.priceCny),
    limit: (p.limit == null || p.limit === '') ? null : Number(p.limit), sale_date: p.saleDate || null, status: p.status || null,
    selected: p.select ? true : null, watched: p.watched ? true : null,
    unmatched: p.unmatched === undefined ? null : { __raw: toJb(p.unmatched) },
    first_seen_at: p.firstSeenAt || null, sort: pi
  });
});

// —— 5. 蓄水池（池 + entries；settlements 现无数据）——
(blob.reservoirs || []).forEach(function (r, ri) {
  add('aoi_reservoirs', {
    id: r.id, name: r.name || null, side_a: r.sideA || null, side_b: r.sideB || null, rates: r.rates || null
  });
  (r.entries || []).forEach(function (e, ei) {
    add('aoi_reservoir_entries', { id: e.id, reservoir_id: r.id, order_id: e.orderId || null, side: e.side || 'A', added_at: e.addedAt || null, sort: ei });
  });
  (r.settlements || []).forEach(function (s, si) {
    add('aoi_reservoir_settlements', {
      reservoir_id: r.id, amount: s.amount == null ? null : Number(s.amount), currency: s.currency || null,
      direction: s.direction || null, note: s.note || null, marked_order_ids: s.markedOrderIds || null
    });
  });
});

// —— 6. 排谷表（slots 键 'type|model' 拆列；type 取首段防 model 含 |）——
Object.keys(blob.paigu || {}).forEach(function (act) {
  const t = blob.paigu[act] || {};
  Object.keys(t.slots || {}).forEach(function (key) {
    const parts = String(key).split('|');
    const type = parts[0] || null;
    const model = parts.slice(1).join('|') || null;
    (t.slots[key] || []).forEach(function (s, idx) {
      add('aoi_paigu_slots', {
        id: s.id, activity_name: act, type: type, model: model, sort: idx,
        order_id: s.orderId || null, buyer: s.buyer || null, status: s.status || null, added_at: s.addedAt || null
      });
    });
    if (parts.length > 2) console.error('[migrate] 警告：paigu 键含多个 |：' + act + ' / ' + key + '（type=首段，余段归 model）');
  });
  (t.log || []).forEach(function (l) {
    add('aoi_paigu_logs', { activity_name: act, at: l.at || null, text: l.text || null });
  });
  if (t.updatedAt) add('aoi_paigu_meta', { activity_name: act, updated_at: t.updatedAt });
});

// —— 7. 限购计划（payload 整体 jsonb）——
Object.keys(blob.limitPlans || {}).forEach(function (act) {
  add('aoi_limit_plans', { activity_name: act, payload: blob.limitPlans[act] });
});

// —— 8. 基础数据与设置 KV ——
Object.keys(blob.typeMeta || {}).forEach(function (t) {
  add('aoi_type_meta', { type: t, route: (blob.typeMeta[t] || {}).route || null });
});
(blob.ips || []).forEach(function (ip, idx) {
  add('aoi_ips', { ip: ip, sort: idx });
});
Object.keys(blob.memberMeta || {}).forEach(function (cn) {
  const m = blob.memberMeta[cn] || {};
  const extras = Object.assign({}, m); delete extras.qq;
  add('aoi_member_meta', { cn: cn, qq: m.qq || null, extras: extras });
});
Object.keys(blob.addresses || {}).forEach(function (cn) {
  add('aoi_addresses', { cn: cn, address: blob.addresses[cn] || null });
});
['calc', 'botConfig', 'imgHost', 'ipTypes'].forEach(function (k) {
  if (blob[k] === undefined) return;
  add('aoi_team_settings', { key: k, value: blob[k] });
});
// 无专表映射的遗留/未知键 → settings KV 兜底（组装原样输出顶层键，前向兼容）
Object.keys(blob).forEach(function (k) {
  if (['activities', 'activityMeta', 'orders', 'batches', 'payments', 'notifications', 'announcements',
       'cnChanges', 'pcoItems', 'reservoirs', 'paigu', 'limitPlans', 'typeMeta', 'memberMeta',
       'addresses', 'calc', 'botConfig', 'imgHost', 'ipTypes', 'ips'].indexOf(k) >= 0) return;
  add('aoi_team_settings', { key: k, value: blob[k] });
  console.error('[migrate] 注：无专表映射键「' + k + '」→ settings KV（' + (Array.isArray(blob[k]) ? 'array:' + blob[k].length : typeof blob[k]) + '）');
});

// —— 对账 ——
const expect = {
  aoi_activities: (blob.activities || []).length,
  aoi_products: Object.values(blob.activityMeta || {}).reduce(function (n, m) { return n + (m.products || []).length; }, 0),
  aoi_orders: (blob.orders || []).length,
  aoi_batches: (blob.batches || []).length,
  aoi_payments: (blob.payments || []).length,
  aoi_notifications: (blob.notifications || []).length,
  aoi_announcements: (blob.announcements || []).length,
  aoi_cn_changes: (blob.cnChanges || []).length,
  aoi_pco_items: (blob.pcoItems || []).length,
  aoi_reservoirs: (blob.reservoirs || []).length,
  aoi_reservoir_entries: (blob.reservoirs || []).reduce(function (n, r) { return n + (r.entries || []).length; }, 0),
  aoi_reservoir_settlements: (blob.reservoirs || []).reduce(function (n, r) { return n + (r.settlements || []).length; }, 0),
  aoi_paigu_slots: Object.values(blob.paigu || {}).reduce(function (n, t) { return n + Object.values(t.slots || {}).reduce(function (m, a) { return m + a.length; }, 0); }, 0),
  aoi_paigu_logs: Object.values(blob.paigu || {}).reduce(function (n, t) { return n + (t.log || []).length; }, 0),
  aoi_limit_plans: Object.keys(blob.limitPlans || {}).length,
  aoi_type_meta: Object.keys(blob.typeMeta || {}).length,
  aoi_ips: (blob.ips || []).length,
  aoi_member_meta: Object.keys(blob.memberMeta || {}).length,
  aoi_addresses: Object.keys(blob.addresses || {}).length
};
let allOk = true;
console.log('=== 对账（源 blob → 生成行）team_id=' + TEAM_ID + ' ===');
Object.keys(expect).forEach(function (t) {
  const ok = (tally[t] || 0) === expect[t];
  if (!ok) allOk = false;
  console.log((ok ? '  ✓ ' : '  ✗ ') + t + ': ' + (tally[t] || 0) + ' / ' + expect[t]);
});
Object.keys(tally).forEach(function (t) { if (!(t in expect)) console.log('  ？ ' + t + ': ' + tally[t] + '（计划外表，检查映射）'); });
console.log(allOk ? '=== 对账全绿 ===' : '=== 对账有差异，禁止 --apply ===');

if (APPLY && !allOk) { console.error('[migrate] 对账未全绿，拒绝执行'); process.exit(1); }

// —— 输出 ——
if (emitDir) {
  fs.mkdirSync(emitDir, { recursive: true });
  const fp = path.join(emitDir, 'migrate-blob-' + Date.now() + '.sql');
  fs.writeFileSync(fp, statements.map(function (s) { return s.sql; }).join('\n') + '\n');
  console.log('[migrate] SQL -> ' + fp + '（' + statements.length + ' 条）');
}
if (APPLY) {
  (async function () {
    const token = process.env.SUPABASE_ACCESS_TOKEN;
    const ref = projectRef();
    if (!token || !ref) { console.error('[migrate] 缺少 SUPABASE_ACCESS_TOKEN / ref'); process.exit(1); }
    let done = 0;
    if (RESET) {
      for (const t of ['aoi_activities','aoi_activity_buyers','aoi_activity_trackings','aoi_products','aoi_orders',
                       'aoi_batches','aoi_payments','aoi_notifications','aoi_announcements','aoi_cn_changes',
                       'aoi_pco_items','aoi_reservoir_entries','aoi_reservoir_settlements','aoi_reservoirs',
                       'aoi_paigu_slots','aoi_paigu_logs','aoi_limit_plans','aoi_type_meta','aoi_member_meta',
                       'aoi_addresses','aoi_team_settings']) {
        const r = await fetch('https://api.supabase.com/v1/projects/' + ref + '/database/query', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token },
          body: JSON.stringify({ query: "delete from " + t + " where team_id = '" + TEAM_ID + "';" })
        });
        if (!r.ok) { console.error('[migrate] reset 失败：' + t + ' ' + JSON.stringify(await r.json().catch(function () { return null; }))); process.exit(1); }
      }
      console.log('[migrate] --reset：已清空该团队全部 aoi_* 表');
    }
    const BATCH = 40;
    function sleep(ms) { return new Promise(function (res) { setTimeout(res, ms); }); }
    async function runSqlOnce(sql) {
      return fetch('https://api.supabase.com/v1/projects/' + ref + '/database/query', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token },
        body: JSON.stringify({ query: sql })
      });
    }
    async function runWithRetry(sql, label) {
      for (let attempt = 1; attempt <= 8; attempt++) {
        const r = await runSqlOnce(sql);
        if (r.ok) return;
        const body = await r.json().catch(function () { return null; });
        if (String(body && body.message).indexOf('Too Many Requests') >= 0 && attempt < 8) {
          await sleep(2000);
          continue;
        }
        console.error('[migrate] ' + label + ' 失败：' + JSON.stringify(body));
        process.exit(1);
      }
    }
    for (let i = 0; i < statements.length; i += BATCH) {
      const batch = statements.slice(i, i + BATCH);
      const joined = batch.map(function (s2) { return s2.sql; }).join('\n');
      await runWithRetry(joined, '第 ' + (i + 1) + '-' + (i + batch.length) + ' 条');
      done += batch.length;
      console.log('[migrate] ' + done + '/' + statements.length);
    }
    console.log('[migrate] --apply 完成：' + statements.length + ' 条 INSERT 全部成功');
  })();
} else if (!emitDir) {
  console.log('[migrate] dry-run 完成（共 ' + statements.length + ' 条 INSERT）。加 --emit <dir> 生成 SQL，或 --apply 执行。');
  console.log('[migrate] 抽样（每表首条）：');
  const seen = {};
  statements.forEach(function (s) { if (!seen[s.table]) { seen[s.table] = 1; console.log('  [' + s.table + '] ' + s.sql.slice(0, 220) + (s.sql.length > 220 ? '…' : '')); } });
}
