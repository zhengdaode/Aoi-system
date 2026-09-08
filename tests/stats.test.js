import { describe, it, expect, beforeEach } from 'vitest';
import { aoi, doc } from './helpers/aoi.js';

// 合成数据：A1 有购买时间（2026-08，含日元估算单），A2 无购买时间；b1/b2 两个批次跨 8/9 月
function setup() {
  aoi.state.data = {
    activities: ['A1', 'A2'],
    ips: [],
    activityMeta: {
      A1: { ip: '术力口', buyDate: '2026-08-10', status: '已完成' },
      A2: { ip: '漫画', buyDate: '', status: '进行中' }
    },
    batches: [
      { id: 'b1', date: '2026-08-15' },
      { id: 'b2', date: '2026-09-02' }
    ],
    orders: [
      { id: 'o1', activity: 'A1', ip: '术力口', buyer: '小樱', type: '吧唧', model: 'A', price: 10, priceOrig: null, currency: 'cny', count: 2, status: '已到货', batchId: 'b1', shipped: '已发', shippedAt: '2026-08-17T00:00:00.000Z' },
      { id: 'o2', activity: 'A1', ip: '术力口', buyer: '星野', type: '色纸', model: 'B', price: null, priceOrig: 1000, currency: 'jpy', count: 1, status: '未到货', batchId: 'b1' },
      { id: 'o3', activity: 'A2', ip: '漫画', buyer: '小樱', type: '立牌', model: 'C', price: null, priceOrig: null, currency: 'cny', count: 1, status: '未到货', batchId: 'b2' }
    ],
    payments: [
      { id: 'p1', batchId: 'b1', buyer: '小樱', status: '已交', intlFee: 12 },
      { id: 'p2', batchId: 'b1', buyer: '星野', status: '待审核', intlFee: 8 },
      { id: 'p3', batchId: 'b2', buyer: '小樱', status: '待交', intlFee: 5 }
    ],
    calc: {}
  };
  aoi.saveTeamData = async (d) => { aoi.state.data = d; };
  aoi.stats.ipMetric = 'amount';
  aoi.stats.buyerMetric = 'amount';
}

