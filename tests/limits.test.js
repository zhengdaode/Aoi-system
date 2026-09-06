import { describe, it, expect, beforeEach, vi } from 'vitest';
import { aoi, win, doc } from './helpers/aoi.js';

describe('Aoi.limits.planCore 限购购买计划算法（v2.0.0 问题 8）', () => {
  // 商品：A 单价 10 剩 5；B 单价 5 剩 10（贪心按单价降序：先 A 后 B）
  const products = [
    { type: '徽章', model: 'A', qty: 5, price: 10 },
    { type: '色纸', model: 'B', qty: 10, price: 5 }
  ];

  it('贪心装箱：每账号恰好凑满包邮线', () => {
    const r = aoi.limits.planCore(products, { freeShip: 30, accounts: 3 });
    expect(r.accounts).toHaveLength(3);
    // 账号1：A×3 = 30 达包邮
    expect(r.accounts[0].items).toEqual([{ type: '徽章', model: 'A', qty: 3, amount: 30 }]);
    expect(r.accounts[0].reached).toBe(true);
    // 账号2：A×2 + B×2 = 30
    expect(r.accounts[1].total).toBe(30);
    expect(r.accounts[1].reached).toBe(true);
    // 剩余 B×2
    expect(r.remaining).toEqual([{ type: '色纸', model: 'B', qty: 2 }]);
  });

  it('限购数约束：单账号限购 2 时先买满限购再补其他商品', () => {
    const withLimit = [{ type: '徽章', model: 'A', qty: 5, price: 10, limit: 2 }, products[1]];
    const r = aoi.limits.planCore(withLimit, { freeShip: 30, accounts: 3 });
    // 账号1：A 限购 2 → A×2 = 20，再补 B×2 = 10 → 30
    expect(r.accounts[0].total).toBe(30);
    expect(r.accounts[0].items[0].qty).toBe(2);
  });

  it('每账号最大购买种类数约束：maxTypes=1 时单账号只买一种', () => {
    const r = aoi.limits.planCore(products, { freeShip: 30, accounts: 3, maxTypes: 1 });
    r.accounts.forEach((a) => expect(a.items).toHaveLength(1));
  });

  it('包邮金额为 0：不限制单账号金额，尽量集中购买', () => {
    const r = aoi.limits.planCore(products, { freeShip: 0, accounts: 1 });
    expect(r.accounts).toHaveLength(1);
    const totalQty = r.accounts[0].items.reduce((s, it) => s + it.qty, 0);
    expect(totalQty).toBe(15); // 全部塞进一个账号
    expect(r.remaining).toHaveLength(0);
  });

  it('账号不足时剩余数量进入 remaining 提示', () => {
    // 货值 200 > 包邮线 100 × 1 账号：账号1 凑满 100 后停止，剩余进入未分配
    const rich = [{ type: '徽章', model: 'A', qty: 15, price: 10 }, { type: '色纸', model: 'B', qty: 10, price: 5 }];
    const r = aoi.limits.planCore(rich, { freeShip: 100, accounts: 1 });
    expect(r.accounts).toHaveLength(1);
    expect(r.accounts[0].reached).toBe(true);
    expect(r.remaining).toEqual([{ type: '徽章', model: 'A', qty: 5 }, { type: '色纸', model: 'B', qty: 10 }]);
  });
});

describe('Aoi.limits 页面逻辑（v2.0.0）', () => {
  beforeEach(() => {
    aoi.saveTeamData = vi.fn().mockResolvedValue(undefined);
    aoi.state.data = {
      activities: ['活动A'],
      orders: [
        { id: 'o1', activity: '活动A', type: '徽章', model: 'A', count: 5, price: 10, currency: 'cny', remark: '', buyer: '小樱', status: '未到货', batchId: null },
        { id: 'o2', activity: '活动A', type: '色纸', model: 'B', count: 10, price: 5, currency: 'cny', remark: '', buyer: '小狼', status: '未到货', batchId: null }
      ]
    };
  });

  it('productsForActivity 汇总种类与排单数量', () => {
    const ps = aoi.limits.productsForActivity('活动A');
    expect(ps).toHaveLength(2);
    const a = ps.find((p) => p.type === '徽章');
    expect(a.qty).toBe(5);
  });

  it('load 渲染商品行并支持批量限购', () => {
    doc.getElementById('limActivity').innerHTML = '<option value="活动A">活动A</option>';
    doc.getElementById('limActivity').value = '活动A';
    aoi.limits.load();
    const rows = doc.querySelectorAll('#limProductTbody input[data-lim]');
    expect(rows).toHaveLength(2);
    doc.getElementById('limBulk').value = '2';
    aoi.limits.applyBulkLimit();
    expect(doc.querySelectorAll('#limProductTbody input[data-lim]')[0].value).toBe('2');
  });

  it('plan 端到端：输入 → 结果表渲染', () => {
    doc.getElementById('limActivity').innerHTML = '<option value="活动A">活动A</option>';
    doc.getElementById('limActivity').value = '活动A';
    aoi.limits.load();
    doc.getElementById('limFreeShip').value = '30';
    doc.getElementById('limAccounts').value = '3';
    aoi.limits.plan();
    expect(doc.getElementById('limResultBox').classList.contains('hidden')).toBe(false);
    const html = doc.getElementById('limResultTbody').innerHTML;
    expect(html).toContain('账号 1');
    expect(html).toContain('已达包邮');
    expect(doc.getElementById('limResultStat').textContent).toContain('剩余未分配');
  });
});

