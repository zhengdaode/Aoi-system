#!/usr/bin/env node
// 活动订单补充工具（v3.9.1）：把排谷表 App 导出的「排表详情」xlsx 与库内指定活动的
// 订单对账，补齐缺失订单 / 修正数量（xlsx 为准）/ 回填缺失单价——只补不删，供手动数据补充。
// 解析复用本站 Aoi.import.parse（jsdom 装载 js/import.js），字段口径与页内「链接导入」完全一致。
//
// 用法：
//   1) 浏览器登录 Aoi → F12 控制台执行：copy(JSON.parse(localStorage.getItem('aoi_admin_session')).token)
//   2) AOI_ADMIN_TOKEN=<token> node scripts/supplement-activity.mjs <活动名> <排谷表.xlsx>    # dry-run 预览
//   3) 核对输出无误后加 --apply 写回（写回前服务端自动存档旧版 blob，可经 B1 历史快照恢复）
//
// 合并口径：
//   键 = 购买人|制品类型|型号（与订单归属一致）
//   · 库内没有的组合 → 新增订单（件数=排表该商品列中该购买人的格数）
//   · 库内已有的组合 → 件数对齐排表（数量以最新排表为准）；单价只在库内缺失时回填，不一致仅报告不覆盖
//   · 库内多出的组合 → 保留不动，仅列出供人工核对
//   · 活动商品主档（activityMeta[活动].products）按 type|model 只补缺（带排表单价，参考图/链接留空）
'use strict';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { JSDOM } from 'jsdom';

const require2 = createRequire(import.meta.url);
const XLSX = require2('xlsx');
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

const cfg = readFileSync(resolve(ROOT, 'js/config.js'), 'utf8');
const url = (cfg.match(/https:\/\/[a-z0-9.-]+\.supabase\.co/i) || [])[0];
const anon = (cfg.match(/SUPABASE_ANON_KEY\s*:\s*'([^']+)'/) || [])[1];
const token = process.env.AOI_ADMIN_TOKEN || '';
const name = (process.argv[2] || '').trim();
const file = process.argv[3] || '';
const apply = process.argv.includes('--apply');

if (!url || !anon) { console.error('js/config.js 缺少 SUPABASE_URL / SUPABASE_ANON_KEY'); process.exit(1); }
if (!name || !file || !token) {
  console.error('用法：AOI_ADMIN_TOKEN=<admin token> node scripts/supplement-activity.mjs <活动名> <排谷表.xlsx> [--apply]\n' +
    'token 获取：浏览器登录 Aoi → F12 控制台 → copy(JSON.parse(localStorage.getItem("aoi_admin_session")).token)');
  process.exit(1);
}

// —— jsdom harness：与 tests/helpers/aoi.js 同法装载，复用 Aoi.import.parse ——
const dom = new JSDOM(readFileSync(resolve(ROOT, 'index.html'), 'utf8'), {
  runScripts: 'outside-only',
  url: 'https://aoi.local/'
});
const w = dom.window;
w.XLSX = XLSX;
for (const m of ['js/core.js', 'js/import.js']) w.eval(readFileSync(resolve(ROOT, m), 'utf8'));
const Aoi = w.Aoi;

