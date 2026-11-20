// v3.36.0 排谷表 ↔ 订单管理同步闭环——用户实测「排谷表中新建的订单无法同步到订单管理界面」修复：
// ①手动插排同步创建真实订单（此前仅虚拟排位不建订单，订单管理永远看不到）——订单字段 / 列头参考价 /
//   商品主档骨架补登（addManual 同口径）/ 活动自动入列；
// ②撤排联动：排谷表自建订单（src='paigu'）撤掉最后一个排位时确认后删单，订单管理来源订单维持不动；
// ③删除活动级联清理 d.paigu（否则排谷表活动列表残留僵尸活动）。
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { aoi, doc } from './helpers/aoi.js';

const P = () => aoi.paigu;
const ACT = '8.23涩谷场外';
const KEY = '发卡|星之卡比发卡';

function seedData() {
  aoi.state.data = {
    orders: [
      { id: 'o1', ip: '', activity: ACT, type: '毛绒', model: '皮卡丘土王', buyer: '一枚小混子', currency: 'jpy', priceOrig: 5500, price: null, count: 1, status: '未到货', remark: '' }
    ],
    ips: ['东京'],
    activities: [ACT],
    activityMeta: {
      [ACT]: {
        ip: '东京',
        products: [
          { id: 'p1', type: '毛绒', model: '皮卡丘土王', refImage: '', refUrl: '', price: null, priceOrig: 5500, currency: 'jpy', limit: null },
          { id: 'p3', type: '发卡', model: '星之卡比发卡', refImage: '', refUrl: '', price: 42, priceOrig: null, currency: null, limit: null }
        ],
        buyers: [], trackings: []
      }
    },
    limitPlans: {},
    paigu: { [ACT]: { slots: {}, log: [] } },
    batches: [], payments: [], notifications: [], announcements: [], reservoirs: [],
    typeMeta: {}, ipTypes: {}, addresses: {}, memberMeta: {},
    calc: { jpyRate: 0.048, jpyMarkup: 0, krwRate: 0.0053, krwMarkup: 0 }
  };
  aoi.saveTeamData = vi.fn(async function (data) { return data; });
}

beforeEach(seedData);

