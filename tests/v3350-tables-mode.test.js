// v3.35.0 方案 C P3 测试：blob diff 引擎 + data.js tables 通道（docs/PLAN-C-SCHEMA-SPLIT.md §四）
// 形状纪律三处闭环：null≡undefined≡''（文本空值）、false≡undefined（可选布尔）、数组序=渲染序（位置变化即变更）、
// 无 id 子行整体替换、未映射顶层键落 settings KV。
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { aoi, doc, win } from './helpers/aoi.js';

const D = () => aoi.blobDiff;

function baseBlob() {
  return {
    activities: ['A', 'B'],
    activityMeta: {
      A: { ip: '宝可梦', status: '未开始', remark: '', createdAt: '2026-10-01T00:00:00.000Z', updatedAt: '2026-10-01T00:00:00.000Z',
           buyers: [{ buyer: '小樱', account: 'a@x.com', address: '上海' }], trackings: ['SF001'], products: [
             { id: 'p1', type: '挂件', model: '皮卡丘', price: 20, currency: 'JPY', listed: false },
             { id: 'p2', type: '挂件', model: '伊布', price: 30, currency: 'JPY' } ] },
      B: { products: [], buyers: [], trackings: [] }
    },
    orders: [
      { id: 'o1', activity: 'A', type: '挂件', model: '皮卡丘', buyer: '小樱', currency: 'JPY', price: 20, count: 1, status: '未到货' },
      { id: 'o2', activity: 'A', type: '挂件', model: '伊布', buyer: '小狼', currency: 'JPY', price: 30, count: 2, status: '未到货' }
    ],
    batches: [], payments: [], notifications: [], announcements: [], cnChanges: [], pcoItems: [],
    reservoirs: [{ id: 'r1', name: '池', sideA: '甲', sideB: '乙', rates: { jpy: 0.043 }, entries: [{ id: 'e1', orderId: 'o1', side: 'A', addedAt: '10-01' }], settlements: [] }],
    paigu: { A: { slots: { '挂件|皮卡丘': [{ id: 's1', orderId: 'o1', buyer: '小樱', status: '未付款', addedAt: '10-02' }] }, log: [{ at: '10-02', text: 'seed' }] } },
    limitPlans: { A: { limits: { '挂件|皮卡丘': 2 }, items: [] } },
    typeMeta: { '挂件': { route: '常规二次元线路' } },
    ips: ['宝可梦'],
    memberMeta: { '小樱': { qq: '123' } },
    addresses: { '小樱': '上海' },
    calc: { jpyRate: 0.043 },
    botConfig: {}, imgHost: {}, ipTypes: {}
  };
}
const clone = (o) => JSON.parse(JSON.stringify(o));

beforeEach(() => {
  win.localStorage.clear();
  aoi.DATA_MODE = 'blob';
  aoi._baseline = null;
  aoi.state.user = { id: 'debug-local', username: 'debug', isDebug: true };
  aoi.toast = vi.fn();
});

describe('blobDiff：归一化纪律', () => {
  it('完全相同 → null（无变更）', () => {
    expect(D()(baseBlob(), clone(baseBlob()))).toBeNull();
  });

  it('布尔 false ≡ 缺省：给商品加 listed:false / orders 加 _aiAligned:false 不产生变更', () => {
    const data = clone(baseBlob());
    data.activityMeta.A.products[0].listed = false;
    data.orders[0]._aiAligned = false;
    expect(D()(baseBlob(), data)).toBeNull();
  });

  it("文本 '' ≡ 缺省：remark 从未填到清空 '' 不产生变更；反之写入 remark 有变更", () => {
    const d1 = clone(baseBlob());
    d1.activityMeta.A.remark = '';
    expect(D()(baseBlob(), d1)).toBeNull();
    const d2 = clone(baseBlob());
    d2.activityMeta.A.remark = '备注文字';
    const ch = D()(baseBlob(), d2);
    expect(ch.activities.upsert).toHaveLength(1);
    expect(ch.activities.upsert[0].remark).toBe('备注文字');
  });

  it('数字 0 有语义：price 改 0 产生变更', () => {
    const data = clone(baseBlob());
    data.activityMeta.A.products[0].price = 0;
    const ch = D()(baseBlob(), data);
    expect(ch.products.upsert).toHaveLength(1);
    expect(ch.products.upsert[0].price).toBe(0);
    expect(ch.products.upsert[0].activity).toBe('A');   // diff 注入归属活动
  });
});

