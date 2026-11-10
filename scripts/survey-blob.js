// Aoi-system — blob 深度结构摸底（方案 C DDL 输入）：对备份 JSON 统计每个子集合的字段集合与样本值型别
// 用法：node scripts/survey-blob.js <backup-dir> > <输出文件>
'use strict';
const fs = require('fs');
const path = require('path');

const dir = process.argv[2];
const data = JSON.parse(fs.readFileSync(path.join(dir, 'team_data.json'), 'utf8'));
const blob = data[0].data;

function fieldSet(arr, label) {
  const s = {};
  (arr || []).forEach(function (o) { Object.keys(o || {}).forEach(function (k) { s[k] = (s[k] || 0) + 1; }); });
  console.log('## ' + label + '  (n=' + (arr || []).length + ')');
  Object.keys(s).sort().forEach(function (k) { console.log('  ' + k + ': ' + s[k]); });
}
function sample(v, label) {
  console.log('## ' + label);
  console.log(JSON.stringify(v, null, 1).slice(0, 1600));
}

fieldSet(blob.activityMeta ? Object.values(blob.activityMeta).flatMap(function (m) { return m.products || []; }) : [], 'activityMeta[].products（全部活动商品合并）');
fieldSet(blob.activityMeta ? Object.values(blob.activityMeta).flatMap(function (m) { return m.buyers || []; }) : [], 'activityMeta[].buyers');
fieldSet(blob.activityMeta ? Object.values(blob.activityMeta).flatMap(function (m) { return m.trackings || []; }) : [], 'activityMeta[].trackings');
// 活动级字段（各键出现于多少活动）
const metas = Object.values(blob.activityMeta || {});
const ms = {};
metas.forEach(function (m) { Object.keys(m || {}).forEach(function (k) { ms[k] = (ms[k] || 0) + 1; }); });
console.log('## activityMeta 活动级字段（出现于 ' + metas.length + ' 活动中）');
Object.keys(ms).sort().forEach(function (k) { console.log('  ' + k + ': ' + ms[k]); });

fieldSet(blob.payments, 'payments');
fieldSet(blob.batches, 'batches');
fieldSet(blob.notifications, 'notifications');
fieldSet(blob.announcements, 'announcements');
fieldSet(blob.cnChanges, 'cnChanges');
fieldSet(blob.pcoItems, 'pcoItems');
fieldSet(blob.warehouses, 'warehouses');
fieldSet(blob.transfers, 'transfers');
// reservoirs 是嵌套结构
console.log('## reservoirs 池级字段 (n=' + blob.reservoirs.length + ')');
const rs = {};
blob.reservoirs.forEach(function (r) { Object.keys(r || {}).forEach(function (k) { rs[k] = (rs[k] || 0) + 1; }); });
Object.keys(rs).sort().forEach(function (k) { console.log('  ' + k + ': ' + rs[k]); });
const firstRes = blob.reservoirs[0] || {};
if (firstRes.entries) fieldSet(firstRes.entries, 'reservoirs[0].entries');
if (firstRes.settlements) fieldSet(firstRes.settlements, 'reservoirs[0].settlements');
// paigu
console.log('## paigu 活动级字段 (n=' + Object.keys(blob.paigu).length + ')');
Object.keys(blob.paigu).forEach(function (a) {
  const t = blob.paigu[a];
  console.log('  ' + a + ': slots(' + Object.keys(t.slots || {}).length + ' 商品键, ' + Object.values(t.slots || {}).reduce(function (n, arr) { return n + arr.length; }, 0) + ' 排位) log(' + (t.log || []).length + ')');
});
const firstPaigu = Object.values(blob.paigu)[0] || {};
const firstSlotArr = Object.values(firstPaigu.slots || {})[0] || [];
fieldSet(firstSlotArr, 'paigu slots 排位字段（首个商品键样本）');
// limitPlans
console.log('## limitPlans (n=' + Object.keys(blob.limitPlans).length + ')');
const lp0 = Object.values(blob.limitPlans)[0] || {};
console.log('  计划级字段:', Object.keys(lp0).join(', '));
if (lp0.items && lp0.items.length) fieldSet(lp0.items, 'limitPlans[].items');
// 其余 object 键直接打样本
sample(blob.calc, 'calc');
sample(blob.botConfig, 'botConfig');
sample(blob.memberMeta, 'memberMeta');
sample(blob.addresses, 'addresses');
sample(blob.typeMeta, 'typeMeta（截断）');
console.log('## ips'); console.log(JSON.stringify(blob.ips));
console.log('## imgHost'); console.log(JSON.stringify(blob.imgHost));
console.log('## ipTypes'); console.log(JSON.stringify(blob.ipTypes));
console.log('## products（顶层，应为遗留空数组）'); console.log(JSON.stringify(blob.products));
// orders 状态分布
const st = {};
blob.orders.forEach(function (o) { st[o.status] = (st[o.status] || 0) + 1; });
console.log('## orders.status 分布'); console.log(JSON.stringify(st));
const sh = {};
blob.orders.forEach(function (o) { sh[o.shipped || 'null'] = (sh[o.shipped || 'null'] || 0) + 1; });
console.log('## orders.shipped 分布'); console.log(JSON.stringify(sh));