describe('手动插排 → 真实订单（订单管理同步可见）', () => {
  it('insertSlot 手动买家名建单：字段完整（src=paigu / remark 标记 / 未到货），排位挂 orderId', async () => {
    const n = await P().insertSlot(ACT, KEY, '新路人', 1, [], { price: 42, priceOrig: null, currency: null });
    expect(n).toBe(1);
    const o = aoi.state.data.orders.find((x) => x.buyer === '新路人');
    expect(o).toBeTruthy();
    expect(o.activity).toBe(ACT);
    expect(o.type).toBe('发卡');
    expect(o.model).toBe('星之卡比发卡');
    expect(o.count).toBe(1);
    expect(o.status).toBe('未到货');
    expect(o.price).toBe(42);
    expect(o.remark).toBe('排谷表手动排位');
    expect(o.src).toBe('paigu');
    expect(o.batchId).toBeNull();
    const slot = aoi.state.data.paigu[ACT].slots[KEY][0];
    expect(slot.orderId).toBe(o.id);
    expect(slot.buyer).toBe('新路人');
    expect(aoi.state.data.paigu[ACT].log[0].text).toContain('已同步建单');
  });

  it('订单管理 render 即时可见（导航重渲染读 d.orders）', async () => {
    await P().insertSlot(ACT, KEY, '订单管理可见者', 1, []);
    aoi.orders.render();
    const tbody = doc.getElementById('ordersBody') || doc.querySelector('#view-orders tbody');
    expect(tbody.textContent).toContain('订单管理可见者');
  });

  it('参考价回落：无人民币价时取外币原价+币种', async () => {
    await P().insertSlot(ACT, KEY, '外币买家', 1, [], { price: null, priceOrig: 600, currency: 'jpy' });
    const o = aoi.state.data.orders.find((x) => x.buyer === '外币买家');
    expect(o.price).toBeNull();
    expect(o.priceOrig).toBe(600);
    expect(o.currency).toBe('jpy');
  });

  it('商品主档骨架补登：新商品建骨架并带出价格；已有商品只补缺失不覆盖', async () => {
    // 新商品：毛绒|新品玩偶 不在主档 → 建骨架 + price 补上
    await P().insertSlot(ACT, '毛绒|新品玩偶', '买家甲', 1, [], { price: 88, priceOrig: null, currency: null });
    let pm = aoi.state.data.activityMeta[ACT].products;
    let p = pm.find((x) => x.type === '毛绒' && x.model === '新品玩偶');
    expect(p).toBeTruthy();
    expect(p.price).toBe(88);
    // 已有商品 发卡|星之卡比发卡（price=42）不覆盖、不重复；缺失的 priceOrig 才补
    await P().insertSlot(ACT, KEY, '买家乙', 1, [], { price: 99, priceOrig: 700, currency: 'jpy' });
    pm = aoi.state.data.activityMeta[ACT].products;
    const same = pm.filter((x) => x.type === '发卡' && x.model === '星之卡比发卡');
    expect(same).toHaveLength(1);
    expect(same[0].price).toBe(42);
    expect(same[0].priceOrig).toBe(700);
    expect(same[0].currency).toBe('jpy');
  });

  it('未分类（type 空）不登记商品主档；活动不在列表时自动加入', async () => {
    await P().insertSlot(ACT, '|无类型散货', '散客', 1, [], { price: 30, priceOrig: null, currency: null });
    expect(aoi.state.data.activityMeta[ACT].products.some((x) => !x.type)).toBe(false);
    const o = aoi.state.data.orders.find((x) => x.buyer === '散客');
    expect(o.type).toBe('');
    // 排谷表遗留活动（不在 d.activities）插排 → 订单建立后活动自动入列
    aoi.state.data.paigu['旧活动复刻'] = { slots: {}, log: [] };
    await P().insertSlot('旧活动复刻', '毛绒|皮卡丘土王', '旧活动买家', 1, []);
    expect(aoi.state.data.activities).toContain('旧活动复刻');
  });

  it('UI 接线：插排弹窗 → insert-save 携带列头参考价建单（pqInsRef 传递）', async () => {
    P().openActivity(ACT);
    doc.querySelector('[data-pact="switch-type"][data-type="发卡"]').click(); // 切到发卡 sheet
    doc.querySelector('[data-pact="insert"][data-key="' + KEY + '"][data-idx="1"]').click();
    doc.getElementById('paiguInsBuyer').value = '界面买家';
    doc.querySelector('[data-pact="insert-save"]').click();
    await new Promise((r) => setTimeout(r, 0));
    const o = aoi.state.data.orders.find((x) => x.buyer === '界面买家');
    expect(o).toBeTruthy();
    expect(o.price).toBe(42); // 主档人民币价经弹窗传入
    expect(doc.getElementById('paiguModal').classList.contains('hidden')).toBe(true);
  });
});

