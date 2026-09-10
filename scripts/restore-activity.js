#!/usr/bin/env node
// 活动恢复工具（v3.8.0 F9 收尾）：从 B1 历史快照找回被删活动的订单/商品/购买人/限购计划，
// 只外科式合并该活动的数据到当前 blob（不整卷回滚，避免覆盖删除之后的其他改动）。
// 用法：
//   1) 浏览器登录 Aoi → F12 控制台执行：copy(JSON.parse(localStorage.getItem('aoi_admin_session')).token)
//   2) AOI_ADMIN_TOKEN=<token> node scripts/restore-activity.js <活动名>            # 预览（dry-run）
//   3) 核对输出无误后加 --apply 写回
'use strict';
const fs = require('fs');
const path = require('path');

const cfg = fs.readFileSync(path.join(__dirname, '..', 'js', 'config.js'), 'utf8');
const url = (cfg.match(/https:\/\/[a-z0-9.-]+\.supabase\.co/i) || [])[0];
const anon = (cfg.match(/eyJ[A-Za-z0-9_-]{20,}/) || [])[0];
const token = process.env.AOI_ADMIN_TOKEN || '';
const name = process.argv[2] || '';
const apply = process.argv.includes('--apply');
const limit = parseInt(process.env.LIMIT || '50', 10);

if (!url || !anon) { console.error('js/config.js 缺少 SUPABASE_URL / ANON_KEY'); process.exit(1); }
if (!token || !name) {
  console.error('用法：AOI_ADMIN_TOKEN=<admin token> node scripts/restore-activity.js <活动名> [--apply]\n' +
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
// RPC 返回可能是 {data, updated_at} 包装、纯 blob、或 JSON 字符串——统一取 blob
const blobOf = (x) => {
  if (x == null) return x;
  if (typeof x === 'string') return JSON.parse(x);
  if (typeof x === 'object' && x.data != null && (Array.isArray(x.data) || typeof x.data === 'object')) {
    return typeof x.data === 'string' ? JSON.parse(x.data) : x.data;
  }
  return x;
};

(async () => {
  const curResp = await rpc('admin_get_team_data', { p_token: token });
  const updatedAt = curResp && typeof curResp === 'object' && curResp.updated_at != null ? curResp.updated_at : null;
  const cur = blobOf(curResp);
  console.log('当前数据：订单 ' + (cur.orders || []).length + ' 笔，活动 ' + (cur.activities || []).length + ' 个');

  const list = await rpc('admin_list_team_data_history', { p_token: token, p_limit: limit });
  const rows = Array.isArray(list) ? list : (list.rows || list.items || []);
  console.log('历史快照：' + rows.length + ' 份（LIMIT=' + limit + '，不够可加大）\n');

  const hits = [];
  for (const row of rows) {
    let snap;
    try {
      snap = blobOf(await rpc('admin_get_team_data_history', { p_token: token, p_id: row.id }));
    } catch (e) { console.log('跳过快照 id=' + row.id + '：' + e.message); continue; }
    if (!snap || !snap.orders) continue;
    const n = snap.orders.filter(o => o.activity === name).length;
    const hasMeta = !!(snap.activityMeta && snap.activityMeta[name]);
    if (n || hasMeta) {
      hits.push({ row, snap });
      console.log('命中 id=' + row.id + '  savedAt=' + (row.saved_at || '?') + '  source=' + (row.source || '?') +
        '  → 订单 ' + n + ' 笔，商品 ' + (((snap.activityMeta[name] || {}).products) || []).length + ' 件');
    }
  }
  if (!hits.length) { console.error('\n所有快照中都没找到「' + name + '」——确认活动名，或加大 LIMIT 重试'); process.exit(1); }

  const { row: bestRow, snap: src } = hits[0]; // 最新命中
  const sOrders = src.orders.filter(o => o.activity === name);
  const sMeta = (src.activityMeta || {})[name] || { products: [], buyers: [] };
  const sPlan = src.limitPlans && src.limitPlans[name];
  console.log('\n将按最新命中快照 id=' + bestRow.id + '（' + (bestRow.saved_at || '?') + '）恢复：' +
    '订单 ' + sOrders.length + ' 笔 / 商品 ' + (sMeta.products || []).length + ' 件 / 购买人 ' + (sMeta.buyers || []).length + ' 位' +
    (sPlan ? ' / 限购计划 1 份' : ''));

  if (!apply) { console.log('\n（dry-run 预览，未写回。核对无误后加 --apply 执行恢复）'); return; }

  const merged = JSON.parse(JSON.stringify(cur));
  if ((merged.activities || []).indexOf(name) < 0) merged.activities.push(name);
  const haveOrder = {};
  (merged.orders || []).forEach(o => { haveOrder[o.id] = 1; });
  let addOrders = 0;
  sOrders.forEach(o => { if (!haveOrder[o.id]) { merged.orders.push(o); addOrders++; } });
  merged.activityMeta = merged.activityMeta || {};
  const curMeta = merged.activityMeta[name] || { products: [], buyers: [], trackings: [] };
  const haveKey = {};
  (curMeta.products || []).forEach(p => { haveKey[p.type + '|' + p.model] = 1; });
  let addProducts = 0;
  (sMeta.products || []).forEach(p => {
    if (!haveKey[p.type + '|' + p.model]) { curMeta.products.push(p); addProducts++; }
  });
  const haveBuyer = {};
  (curMeta.buyers || []).forEach(b => { haveBuyer[b.buyer] = 1; });
  (sMeta.buyers || []).forEach(b => { if (b.buyer && !haveBuyer[b.buyer]) curMeta.buyers.push(b); });
  merged.activityMeta[name] = curMeta;
  if (sPlan && !(merged.limitPlans && merged.limitPlans[name])) {
    merged.limitPlans = merged.limitPlans || {};
    merged.limitPlans[name] = sPlan;
  }
  const saved = await rpc('admin_save_team_data', { p_token: token, p_data: merged, p_expected_updated_at: updatedAt });
  console.log('\n✅ 已写回：恢复订单 ' + addOrders + ' 笔 / 补登商品 ' + addProducts + ' 件，活动「' + name + '」已回来。' +
    '保存返回：' + JSON.stringify(saved).slice(0, 200));
  console.log('请刷新 Aoi 页面核对活动管理/订单管理。');
})().catch(e => { console.error('FAIL:', e.message); process.exit(1); });