describe('blobDiff：行级集合', () => {
  it('订单增/改/删 → upsert（带 sortOrder）/ delete；改动行携带 blob 原键', () => {
    const data = clone(baseBlob());
    data.orders[1].status = '已到货';                 // 改
    data.orders.push({ id: 'o3', activity: 'A', count: 1, status: '未到货' }); // 增
    data.orders.splice(0, 1);                        // 删 o1（后续行前移 → o2 位置变化也 upsert）
    const ch = D()(baseBlob(), data);
    expect(ch.orders.delete).toEqual(['o1']);
    const ids = ch.orders.upsert.map((r) => r.id);
    expect(ids).toContain('o2');
    expect(ids).toContain('o3');
    expect(ch.orders.upsert.find((r) => r.id === 'o2').status).toBe('已到货');
    expect(ch.orders.upsert.find((r) => r.id === 'o3').sortOrder).toBe(1); // 数组序
  });

  it('活动新增：activities.upsert + products 全量 upsert（activity 注入）+ buyers/trackings replace', () => {
    const data = clone(baseBlob());
    data.activities.push('C');
    data.activityMeta.C = { ip: '终末', status: '未开始', products: [{ id: 'p9', type: '徽章', model: '终末', price: 5 }], buyers: [], trackings: [] };
    const ch = D()(baseBlob(), data);
    expect(ch.activities.upsert).toHaveLength(1);
    expect(ch.activities.upsert[0].name).toBe('C');
    expect(ch.products.upsert).toHaveLength(1);
    expect(ch.products.upsert[0].id).toBe('p9');
    expect(ch.products.upsert[0].activity).toBe('C');
    expect(ch.activityBuyers.replace.C).toEqual([]);
    expect(ch.activityTrackings.replace.C).toEqual([]);
  });

  it('活动删除 → activities.delete（子表靠 FK 级联，不发 products.delete）', () => {
    const data = clone(baseBlob());
    data.activities = data.activities.filter((n) => n !== 'A');
    delete data.activityMeta.A;
    data.orders = data.orders.filter((o) => o.activity !== 'A'); // 业务代码会清理订单
    const ch = D()(baseBlob(), data);
    expect(ch.activities.delete).toEqual(['A']);
    expect(ch.products?.delete ?? []).toEqual([]);   // 删活动级联，不逐商品发（段裁空则缺）
    expect(ch.orders.delete).toEqual(['o1', 'o2']);
  });

  it('活动改名式商品迁移：同 id 商品从活动 A 消失、在活动 B 出现 → delete + upsert 对', () => {
    const data = clone(baseBlob());
    const moved = clone(baseBlob().activityMeta.A.products[0]);
    data.activityMeta.A.products = data.activityMeta.A.products.filter((p) => p.id !== 'p1');
    data.activityMeta.B = { products: [moved], buyers: [], trackings: [] };
    const ch = D()(baseBlob(), data);
    expect(ch.products.delete).toEqual(['p1']);
    const up = ch.products.upsert.find((r) => r.id === 'p1');
    expect(up.activity).toBe('B');
  });

  it('活动字段改（status）→ 仅该活动 upsert；活动重排 → 受影响行 upsert 携带新位置', () => {
    const data = clone(baseBlob());
    data.activityMeta.B.status = '进行中';
    const ch = D()(baseBlob(), data);
    expect(ch.activities.upsert.map((r) => r.name)).toEqual(['B']);
    const data2 = clone(baseBlob());
    data2.activities = ['B', 'A'];   // 重排
    const ch2 = D()(baseBlob(), data2);
    const names = ch2.activities.upsert.map((r) => r.name).sort();
    expect(names).toEqual(['A', 'B']); // 两位都变
    expect(ch2.activities.upsert.find((r) => r.name === 'B').sortOrder).toBe(0);
  });

  it('buyers / trackings 变化 → replace（行带 sortOrder；trackings 为字符串数组）', () => {
    const data = clone(baseBlob());
    data.activityMeta.A.buyers.push({ buyer: '小狼', account: 'b@x.com', address: '' });
    data.activityMeta.A.trackings.push('SF002');
    const ch = D()(baseBlob(), data);
    expect(ch.activityBuyers.replace.A).toHaveLength(2);
    expect(ch.activityBuyers.replace.A[1].buyer).toBe('小狼');
    expect(ch.activityBuyers.replace.A[1].sortOrder).toBe(1);
    expect(ch.activityTrackings.replace.A).toEqual(['SF001', 'SF002']);
  });

  it('商品删除 → products.delete（活动仍在）', () => {
    const data = clone(baseBlob());
    data.activityMeta.A.products = data.activityMeta.A.products.filter((p) => p.id !== 'p2');
    const ch = D()(baseBlob(), data);
    expect(ch.products.delete).toEqual(['p2']);
  });
});