describe('撤排联动（自建订单删单 / 他源订单不动）', () => {
  it('自建订单撤掉唯一排位：confirm 后订单一并删除；拒绝则不动', async () => {
    await P().insertSlot(ACT, KEY, '要撤的人', 1, []);
    const oid = aoi.state.data.orders.find((x) => x.buyer === '要撤的人').id;
    const sid = aoi.state.data.paigu[ACT].slots[KEY][0].id;
    aoi.confirm = vi.fn(async () => false);
    await P().removeSlot(ACT, sid);
    expect(aoi.state.data.orders.some((x) => x.id === oid)).toBe(true);
    expect(aoi.state.data.paigu[ACT].slots[KEY]).toHaveLength(1);
    aoi.confirm = vi.fn(async () => true);
    await P().removeSlot(ACT, sid);
    expect(aoi.state.data.orders.some((x) => x.id === oid)).toBe(false);
    expect(aoi.state.data.paigu[ACT].slots[KEY] || []).toHaveLength(0);
    expect(aoi.state.data.paigu[ACT].log[0].text).toContain('同步删除排谷表自建订单');
  });

  it('订单管理来源订单撤排：不弹确认、订单保留（原行为不变）', async () => {
    aoi.confirm = vi.fn(async () => true);
    aoi.state.data.paigu[ACT].slots['毛绒|皮卡丘土王'] = [{ id: 's1', orderId: 'o1', buyer: '一枚小混子', status: '未付款', addedAt: 'x' }];
    await P().removeSlot(ACT, 's1');
    expect(aoi.confirm).not.toHaveBeenCalled();
    expect(aoi.state.data.orders.some((x) => x.id === 'o1')).toBe(true);
  });

  it('自建订单拆多排位（件数对账）时：撤掉其一不删单，撤掉最后一个才删', async () => {
    await P().insertSlot(ACT, KEY, '多排位买家', 1, [], { price: 42, priceOrig: null, currency: null });
    const o = aoi.state.data.orders.find((x) => x.buyer === '多排位买家');
    o.count = 2;
    const arr = aoi.state.data.paigu[ACT].slots[KEY];
    arr.push({ id: 's-extra', orderId: o.id, buyer: '多排位买家', status: '未付款', addedAt: 'x' });
    aoi.confirm = vi.fn(async () => true);
    await P().removeSlot(ACT, arr[0].id);
    expect(aoi.state.data.orders.some((x) => x.id === o.id)).toBe(true); // 还剩 1 个排位，订单保留
    await P().removeSlot(ACT, 's-extra');
    expect(aoi.state.data.orders.some((x) => x.id === o.id)).toBe(false); // 最后一个排位，订单删除
  });

  it('自建订单在订单管理编辑后仍联动：买家改名 → 排位跟随（syncOrder）', async () => {
    await P().insertSlot(ACT, KEY, '改名前', 1, []);
    const o = aoi.state.data.orders.find((x) => x.buyer === '改名前');
    o.buyer = '改名后';
    expect(P().syncOrder(aoi.state.data, o)).toBe(true);
    expect(aoi.state.data.paigu[ACT].slots[KEY][0].buyer).toBe('改名后');
  });
});

describe('删除活动级联清理排谷表', () => {
  it('removeActivity 删除 d.paigu[活动]，排谷表列表不再显示僵尸活动卡', async () => {
    aoi.state.data.paigu[ACT].slots[KEY] = [{ id: 's1', buyer: '某人', status: '未付款', addedAt: 'x' }];
    P().backToList(); // pqView 跨用例共享，先回活动列表态
    expect(doc.getElementById('paiguBody').textContent).toContain(ACT);
    aoi.confirm = vi.fn(async () => true);
    await aoi.orders.removeActivity(ACT);
    expect(aoi.state.data.paigu[ACT]).toBeUndefined();
    P().backToList();
    expect(doc.getElementById('paiguBody').textContent).not.toContain(ACT);
  });

  it('removeActivity 确认文案提及排谷表；无排谷数据时不提及', async () => {
    aoi.state.data.paigu[ACT] = { slots: {}, log: [] };
    aoi.confirm = vi.fn(async () => true);
    await aoi.orders.removeActivity(ACT);
    expect(aoi.confirm.mock.calls[0][0]).toContain('排谷表');
    // 活动无排谷表：文案不提排谷表
    aoi.state.data.paigu = {};
    aoi.state.data.activities = ['另一场'];
    aoi.state.data.orders = [{ id: 'o9', ip: '', activity: '另一场', type: '小卡', model: 'm', buyer: 'b', currency: 'cny', priceOrig: null, price: 1, count: 1, status: '未到货', remark: '' }];
    aoi.confirm.mockClear();
    await aoi.orders.removeActivity('另一场');
    expect(aoi.confirm.mock.calls[0][0]).not.toContain('排谷表');
  });
});