describe('Aoi.tableExport（v2.0.0 问题 9）', () => {
  it('SheetJS 可用时导出 .xlsx', () => {
    const writeFile = vi.fn();
    win.XLSX = { utils: { table_to_book: vi.fn(() => ({ SheetNames: [] })) }, writeFile };
    const btn = doc.createElement('button');
    btn.setAttribute('data-table', 'orderTable');
    btn.setAttribute('data-name', '订单管理');
    doc.body.appendChild(btn);
    aoi.tableExport(btn);
    expect(writeFile).toHaveBeenCalled();
    expect(writeFile.mock.calls[0][1]).toBe('订单管理.xlsx');
    delete win.XLSX;
  });
});

describe('Aoi.limits 限购计算器（v3.2.0 T2：活动刷新 + 包邮金额币种 + 外币原价）', () => {
  beforeEach(() => {
    aoi.state.data = {
      activities: ['2026春团'],
      orders: [
        { id: 'o1', activity: '2026春团', type: '吧唧', model: 'M1', price: 60, priceOrig: 1200, currency: 'jpy', count: 2, buyer: '小明' },
        { id: 'o2', activity: '2026春团', type: '吧唧', model: 'M1', price: 63, priceOrig: 1300, currency: 'jpy', count: 1, buyer: '小红' },
        { id: 'o3', activity: '2026春团', type: '立牌', model: 'M2', price: 50, priceOrig: null, currency: 'cny', count: 1, buyer: '小刚' }
      ]
    };
  });

  it('productsForActivity 汇总外币原价：同币种求均价', () => {
    const ps = aoi.limits.productsForActivity('2026春团');
    const m1 = ps.find((p) => p.model === 'M1');
    expect(m1.origCurrency).toBe('jpy');
    expect(m1.origAvg).toBe(1250);
    // 人民币订单不产生外币原价
    const m2 = ps.find((p) => p.model === 'M2');
    expect(m2.origAvg).toBeUndefined();
  });

  it('origText / currencySymbol 与订单表符号规则一致', () => {
    const ps = aoi.limits.productsForActivity('2026春团');
    const m1 = ps.find((p) => p.model === 'M1');
    expect(aoi.limits.origText(m1)).toBe('JP¥1,250');
    expect(aoi.limits.origText({})).toBe('—');
    expect(aoi.limits.currencySymbol('jpy')).toBe('JP¥');
    expect(aoi.limits.currencySymbol('krw')).toBe('₩');
    expect(aoi.limits.currencySymbol('cny')).toBe('¥');
  });

  it('包邮金额选日元：按汇率换算为人民币包邮线参与计算', () => {
    doc.getElementById('limActivity').innerHTML = '<option value="2026春团" selected>2026春团</option>';
    doc.getElementById('limActivity').value = '2026春团';
    aoi.limits.load();
    doc.getElementById('limFreeShip').value = '1000';
    doc.getElementById('limFreeShipCurrency').value = 'jpy';
    doc.getElementById('limAccounts').value = '2';
    aoi.limits.plan();
    // 默认汇率 0.048+0.005=0.053 → 1000 日元 ≈ ¥53；账号1 买 M1×1=60 已超包邮线
    expect(doc.getElementById('limResultStat').textContent).toContain('包邮线 JP¥1000（≈ ¥53.00）');
    expect(doc.getElementById('limResultBox').classList.contains('hidden')).toBe(false);
  });

  it('包邮金额人民币：结果展示不变', () => {
    doc.getElementById('limActivity').value = '2026春团';
    aoi.limits.load();
    doc.getElementById('limFreeShip').value = '60';
    doc.getElementById('limFreeShipCurrency').value = 'cny';
    doc.getElementById('limAccounts').value = '1';
    aoi.limits.plan();
    expect(doc.getElementById('limResultStat').textContent).toContain('包邮线 ¥60.00');
  });
});