describe('blobDiff：排谷表 / 蓄水池 / KV 兜底', () => {
  it('paigu slots 键迁移（type|model 改键）：同 id 排位 → upsert 携带新 type/model；logs 变化 → replace', () => {
    const data = clone(baseBlob());
    data.paigu.A.slots['挂件|伊布'] = data.paigu.A.slots['挂件|皮卡丘'];
    delete data.paigu.A.slots['挂件|皮卡丘'];
    data.paigu.A.log.push({ at: '10-03', text: '改列' });
    const ch = D()(baseBlob(), data);
    expect(ch.paiguSlots.delete).toEqual([]);
    const up = ch.paiguSlots.upsert.find((r) => r.id === 's1');
    expect(up.activity).toBe('A');
    expect(up.type).toBe('挂件');
    expect(up.model).toBe('伊布');
    expect(up.sort).toBe(0);
    expect(ch.paiguLogs.replace.A).toHaveLength(2);
  });

  it('paigu 排位增删 → upsert/delete；同活动 log 不动则不替换', () => {
    const data = clone(baseBlob());
    data.paigu.A.slots['挂件|皮卡丘'].push({ id: 's2', orderId: 'o2', buyer: '小狼', status: '未付款', addedAt: '10-03' });
    const ch = D()(baseBlob(), data);
    expect(ch.paiguSlots.upsert.map((r) => r.id)).toEqual(['s2']);
    expect(ch.paiguSlots.upsert[0].sort).toBe(1);
    expect(ch.paiguLogs?.replace?.A).toBeUndefined(); // log 未变（段裁空则缺）
  });

  it('蓄水池 entries 变化 → replace（池行未变则不发 reservoirs.upsert）；新池 → upsert + replace', () => {
    const data = clone(baseBlob());
    data.reservoirs[0].entries.push({ id: 'e2', orderId: 'o2', side: 'B', addedAt: '10-03' });
    const ch = D()(baseBlob(), data);
    expect(ch.reservoirs?.upsert ?? []).toEqual([]);
    expect(ch.reservoirEntries?.replace?.r1).toHaveLength(2);
    const data2 = clone(baseBlob());
    data2.reservoirs.push({ id: 'r2', name: '新池', sideA: '丙', sideB: '丁', rates: null, entries: [{ id: 'e9', orderId: 'o1', side: 'A', addedAt: 'x' }], settlements: [] });
    const ch2 = D()(baseBlob(), data2);
    expect(ch2.reservoirs.upsert.map((r) => r.id)).toEqual(['r2']);
    expect(ch2.reservoirEntries.replace.r2).toHaveLength(1);
  });

  it('limitPlans payload 变化 → 整包 upsert；删除 → delete', () => {
    const data = clone(baseBlob());
    data.limitPlans.A.limits['挂件|皮卡丘'] = 5;
    const ch = D()(baseBlob(), data);
    expect(ch.limitPlans.upsert).toHaveLength(1);
    expect(ch.limitPlans.upsert[0].activity).toBe('A');
    expect(ch.limitPlans.upsert[0].payload.limits['挂件|皮卡丘']).toBe(5);
    const data2 = clone(baseBlob());
    delete data2.limitPlans.A;
    expect(D()(baseBlob(), data2).limitPlans.delete).toEqual(['A']);
  });

  it('typeMeta / memberMeta / addresses 键级增删改', () => {
    const data = clone(baseBlob());
    data.typeMeta['挂件'] = { route: '一般线路发送' };   // 改
    data.typeMeta['新类型'] = { route: '未分类' };        // 增
    delete data.typeMeta['发卡'];                          // （不在基线，无影响）
    data.typeMeta['徽章'] = { route: '未分类' };          // 增
    data.memberMeta['小樱'].qq = '999';
    data.addresses['小狼'] = '北京';
    const ch = D()(baseBlob(), data);
    expect(ch.typeMeta.upsert.map((r) => r.type).sort()).toEqual(['徽章', '挂件', '新类型']);
    expect(ch.memberMeta.upsert).toHaveLength(1);
    expect(ch.memberMeta.upsert[0].qq).toBe('999');
    expect(ch.addresses.upsert).toEqual([{ cn: '小狼', address: '北京' }]);
  });

  it('calc / 未知顶层键 → settings upsert；键删除 → settings delete', () => {
    const data = clone(baseBlob());
    data.calc.jpyRate = 0.05;
    data.catalogConfig = { dispatchUrl: 'https://x' };   // 未映射新键
    const ch = D()(baseBlob(), data);
    const calc = ch.settings.upsert.find((r) => r.key === 'calc');
    expect(calc.value.jpyRate).toBe(0.05);
    const cc = ch.settings.upsert.find((r) => r.key === 'catalogConfig');
    expect(cc.value.dispatchUrl).toBe('https://x');
    const data2 = clone(baseBlob());
    delete data2.calc;
    expect(D()(baseBlob(), data2).settings.delete).toEqual(['calc']);
    const data3 = clone(baseBlob());
    data3.ips = ['宝可梦', '术力口'];
    expect(D()(baseBlob(), data3).settings.upsert.find((r) => r.key === 'ips').value).toEqual(['宝可梦', '术力口']);
  });
});

