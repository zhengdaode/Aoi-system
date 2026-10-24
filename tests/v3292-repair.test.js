// v3.29.2 排谷表件数对账：已在排订单的排位数自动对齐订单 count——
// 修复 v3.29.1 之前入排的旧数据（count=2 只占 1 格 → 打开排谷表自动补成 2 格，第 1、2 行均显示买家）；
// 订单编辑改件数同样即时补足/裁剪（syncOrder 联动）。
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { aoi, doc } from './helpers/aoi.js';

const P = () => aoi.paigu;
const ACT = 'miniso快闪';
const KEY = '毛绒|黑键小动物毛绒';

function seedData() {
  aoi.state.data = {
    orders: [
      // 柠檬买了 2 件，但旧数据只入排了 1 格（v3.29.1 之前入排）——用户实测场景
      { id: 'o1', activity: ACT, type: '毛绒', model: '黑键小动物毛绒', buyer: '柠檬', currency: 'cny', priceOrig: null, price: 1, count: 2, status: '未到货' },
      { id: 'o2', activity: ACT, type: '毛绒', model: '黑键小动物毛绒', buyer: '未入排的路人', currency: 'cny', priceOrig: null, price: 1, count: 3, status: '未到货' }
    ],
    activities: [ACT],
    activityMeta: {
      [ACT]: { products: [{ id: 'p1', type: '毛绒', model: '黑键小动物毛绒', refImage: '', refUrl: '', price: 1, priceOrig: null, currency: null, limit: null }], buyers: [], trackings: [] }
    },
    limitPlans: {},
    paigu: {
      [ACT]: {
        slots: {
          [KEY]: [{ id: 's1', orderId: 'o1', buyer: '柠檬', status: '已付款', addedAt: '10-24 12:00' }]
        },
        log: []
      }
    },
    batches: [], payments: [], notifications: [], announcements: [], reservoirs: [],
    typeMeta: {}, ipTypes: {}, addresses: {}, memberMeta: {},
    calc: { jpyRate: 0.048, jpyMarkup: 0 }
  };
  aoi.saveTeamData = vi.fn(async function (data) { return data; });
}

beforeEach(seedData);

describe('renderAll 全量对账（旧数据自动补位）', () => {
  it('count=2 只占 1 格 → 打开排谷表自动补成 2 格，第 1、2 行均显示柠檬（状态沿用、同 orderId）', () => {
    P().renderAll();
    P().openActivity(ACT);
    const arr = aoi.state.data.paigu[ACT].slots[KEY];
    expect(arr).toHaveLength(2);
    expect(arr[0].buyer).toBe('柠檬');
    expect(arr[1].buyer).toBe('柠檬');
    expect(arr[1].orderId).toBe('o1');
    expect(arr[1].status).toBe('已付款'); // 沿用原排位状态
    // 页面第 1、2 行都是柠檬
    const cells = [...doc.querySelectorAll('#paiguBody [data-pact="slot"]')];
    expect(cells).toHaveLength(2);
    cells.forEach((c) => expect(c.textContent).toContain('柠檬'));
    expect(cells[1].getAttribute('title')).toBe('柠檬-已付款-共排2位-第2名');
    expect(doc.querySelector('.paigu-head-stock').textContent).toContain('2/—');
    // 落库 + 日志留痕
    expect(aoi.saveTeamData).toHaveBeenCalled();
    expect(aoi.state.data.paigu[ACT].log[0].text).toContain('件数对账：排位 1 → 2 位');
  });

  it('对账幂等：同数据对象重复渲染不再补位/不再写日志', () => {
    P().renderAll();
    P().renderAll();
    P().renderAll();
    expect(aoi.state.data.paigu[ACT].slots[KEY]).toHaveLength(2);
    const logs = aoi.state.data.paigu[ACT].log.filter((l) => l.text.includes('件数对账'));
    expect(logs).toHaveLength(1);
  });

  it('未入排订单不自动入排；多余排位从尾部裁剪', () => {
    // o2 count=3 未入排 → 保持不入排
    P().renderAll();
    expect(aoi.state.data.paigu[ACT].slots[KEY]).toHaveLength(2); // 只有 o1 补出的 2 格
    // o1 改成 count=1 → 2 格裁成 1 格（保留第 1 格）
    const d = aoi.state.data;
    d.orders[0].count = 1;
    d.orders[0].id = 'o1';
    d.paigu[ACT].slots[KEY] = [
      { id: 's1', orderId: 'o1', buyer: '柠檬', status: '未付款' },
      { id: 's2', orderId: 'o1', buyer: '柠檬', status: '未付款' }
    ];
    pqRepairReset();
    const d2 = aoi.state.data; // reset 后断言新数据对象
    P().renderAll();
    expect(d2.paigu[ACT].slots[KEY]).toHaveLength(1);
    expect(d2.paigu[ACT].slots[KEY][0].id).toBe('s1');
    expect(d2.paigu[ACT].log[0].text).toContain('排位 2 → 1 位');
  });

  it('数据对象更换（撤销恢复/重新登录）后对账重跑', () => {
    P().renderAll();
    const d2 = JSON.parse(JSON.stringify(aoi.state.data));
    d2.paigu[ACT].slots[KEY] = [{ id: 's1', orderId: 'o1', buyer: '柠檬', status: '未付款' }];
    aoi.state.data = d2;
    P().renderAll();
    expect(d2.paigu[ACT].slots[KEY]).toHaveLength(2);
  });
});

describe('syncOrder 件数联动（订单编辑改 count）', () => {
  function twoSlots() {
    aoi.state.data.paigu[ACT].slots[KEY] = [
      { id: 's1', orderId: 'o1', buyer: '柠檬', status: '未付款' },
      { id: 's2', orderId: 'o1', buyer: '柠檬', status: '未付款' }
    ];
  }
  it('count 2 → 3：补 1 位在该订单最后一格之后', () => {
    twoSlots();
    const d = aoi.state.data;
    d.orders[0].count = 3;
    expect(P().syncOrder(d, d.orders[0])).toBe(true);
    const arr = d.paigu[ACT].slots[KEY];
    expect(arr).toHaveLength(3);
    expect(arr.map((s) => s.buyer)).toEqual(['柠檬', '柠檬', '柠檬']);
    expect(d.paigu[ACT].log[0].text).toContain('排位 2 → 3 位');
  });

  it('count 2 → 1：裁掉尾部 1 位', () => {
    twoSlots();
    const d = aoi.state.data;
    d.orders[0].count = 1;
    expect(P().syncOrder(d, d.orders[0])).toBe(true);
    const arr = d.paigu[ACT].slots[KEY];
    expect(arr).toHaveLength(1);
    expect(arr[0].id).toBe('s1');
    expect(d.paigu[ACT].log[0].text).toContain('排位 2 → 1 位');
  });

  it('件数未变不写对账日志', () => {
    twoSlots();
    const d = aoi.state.data;
    expect(P().syncOrder(d, d.orders[0])).toBe(false);
    expect(d.paigu[ACT].log.filter((l) => l.text.includes('件数对账'))).toHaveLength(0);
  });
});

// 重置对账标记：模拟数据重新载入后强制重跑 repairAll
function pqRepairReset() {
  // renderAll 内部以数据对象引用为标记；替换引用即可重跑
  aoi.state.data = JSON.parse(JSON.stringify(aoi.state.data));
}
