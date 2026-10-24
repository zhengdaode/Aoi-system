// v3.29.1 排谷表入排粒度修复：入排/插排按购买件数拆位（count=N → N 个连续排位，同 orderId），
// 订单编辑同步（syncOrder）跟随该订单的全部排位（改名逐位、迁列/换活动保持相对顺序）。
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { aoi, doc } from './helpers/aoi.js';

const P = () => aoi.paigu;
const ACT = 'miniso快闪';
const KEY = '吧唧|黑曜徽章';

function seedData() {
  aoi.state.data = {
    orders: [
      // 柠檬买了 2 个（count=2）——用户实测场景：导入后曾只占 1 格
      { id: 'o1', activity: ACT, type: '吧唧', model: '黑曜徽章', buyer: '柠檫', currency: 'cny', priceOrig: null, price: 1, count: 2, status: '未到货' },
      { id: 'o2', activity: ACT, type: '吧唧', model: '黑曜徽章', buyer: '一人', currency: 'cny', priceOrig: null, price: 1, count: 1, status: '未到货' }
    ],
    activities: [ACT],
    activityMeta: {
      [ACT]: { products: [{ id: 'p1', type: '吧唧', model: '黑曜徽章', refImage: '', refUrl: '', price: 1, priceOrig: null, currency: null, limit: null, stock: 8 }], buyers: [], trackings: [] }
    },
    limitPlans: {},
    paigu: { [ACT]: { slots: {}, log: [] } },
    batches: [], payments: [], notifications: [], announcements: [], reservoirs: [],
    typeMeta: {}, ipTypes: {}, addresses: {}, memberMeta: {},
    calc: { jpyRate: 0.048, jpyMarkup: 0 }
  };
  aoi.saveTeamData = vi.fn(async function (data) { return data; });
}

beforeEach(() => {
  seedData();
  P().renderAll();
  P().openActivity(ACT);
});

describe('入排按件数拆位（v3.29.1）', () => {
  it('enqueueOrders：count=2 的订单拆成 2 个连续排位（同 orderId/买家/状态）', async () => {
    const r = await P().enqueueOrders(ACT, ['o1']);
    expect(r).toEqual({ added: 1, skipped: 0 });
    const arr = aoi.state.data.paigu[ACT].slots[KEY];
    expect(arr).toHaveLength(2);
    expect(arr[0].orderId).toBe('o1');
    expect(arr[1].orderId).toBe('o1');
    expect(arr[0].buyer).toBe('柠檫');
    expect(arr[1].buyer).toBe('柠檫');
    expect(aoi.state.data.paigu[ACT].log[0].text).toContain('按件数拆 2 个排位');
  });

  it('拆位后仍按订单防重：再次入排同一订单被跳过', async () => {
    await P().enqueueOrders(ACT, ['o1']);
    const r2 = await P().enqueueOrders(ACT, ['o1']);
    expect(r2.added).toBe(0);
    expect(aoi.state.data.paigu[ACT].slots[KEY]).toHaveLength(2); // 不重复追加
  });

  it('insertSlot：count=2 的订单插到第 1 位占 2 格，后续顺延', async () => {
    await P().enqueueOrders(ACT, ['o2']);       // 队尾先有「一人」
    const n = await P().insertSlot(ACT, KEY, null, 1, ['o1']);
    expect(n).toBe(2);
    const arr = aoi.state.data.paigu[ACT].slots[KEY];
    expect(arr.map((s) => s.buyer)).toEqual(['柠檫', '柠檫', '一人']);
  });

  it('页面与导出：2 格分位显示、悬浮带「共排2位」、已排/库存计 2', async () => {
    await P().enqueueOrders(ACT, ['o1']);
    P().renderAll();
    const cells = [...doc.querySelectorAll('#paiguBody [data-pact="slot"]')];
    expect(cells).toHaveLength(2);
    cells.forEach((c) => expect(c.textContent).toContain('柠檫'));
    expect(cells[0].getAttribute('title')).toBe('柠檫-未付款-共排2位-第1名');
    expect(cells[1].getAttribute('title')).toBe('柠檫-未付款-共排2位-第2名');
    expect(doc.querySelector('.paigu-head-stock').textContent).toContain('2/8');
  });
});

describe('syncOrder 跟随订单全部排位（v3.29.1）', () => {
  it('买家改名：该订单所有排位一起改名并留日志', () => {
    aoi.state.data.paigu[ACT].slots[KEY] = [
      { id: 's1', orderId: 'o1', buyer: '柠檫', status: '未付款' },
      { id: 's2', orderId: 'o1', buyer: '柠檫', status: '已下定' }
    ];
    const o1 = aoi.state.data.orders[0];
    o1.buyer = '改名柠檬';
    expect(P().syncOrder(aoi.state.data, o1)).toBe(true);
    const arr = aoi.state.data.paigu[ACT].slots[KEY];
    expect(arr.map((s) => s.buyer)).toEqual(['改名柠檬', '改名柠檬']);
    expect(aoi.state.data.paigu[ACT].log[0].text).toContain('买家名同步');
  });

  it('类型/型号改列：该订单所有排位一起迁移且相对顺序不变，同列他人不动', () => {
    aoi.state.data.paigu[ACT].slots[KEY] = [
      { id: 's1', orderId: 'o1', buyer: '柠檫', status: '未付款' },
      { id: 's9', orderId: 'o2', buyer: '一人', status: '未付款' },
      { id: 's2', orderId: 'o1', buyer: '柠檫', status: '已下定' }
    ];
    const o1 = aoi.state.data.orders[0];
    o1.type = '立牌'; o1.model = '黑曜立牌';
    expect(P().syncOrder(aoi.state.data, o1)).toBe(true);
    expect(aoi.state.data.paigu[ACT].slots[KEY].map((s) => s.id)).toEqual(['s9']); // 他人不动
    expect(aoi.state.data.paigu[ACT].slots['立牌|黑曜立牌'].map((s) => s.id)).toEqual(['s1', 's2']);
    expect(aoi.state.data.paigu[ACT].log[0].text).toContain('2 个排位迁入');
  });
});