async function rpc(fn, body) {
  const r = await fetch(url + '/rest/v1/rpc/' + fn, {
    method: 'POST',
    headers: { apikey: anon, Authorization: 'Bearer ' + anon, 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });
  const t = await r.text();
  if (!r.ok) throw new Error(fn + ' HTTP ' + r.status + ': ' + t.slice(0, 300));
  const j = t ? JSON.parse(t) : null;
  if (j && typeof j === 'object' && !Array.isArray(j) && typeof j.error === 'string') throw new Error(fn + ': ' + j.error);
  return j;
}
const blobOf = (x) => {
  if (x == null) return x;
  if (typeof x === 'string') return JSON.parse(x);
  if (typeof x === 'object' && x.data != null && (Array.isArray(x.data) || typeof x.data === 'object')) {
    return typeof x.data === 'string' ? JSON.parse(x.data) : x.data;
  }
  return x;
};

// —— 1. 解析排谷表 ——
const buf = readFileSync(file);
const ab = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
const records = Aoi.import.parse(ab, file);
if (!records.length) { console.error('未从 xlsx 解析出订单（需「排表详情」矩阵：谷子行 + 单价行 + 每格购买人）'); process.exit(1); }
const detected = Aoi.import.detectActivity(records);
if (detected && detected !== name) console.log('提示：文件内团期为「' + detected + '」，按参数写入活动「' + name + '」');
records.forEach(function (r) { r.activity = name; r.currency = 'cny'; r.remark = r.remark || ''; r.batchId = null; });

// 聚合到 购买人|类型|型号
const R2 = (n) => Math.round(n * 100) / 100;
const keyOf = (r) => r.buyer + '|' + r.type + '|' + r.model;
const plan = new Map();
for (const r of records) {
  if (!plan.has(keyOf(r))) plan.set(keyOf(r), { buyer: r.buyer, type: r.type, model: r.model, count: 0, price: 0 });
  const g = plan.get(keyOf(r));
  g.count += r.count || 1;
  if (!g.price && r.price) g.price = R2(r.price);
}
console.log('解析排谷表：' + records.length + ' 格 → ' + plan.size + ' 组（购买人×商品），共 ' +
  [...plan.values()].reduce((s, g) => s + g.count, 0) + ' 件，涉及购买人 ' + new Set(records.map(r => r.buyer)).size + ' 位\n');

// —— 2. 读库对账 ——
const curResp = await rpc('admin_get_team_data', { p_token: token });
const updatedAt = curResp && typeof curResp === 'object' && curResp.updated_at != null ? curResp.updated_at : null;
const cur = blobOf(curResp);
const actOrders = (cur.orders || []).filter(o => o.activity === name);
console.log('库内活动「' + name + '」现有订单 ' + actOrders.length + ' 笔（全库 ' + (cur.orders || []).length + ' 笔）\n');

const dbMap = new Map();
for (const o of actOrders) {
  const k = (o.buyer || '') + '|' + (o.type || '') + '|' + (o.model || '');
  if (!dbMap.has(k)) dbMap.set(k, { total: 0, first: o, extras: [] });
  const g = dbMap.get(k);
  g.total += o.count || 0;
  if (o !== g.first) g.extras.push(o);
}

const adds = [], updates = [], keeps = [];
for (const [k, g] of plan) {
  const db = dbMap.get(k);
  if (!db) { adds.push(g); continue; }
  const changes = [];
  if (db.total !== g.count) changes.push('数量 ' + db.total + ' → ' + g.count);
  if (!db.first.price && g.price) changes.push('回填单价 ' + g.price);
  if (g.price && db.first.price && db.first.price !== g.price) changes.push('⚠ 单价不一致：库 ' + db.first.price + ' / 表 ' + g.price + '（不覆盖）');
  if (changes.length) updates.push({ g, db, changes });
  else keeps.push(g);
}
const dbOnly = [...dbMap.keys()].filter(k => !plan.has(k));

console.log('—— 计划（合并口径见文件头注释）——');
console.log('+ 新增 ' + adds.length + ' 组：');
adds.forEach(g => console.log('   + ' + g.buyer + '｜' + g.type + '|' + g.model + ' ×' + g.count + '（单价 ' + g.price + '）'));
console.log('~ 更新 ' + updates.length + ' 组：');
updates.forEach(u => console.log('   ~ ' + u.g.buyer + '｜' + u.g.type + '|' + u.g.model + '：' + u.changes.join('，')));
console.log('= 一致 ' + keeps.length + ' 组（不动）');
console.log('⚠ 库内多出 ' + dbOnly.length + ' 组（保留不动，请人工核对是否应删）：');
dbOnly.forEach(k => console.log('   ? ' + k.split('|').join('｜') + ' ×' + dbMap.get(k).total));

// —— 3. 商品主档只补缺 ——
const meta = (cur.activityMeta || {})[name] || { products: [], buyers: [], trackings: [] };
const haveKey = new Set((meta.products || []).map(p => p.type + '|' + p.model));
const newProducts = [];
for (const g of plan.values()) {
  const k = g.type + '|' + g.model;
  if (!haveKey.has(k)) {
    newProducts.push({ id: Aoi.genId(), type: g.type, model: g.model, refImage: '', refUrl: '', price: g.price || undefined });
    haveKey.add(k);
  }
}
if (newProducts.length) {
  console.log('\n商品主档补登 ' + newProducts.length + ' 件（只补缺，参考图/链接留空）：');
  newProducts.forEach(p => console.log('   + ' + p.type + '|' + p.model + '（单价 ' + (p.price == null ? '—' : p.price) + '）'));
} else {
  console.log('\n商品主档无需补登');
}
if (dbOnly.length || updates.some(u => u.changes.some(c => c.indexOf('⚠') >= 0))) {
  console.log('\n⚠ 存在需人工核对的项（见上），确认无误再 --apply');
}

if (!apply) {
  console.log('\n（dry-run 预览，未写回。核对无误后加 --apply 执行；写回前服务端自动存档，可经 B1 历史快照恢复）');
  process.exit(0);
}

// —— 4. 写回 ——
const merged = JSON.parse(JSON.stringify(cur));
if ((merged.activities || []).indexOf(name) < 0) merged.activities.push(name);
let addOrders = 0, updOrders = 0;
for (const g of adds) {
  merged.orders.push({
    id: Aoi.genId(), ip: '', activity: name, type: g.type, model: g.model,
    price: g.price, priceOrig: null, currency: 'cny', count: g.count,
    buyer: g.buyer, remark: '', status: '未到货', batchId: null
  });
  addOrders++;
}
for (const u of updates) {
  u.db.first.count = u.g.count;                                   // 件数以排表为准
  if (!u.db.first.price && u.g.price) u.db.first.price = u.g.price; // 单价只补缺
  updOrders++;
  if (u.db.extras.length) console.log('⚠ 键重复的库内订单保持原样（人工核对）：' + u.g.buyer + '｜' + u.g.type + '|' + u.g.model + ' 另有 ' + u.db.extras.length + ' 笔');
}
merged.activityMeta = merged.activityMeta || {};
const curMeta = merged.activityMeta[name] || { products: [], buyers: [], trackings: [] };
curMeta.products = curMeta.products || [];
newProducts.forEach(p => curMeta.products.push(JSON.parse(JSON.stringify(p))));
merged.activityMeta[name] = curMeta;

const saved = await rpc('admin_save_team_data', { p_token: token, p_data: merged, p_expected_updated_at: updatedAt });
console.log('\n✅ 已写回：新增订单 ' + addOrders + ' 笔 / 更新 ' + updOrders + ' 笔 / 补登商品 ' + newProducts.length + ' 件。保存返回：' + JSON.stringify(saved).slice(0, 120));
console.log('请刷新 Aoi 页面核对订单管理 / 活动管理 / 汇总表导出。');
