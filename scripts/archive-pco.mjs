#!/usr/bin/env node
// PCO「已存目录」下线数据脚本（v3.15.0 S7 / 决策 D1 已批准：删数据 + 代码归档 + 后续可重新访问）。
// 把 blob 中的 d.pcoItems / d.catalogConfig 快照到本地 archives/ 后，可从线上数据删除两键。
// 「已存目录」UI 与写入代码已随 v3.15.0 下线（git 历史即代码归档）；本脚本负责数据面：
//   · 默认 dry-run：拉取 blob → 落本地快照 → 打印统计，不改线上
//   · --apply：从线上数据删除两键后写回（写回前服务端自动存档旧版 blob，
//     设置页「数据备份与恢复 → 历史快照」保留近 30 天，同样可恢复）
//   · --restore <archives/xxx.json>：把本地快照合并回 blob（后续要重新访问/重启监控时用）
// 用法：
//   AOI_ADMIN_TOKEN=<token> node scripts/archive-pco.mjs                       # dry-run
//   AOI_ADMIN_TOKEN=<token> node scripts/archive-pco.mjs --apply
//   AOI_ADMIN_TOKEN=<token> node scripts/archive-pco.mjs --restore archives/pcoItems-2026-09-13.json
// token 获取：浏览器登录 Aoi → F12 控制台 → copy(JSON.parse(localStorage.getItem("aoi_admin_session")).token)
'use strict';
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const cfg = readFileSync(resolve(ROOT, 'js/config.js'), 'utf8');
const url = (cfg.match(/https:\/\/[a-z0-9.-]+\.supabase\.co/i) || [])[0];
const anon = (cfg.match(/SUPABASE_ANON_KEY\s*:\s*'([^']+)'/) || [])[1];
const token = process.env.AOI_ADMIN_TOKEN || '';
const apply = process.argv.includes('--apply');
const restoreIdx = process.argv.indexOf('--restore');
const restoreFile = restoreIdx >= 0 ? process.argv[restoreIdx + 1] : null;

if (!url || !anon) { console.error('js/config.js 缺少 SUPABASE_URL / SUPABASE_ANON_KEY'); process.exit(1); }
if (!token) {
  console.error('用法：AOI_ADMIN_TOKEN=<admin token> node scripts/archive-pco.mjs [--apply | --restore <file>]\n' +
    'token 获取：浏览器登录 Aoi → F12 控制台 → copy(JSON.parse(localStorage.getItem("aoi_admin_session")).token)');
  process.exit(1);
}

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

const got = blobOf(await rpc('admin_get_team_data', { p_token: token }));
const d = (got && typeof got === 'object' && got.data != null) ? blobOf(got.data) : (got || {});
const updatedAt = (got && got.updatedAt) || null;

// —— 恢复：本地快照合并回线上 ——
if (restoreFile) {
  if (!existsSync(restoreFile)) { console.error('快照文件不存在：' + restoreFile); process.exit(1); }
  const snap = JSON.parse(readFileSync(restoreFile, 'utf8'));
  if (Array.isArray(d.pcoItems) && d.pcoItems.length) {
    console.error('线上已有 pcoItems（' + d.pcoItems.length + ' 条），为避免覆盖请先核对'); process.exit(1);
  }
  d.pcoItems = snap.pcoItems || [];
  if (snap.catalogConfig) d.catalogConfig = snap.catalogConfig;
  const r = await rpc('admin_save_team_data', { p_token: token, p_data: d, p_expected_updated_at: updatedAt });
  console.log('已恢复：pcoItems ' + d.pcoItems.length + ' 条' + (snap.catalogConfig ? ' + catalogConfig' : '') + '（新版本：' + r + '）');
  process.exit(0);
}

// —— 归档（+ 可选删除）——
const items = Array.isArray(d.pcoItems) ? d.pcoItems : [];
const catalogCfg = d.catalogConfig || null;
if (!items.length && !catalogCfg) { console.log('线上无 pcoItems / catalogConfig，无需处理'); process.exit(0); }

mkdirSync(resolve(ROOT, 'archives'), { recursive: true });
const date = new Date().toISOString().slice(0, 10);
const file = resolve(ROOT, 'archives', 'pcoItems-' + date + '.json');
writeFileSync(file, JSON.stringify({
  archivedAt: new Date().toISOString(),
  pcoItems: items,
  catalogConfig: catalogCfg
}, null, 2), 'utf8');
const kb = (JSON.stringify(items).length / 1024).toFixed(1);
console.log('快照已写入 archives/' + file.split(/[\\/]/).pop() + '（pcoItems ' + items.length + ' 条，约 ' + kb + ' KB' + (catalogCfg ? ' + catalogConfig' : '') + '）');

if (!apply) {
  console.log('dry-run 结束——确认后加 --apply 从线上数据删除（写回前服务端自动存档旧版；重新访问用 --restore ' + file.split(/[\\/]/).pop() + '）');
  process.exit(0);
}
delete d.pcoItems;
delete d.catalogConfig;
const r2 = await rpc('admin_save_team_data', { p_token: token, p_data: d, p_expected_updated_at: updatedAt });
console.log('已从线上数据删除 pcoItems/catalogConfig（新版本：' + r2 + '）。重新访问：node scripts/archive-pco.mjs --restore archives/' + file.split(/[\\/]/).pop());
