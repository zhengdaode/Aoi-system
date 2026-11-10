#!/usr/bin/env node
// Aoi-system — 方案 C P3 终验：aoi_get_all 组装结果 vs 备份 blob 语义深比较
// 归一化规则与 blob-diff.js / 组装 RPC 三处一致：null≡undefined≡''、false≡undefined、对象键序无关、数组有序。
// 用法：node scripts/verify-assemble.js <backup-dir>
'use strict';
const fs = require('fs');
const path = require('path');

const dir = process.argv[2];
if (!dir) { console.error('用法：node scripts/verify-assemble.js <backup-dir>'); process.exit(1); }
const blob = JSON.parse(fs.readFileSync(path.join(dir, 'team_data.json'), 'utf8'))[0].data;
const assembled = JSON.parse(fs.readFileSync(path.join(dir, 'assembled.json'), 'utf8')).data;

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
  return v;
}

var diffs = 0;
function walk(a, b, p) {
  var na = norm(a), nb = norm(b);
  if (JSON.stringify(na) === JSON.stringify(nb)) return;
  if (na && nb && typeof na === 'object' && typeof nb === 'object' && Array.isArray(na) && Array.isArray(nb)) {
    var n = Math.max(na.length, nb.length);
    for (var i = 0; i < n; i++) walk((a || [])[i], (b || [])[i], p + '[' + i + ']');
    return;
  }
  if (na && nb && typeof na === 'object' && typeof nb === 'object' && !Array.isArray(na) && !Array.isArray(nb)) {
    Object.keys(na).forEach(function (k) { walk((a || {})[k], (b || {})[k], p + '.' + k); });
    Object.keys(nb).forEach(function (k) { if (!(k in na)) walk(undefined, (b || {})[k], p + '.' + k); });
    return;
  }
  diffs++;
  if (diffs <= 40) {
    console.log('✗ ' + p);
    console.log('   blob: ' + JSON.stringify(na).slice(0, 160));
    console.log('   aoi : ' + JSON.stringify(nb).slice(0, 160));
  } else {
    console.log('✗ ' + p + '（更多差异省略）');
  }
}

console.log('=== 形状对拍：备份 blob vs aoi_get_all 组装 ===');
// 顶层键集合
var keys = {};
Object.keys(blob).forEach(function (k) { keys[k] = 1; });
Object.keys(assembled).forEach(function (k) { keys[k] = 1; });
Object.keys(keys).forEach(function (k) {
  var inB = k in blob, inA = k in assembled;
  if (inB && !inA) { diffs++; console.log('✗ 顶层键缺失：' + k); }
  else if (!inB && inA) { diffs++; console.log('✗ 组装多出键：' + k + ' = ' + JSON.stringify(assembled[k]).slice(0, 80)); }
});
function stripPaigu(p) {
  var out = {};
  Object.keys(p || {}).forEach(function (act) {
    var slots = {};
    Object.keys((p[act] || {}).slots || {}).forEach(function (key) {
      if (((p[act] || {}).slots || {})[key] && ((p[act] || {}).slots || {})[key].length) slots[key] = p[act].slots[key];
    });
    var entry = { slots: slots, log: p[act].log || [] };
    if (p[act].updatedAt) entry.updatedAt = p[act].updatedAt;
    if (Object.keys(slots).length || (p[act].log || []).length || p[act].updatedAt) out[act] = entry;
  });
  return out;
}
function fillChildren(meta) {
  var out = {};
  Object.keys(meta || {}).forEach(function (name) {
    var m = meta[name] || {};
    out[name] = Object.assign({}, m, {
      products: m.products || [], buyers: m.buyers || [], trackings: m.trackings || []
    });
  });
  return out;
}
var blobV = Object.assign({}, blob, { paigu: stripPaigu(blob.paigu), activityMeta: fillChildren(blob.activityMeta) });
var asmV = Object.assign({}, assembled, { paigu: stripPaigu(assembled.paigu), activityMeta: fillChildren(assembled.activityMeta) });
Object.keys(blobV).forEach(function (k) { if (k in asmV) walk(blobV[k], asmV[k], k); });
if (diffs === 0) console.log('=== 全绿：组装结果与备份 blob 语义等价（' + Object.keys(blob).length + ' 顶层键）===');
else { console.log('=== 共 ' + diffs + ' 处差异 ==='); process.exit(1); }