describe('data.js tables 通道（DATA_MODE=tables）', () => {
  beforeEach(() => {
    aoi.DATA_MODE = 'tables';
    aoi._baseline = clone(baseBlob());
    aoi.state.user = { id: 'admin-1', username: 'boss', isDebug: false };
    aoi.adminLoadSession = () => ({ token: 'tok-123', role: 'super' });
    aoi.db = { rpc: vi.fn(async function (fn, params) {
      if (fn !== 'aoi_sync') throw new Error('unexpected rpc: ' + fn);
      expect(params.p_token).toBe('tok-123');
      return { data: { ok: true, updatedAt: '2026-11-11T00:00:00.000Z' } };
    }) };
  });

  it('saveTeamData：diff 出变更 → aoi_sync 携带变更集 → 成功后基线更新', async () => {
    const data = clone(baseBlob());
    data.orders[0].status = '已到货';
    await aoi.saveTeamData(data);
    expect(aoi.db.rpc).toHaveBeenCalledTimes(1);
    expect(aoi._baseline.orders[0].status).toBe('已到货'); // 基线已更新
  });

  it('无变化 → 不发 RPC（幂等保存）', async () => {
    await aoi.saveTeamData(clone(baseBlob()));
    expect(aoi.db.rpc).not.toHaveBeenCalled();
  });

  it('连续两次保存：第二次只含相对新基线的增量', async () => {
    const data1 = clone(baseBlob());
    data1.orders[0].status = '已到货';
    await aoi.saveTeamData(data1);
    const data2 = clone(data1);
    data2.orders[0].remark = '发货注意';
    aoi.db.rpc = vi.fn(async function (fn, params) {
      expect(params.p_changes.orders.upsert).toHaveLength(1);
      expect(params.p_changes.orders.upsert[0].remark).toBe('发货注意');
      return { data: { ok: true } };
    });
    await aoi.saveTeamData(data2);
    expect(aoi.db.rpc).toHaveBeenCalledTimes(1);
  });

  it('aoi_sync 报错 → toast + 抛错（基线不动，可重试）', async () => {
    aoi.db.rpc = vi.fn(async function () { return { error: { message: '网络异常' } }; });
    const data = clone(baseBlob());
    data.orders[0].status = '已到货';
    await expect(aoi.saveTeamData(data)).rejects.toThrow(/网络异常|保存失败/);
    expect(aoi._baseline.orders[0].status).toBe('未到货'); // 基线未动
  });

  it('getAllTables：设置基线并透传 {name, memberKey, data, updatedAt}', async () => {
    const payload = { name: '调试团', memberKey: 'KEY', data: clone(baseBlob()), updatedAt: 'X' };
    aoi.db.rpc = vi.fn(async function (fn, params) {
      expect(fn).toBe('aoi_get_all');
      expect(params.p_token).toBe('tok-123');
      return { data: payload };
    });
    const got = await aoi.getAllTables('tok-123');
    expect(got.name).toBe('调试团');
    expect(aoi._baseline.orders).toHaveLength(2);
  });

  it('debug 用户不受 DATA_MODE 影响（仍走 localStorage）', async () => {
    aoi.state.user = { id: 'debug-local', username: 'debug', isDebug: true };
    aoi.db.rpc = vi.fn();
    const data = clone(baseBlob());
    data.orders[0].status = '已到货';
    await aoi.saveTeamData(data);
    expect(aoi.db.rpc).not.toHaveBeenCalled();
    expect(JSON.parse(win.localStorage.getItem('aoi_debug_data')).orders[0].status).toBe('已到货');
  });
});
