import { describe, it, expect, beforeEach, vi } from 'vitest';
import { aoi, win, doc } from './helpers/aoi.js';

describe('Aoi.limits.planCore 限购购买计划算法（v3.4.1 两阶段：全量分配 → 包邮调剂）', () => {
  // 商品：A 单价 10 剩 5；B 单价 5 剩 10（分配按单价降序逐件给最低额账号）
  const products = [
    { type: '徽章', model: 'A', qty: 5, price: 10 },
    { type: '色纸', model: 'B', qty: 10, price: 5 }
  ];

  it('阶段一全量分配：全部数量分完，均衡后全员包邮（旧逻辑会剩 B×2）', () => {
    const r = aoi.limits.planCore(products, { freeShip: 30, accounts: 3 });
    expect(r.remaining).toEqual([]);            // 15 件全部硬性分配到账号
    expect(r.accounts).toHaveLength(3);
    expect(r.accounts.map((a) => a.total)).toEqual([35, 35, 30]);   // 金额均衡
    r.accounts.forEach((a) => expect(a.reached).toBe(true));        // 货值 100 ≥ 30×3 → 全员包邮
  });

  it('限购数约束：分配与调剂全程受单账号限购约束', () => {
    const withLimit = [{ type: '徽章', model: 'A', qty: 5, price: 10, limit: 2 }, products[1]];
    const r = aoi.limits.planCore(withLimit, { freeShip: 30, accounts: 3 });
    expect(r.remaining).toEqual([]);
    expect(r.accounts.map((a) => a.total)).toEqual([35, 35, 30]);
    expect(r.accounts[0].items[0]).toEqual({ type: '徽章', model: 'A', qty: 2, amount: 20 });
  });

  it('每账号最大种类数 maxTypes=1：装不下的进 remaining，调剂牺牲账号集中凑邮', () => {
    const r = aoi.limits.planCore(products, { freeShip: 30, accounts: 3, maxTypes: 1 });
    // A 占满 3 个账号的种类名额后，B×10 无处安放 → remaining 提示
    expect(r.remaining).toEqual([{ type: '色纸', model: 'B', qty: 10 }]);
    r.accounts.forEach((a) => expect(a.items).toHaveLength(1));
    // 货值不足：牺牲账号3，把账号1 顶过包邮线
    expect(r.accounts.map((a) => a.total)).toEqual([30, 20]);
  });

  it('阶段2a 等价交换：普通挪动无解时 A↔B 净额互换让双账号同时达标', () => {
    // 均衡后 24/17，达标账号盈余 4 放不出任何单品（10/7），只有 A↔B（净 +3）可补差
    const mixed = [{ type: '徽章', model: 'A', qty: 2, price: 10 }, { type: '色纸', model: 'B', qty: 3, price: 7 }];
    const r = aoi.limits.planCore(mixed, { freeShip: 20, accounts: 2 });
    expect(r.remaining).toEqual([]);
    expect(r.accounts.map((a) => a.total)).toEqual([21, 20]);
    expect(r.accounts.every((a) => a.reached)).toBe(true);
  });

  it('阶段2b 货值不足：牺牲低额账号把最接近包邮线的顶过线', () => {
    const scarce = [{ type: '徽章', model: 'A', qty: 3, price: 10 }, { type: '色纸', model: 'B', qty: 1, price: 5 }];
    const r = aoi.limits.planCore(scarce, { freeShip: 25, accounts: 2 });
    expect(r.remaining).toEqual([]);
    expect(r.accounts.map((a) => a.total)).toEqual([25, 10]);      // 账号2 交出色纸¥5 补给账号1
    expect(r.accounts.filter((a) => a.reached)).toHaveLength(1);   // 货值 35 < 25×2，至多 1 个达标
  });

  it('限购卡死调剂：limit=1 时无法集中凑邮，如实输出未达标', () => {
    const r = aoi.limits.planCore([{ type: '徽章', model: 'A', qty: 2, price: 10, limit: 1 }], { freeShip: 20, accounts: 3 });
    expect(r.remaining).toEqual([]);
    expect(r.accounts.map((a) => a.total)).toEqual([10, 10]);      // 空账号不列行
    expect(r.accounts.every((a) => !a.reached)).toBe(true);
  });

  it('包邮金额为 0：只做全量分配，不做包邮调剂', () => {
    const r = aoi.limits.planCore(products, { freeShip: 0, accounts: 1 });
    expect(r.accounts).toHaveLength(1);
    expect(r.accounts[0].items.reduce((s, it) => s + it.qty, 0)).toBe(15); // 全部塞进一个账号
    expect(r.remaining).toHaveLength(0);
  });

  it('货值远超包邮线：旧逻辑凑线即停会剩余，新逻辑全量分配（回归守护）', () => {
    const rich = [{ type: '徽章', model: 'A', qty: 15, price: 10 }, { type: '色纸', model: 'B', qty: 10, price: 5 }];
    const r = aoi.limits.planCore(rich, { freeShip: 100, accounts: 1 });
    expect(r.accounts).toHaveLength(1);
    expect(r.accounts[0].reached).toBe(true);
    expect(r.accounts[0].total).toBe(200);      // 15×10 + 10×5 全部买回（旧逻辑此处 100 即停）
    expect(r.remaining).toEqual([]);
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
    // 两阶段算法：货值 100 ≥ 30×3 → 全量分配完毕且 3 个账号全部达标（旧逻辑会提示剩余未分配）
    const stat = doc.getElementById('limResultStat').textContent;
    expect(stat).toContain('全部排单数量已分配完毕');
    expect(stat).toContain('3 个达标包邮');
    expect(stat).not.toContain('剩余未分配');
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

describe('Aoi.limits 结果表件数与外币原价列（v3.5.4）', () => {
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

  it('origTotals 按币种分组求和，缺原价的商品不计入', () => {
    const meta = {
      '吧唧|M1': { origCurrency: 'jpy', origAvg: 1250 },
      '吧唧|M2': { origCurrency: 'krw', origAvg: 8000 },
      '立牌|M3': {}
    };
    const items = [
      { type: '吧唧', model: 'M1', qty: 2 },
      { type: '吧唧', model: 'M2', qty: 1 },
      { type: '立牌', model: 'M3', qty: 3 }
    ];
    expect(aoi.limits.origTotals(items, meta)).toEqual(['JP¥2,500', '₩8,000']);
    expect(aoi.limits.origTotals([{ type: '立牌', model: 'M3', qty: 1 }], meta)).toEqual([]);
  });

  it('结果表 7 列：件数为账号合计，外币原价逐件累加按币种分组', () => {
    doc.getElementById('limActivity').innerHTML = '<option value="2026春团" selected>2026春团</option>';
    doc.getElementById('limActivity').value = '2026春团';
    aoi.limits.load();
    doc.getElementById('limFreeShip').value = '0';
    doc.getElementById('limAccounts').value = '2';
    aoi.limits.plan();
    expect(doc.querySelectorAll('#limResultTable thead th')).toHaveLength(7);
    const rows = [...doc.querySelectorAll('#limResultTbody tr')];
    expect(rows).toHaveLength(2);
    const cells = rows.map((r) => [...r.querySelectorAll('td')].map((td) => td.textContent));
    // 均衡分配：账号1 = M1×2（件数 2、日元原价 2×1250）；账号2 = M1×1+M2×1（件数 2、原价 1250；人民币单无原价不计）
    expect(cells[0][3]).toBe('2');
    expect(cells[0][5]).toBe('JP¥2,500');
    expect(cells[1][3]).toBe('2');
    expect(cells[1][5]).toBe('JP¥1,250');
    // 包邮线未填 → 包邮状态列显示「—」
    expect(cells[0][6]).toBe('—');
  });
});