describe('Aoi.stats 复盘统计（F6）', () => {
  beforeEach(setup);

  it('monthKey：取 YYYY-MM，非法返回空串', () => {
    expect(aoi.stats.monthKey('2026-09-01')).toBe('2026-09');
    expect(aoi.stats.monthKey('2026-09')).toBe('2026-09');
    expect(aoi.stats.monthKey('')).toBe('');
    expect(aoi.stats.monthKey('not-a-date')).toBe('');
    expect(aoi.stats.monthKey(null)).toBe('');
  });

  it('termOptions：all + 月份降序 + unknown', () => {
    const opts = aoi.stats.termOptions(aoi.state.data);
    expect(opts[0].value).toBe('all');
    expect(opts.map(o => o.value)).toEqual(['all', '2026-09', '2026-08', 'unknown']);
  });

  it('orderRmb 三分支：有人民币价直用 / 缺失按汇率估算并标记 / 都无为 0', () => {
    const [o1, o2, o3] = aoi.state.data.orders;
    expect(aoi.stats.orderRmb(o1)).toEqual({ rmb: 10, est: false });
    const est = aoi.stats.orderRmb(o2); // 1000 × (0.048+0.005) = 53
    expect(est.rmb).toBe(53);
    expect(est.est).toBe(true);
    expect(aoi.stats.orderRmb(o3)).toEqual({ rmb: 0, est: false });
    expect(aoi.stats.orderAmount(o1)).toBe(20); // 单价 10 × 2 件
  });

  it('ordersInTerm / batchesInTerm：按活动购买时间归月，unknown 兜底', () => {
    expect(aoi.stats.ordersInTerm(aoi.state.data, 'all').length).toBe(3);
    expect(aoi.stats.ordersInTerm(aoi.state.data, '2026-08').map(o => o.id)).toEqual(['o1', 'o2']);
    expect(aoi.stats.ordersInTerm(aoi.state.data, 'unknown').map(o => o.id)).toEqual(['o3']);
    expect(aoi.stats.batchesInTerm(aoi.state.data, '2026-08').map(b => b.id)).toEqual(['b1']);
    expect(aoi.stats.batchesInTerm(aoi.state.data, '2026-09').map(b => b.id)).toEqual(['b2']);
    expect(aoi.stats.batchesInTerm(aoi.state.data, 'unknown')).toEqual([]);
  });

  it('ordersInIp：按 IP 过滤，空串为全部', () => {
    const all = aoi.stats.ordersInTerm(aoi.state.data, 'all');
    expect(aoi.stats.ordersInIp(all, '').length).toBe(3);
    expect(aoi.stats.ordersInIp(all, '术力口').map(o => o.id)).toEqual(['o1', 'o2']);
  });

  it('activityRows：条数/件数/金额/到货比例聚合，金额降序', () => {
    const rows = aoi.stats.activityRows(aoi.state.data, 'all', '');
    expect(rows[0].name).toBe('A1');
    expect(rows[0].count).toBe(2);
    expect(rows[0].qty).toBe(3);
    expect(rows[0].amount).toBe(73); // 10×2 + 53×1
    expect(rows[0].arrived).toBe(1);
    expect(rows[0].cur.jpy).toBe(1000);
    expect(rows[1].name).toBe('A2');
    expect(rows[1].amount).toBe(0);
  });

  it('ipRows / currencyRows：聚合金额与原币（币种按折合金额降序）', () => {
    const ips = aoi.stats.ipRows(aoi.state.data, 'all', '');
    expect(ips[0]).toMatchObject({ ip: '术力口', count: 2, qty: 3, amount: 73 });
    const curs = aoi.stats.currencyRows(aoi.state.data, 'all', '');
    expect(curs[0]).toMatchObject({ cur: 'jpy', count: 1, orig: 1000, rmb: 53 });
    expect(curs[1]).toMatchObject({ cur: 'cny', count: 2, orig: 20, rmb: 20 });
  });

  it('buyerRows：货款聚合 + 按「批次×买家」汇总交费金额', () => {
    const rows = aoi.stats.buyerRows(aoi.state.data, 'all', '');
    const sakura = rows.find(r => r.buyer === '小樱');
    expect(sakura.qty).toBe(3);
    expect(sakura.amount).toBe(20);
    expect(sakura.pay['已交']).toBe(12);
    expect(sakura.pay['待交']).toBe(5);
    const hoshino = rows.find(r => r.buyer === '星野');
    expect(hoshino.amount).toBe(53);
    expect(hoshino.pay['待审核']).toBe(8);
  });

  it('payRows：金额口径交费汇总（含回收率数据）', () => {
    const pay = aoi.stats.payRows(aoi.state.data, 'all');
    expect(pay['已交']).toEqual({ cnt: 1, fee: 12 });
    expect(pay['待审核']).toEqual({ cnt: 1, fee: 8 });
    expect(pay['待交']).toEqual({ cnt: 1, fee: 5 });
    expect(pay['已驳回']).toEqual({ cnt: 0, fee: 0 });
    const k = aoi.stats.kpis(aoi.state.data, 'all', '');
    expect(k.receivable).toBe(25);
    expect(k.paidPct).toBeCloseTo(48); // 12/25
  });

  it('shipAgingRows：平均发货时效只统计已发且有 shippedAt 的订单', () => {
    const rows = aoi.stats.shipAgingRows(aoi.state.data, 'all');
    const b1 = rows.find(r => r.date === '2026-08-15');
    expect(b1.total).toBe(2);
    expect(b1.shipped).toBe(1);
    expect(b1.avgDays).toBe(2); // 08-17 发货 − 08-15 到货
    const b2 = rows.find(r => r.date === '2026-09-02');
    expect(b2.shipped).toBe(0);
    expect(b2.avgDays).toBeNull();
  });

  it('kpis：各项指标与团期/IP 筛选联动', () => {
    const all = aoi.stats.kpis(aoi.state.data, 'all', '');
    expect(all.orderCount).toBe(3);
    expect(all.qty).toBe(4);
    expect(all.amount).toBe(73);
    expect(all.est).toBe(true);
    expect(all.buyerCount).toBe(2);
    expect(all.perBuyer).toBeCloseTo(36.5);
    expect(all.arrived).toBe(1);
    expect(all.agingDays).toBe(2);
    // 仅 2026-08 团期：o3 排除
    const aug = aoi.stats.kpis(aoi.state.data, '2026-08', '');
    expect(aug.orderCount).toBe(2);
    expect(aug.arrivedPct).toBeCloseTo(50);
    // IP 筛选只影响货款维度，不影响交费
    const ipOnly = aoi.stats.kpis(aoi.state.data, 'all', '漫画');
    expect(ipOnly.orderCount).toBe(1);
    expect(ipOnly.receivable).toBe(25);
  });

  it('render：填充 KPI / 活动表 / 排行 / 时效 DOM', () => {
    aoi.stats.render();
    expect(doc.getElementById('statsKpis').innerHTML).toContain('折合总金额');
    expect(doc.getElementById('statsKpis').innerHTML).toContain('73');
    expect(doc.getElementById('statsActTbody').innerHTML).toContain('A1');
    expect(doc.getElementById('statsIpBars').innerHTML).toContain('术力口');
    expect(doc.getElementById('statsBuyerBars').innerHTML).toContain('小樱');
    expect(doc.getElementById('statsCurBars').innerHTML).toContain('原币');
    expect(doc.getElementById('statsPayBars').innerHTML).toContain('待审核');
    expect(doc.getElementById('statsAgingTbody').innerHTML).toContain('2026-08-15');
    expect(doc.getElementById('statsTermSel').innerHTML).toContain('value="2026-08"');
  });

  it('口径切换：ipMetric 切件数后排行文案变化', () => {
    aoi.stats.render();
    expect(doc.getElementById('statsIpBars').innerHTML).toContain('¥');
    aoi.stats.ipMetric = 'qty';
    aoi.stats.render();
    expect(doc.getElementById('statsIpBars').innerHTML).toContain('件');
    aoi.stats.ipMetric = 'amount';
  });
});
