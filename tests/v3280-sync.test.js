// v3.28.0 全局返回/刷新 + 商品库存同步排谷表 + 三端同步（活动管理 ↔ 订单 ↔ 排谷表）；v3.28.1 重复购买口径修订：
// 同一商品的同一购买者不合并不标数量，多排位逐位分开显示（页面与导出均不出现 ×N）。
// 口径：商品卡改类型/型号 → 同活动同旧键订单改写、限购键与排谷表列键迁移（syncProductKey）；
// 订单编辑（saveEdit）→ 排谷表对应排位跟随（买家名/列/活动，syncOrder）；库存 stock 存商品主档，
// 排谷表「库存」行展示（已排>库存标红）。
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { aoi, doc, win } from './helpers/aoi.js';

const P = () => aoi.paigu;
const ACT = '8.23涩谷场外';

function seedData() {
  aoi.state.data = {
    orders: [
      { id: 'o1', activity: ACT, type: '毛绒', model: '皮卡丘土王', buyer: '一枚小混子', currency: 'jpy', priceOrig: 5500, price: null, count: 1, status: '未到货' },
      { id: 'o2', activity: ACT, type: '毛绒', model: '圣诞树皮卡丘', buyer: '草莓头那个莹', currency: 'jpy', priceOrig: 4400, price: 211, count: 1, status: '未到货' },
      { id: 'o5', activity: '10.1韩国团', type: '小卡', model: 'aespa 小卡', buyer: 'キム', currency: 'krw', priceOrig: 8000, price: 85, count: 1, status: '未到货' }
    ],
    activities: [ACT, '10.1韩国团'],
    activityMeta: {
      [ACT]: {
        products: [
          { id: 'p1', type: '毛绒', model: '皮卡丘土王', refImage: '', refUrl: '', price: null, priceOrig: 5500, currency: 'jpy', limit: null }
        ],
        buyers: [], trackings: []
      }
    },
    limitPlans: { [ACT]: { activity: ACT, limits: { '毛绒|皮卡丘土王': 2 }, items: [], remaining: [] } },
    paigu: {
      [ACT]: {
        slots: {
          '毛绒|皮卡丘土王': [
            { id: 's1', orderId: 'o1', buyer: '一枚小混子', status: '已下定', addedAt: '10-20 12:00' },
            { id: 's2', orderId: 'o2', buyer: '草莓头那个莹', status: '未付款', addedAt: '10-20 12:01' }
          ]
        },
        log: [{ at: '10-20 12:00', text: 'seed 日志' }]
      }
    },
    batches: [], payments: [], notifications: [], announcements: [], reservoirs: [],
    typeMeta: {}, ipTypes: {}, addresses: {}, memberMeta: {},
    calc: { jpyRate: 0.048, jpyMarkup: 0, krwRate: 0.0053, krwMarkup: 0 }
  };
  aoi.saveTeamData = vi.fn(async function (data) { return data; });
}

beforeEach(seedData);

// 视图可见状态在测试间残留 → 收拢到只剩目标视图
function showOnly(viewId) {
  doc.querySelectorAll('[data-view]').forEach((el) => el.classList.add('hidden'));
  doc.getElementById(viewId).classList.remove('hidden');
}

describe('全局导航：返回上一步 / 刷新当前页（v3.28.0）', () => {
  it('nav 切换把来源视图压入历史栈；navBack 出栈回退且不再入栈', () => {
    showOnly('view-overview');
    aoi.navHistory.length = 0;
    aoi.nav('view-orders');
    expect(doc.getElementById('view-orders').classList.contains('hidden')).toBe(false);
    expect(doc.getElementById('view-overview').classList.contains('hidden')).toBe(true);
    expect(aoi.navHistory).toEqual(['view-overview']);
    aoi.nav('view-paigu');
    expect(aoi.navHistory).toEqual(['view-overview', 'view-orders']);
    aoi.navBack();
    expect(doc.getElementById('view-orders').classList.contains('hidden')).toBe(false);
    expect(aoi.navHistory).toEqual(['view-overview']);
    aoi.navBack();
    expect(doc.getElementById('view-overview').classList.contains('hidden')).toBe(false);
    expect(aoi.navHistory).toEqual([]);
  });

  it('历史栈空时 navBack 提示且不动视图；navRefresh 重渲染当前视图', () => {
    aoi.navHistory.length = 0;
    showOnly('view-overview');
    aoi.navBack();
    expect(doc.getElementById('view-overview').classList.contains('hidden')).toBe(false);
    aoi.nav('view-paigu');
    const spy = vi.spyOn(aoi.paigu, 'renderAll');
    aoi.navRefresh();
    expect(spy).toHaveBeenCalled();
    spy.mockRestore();
  });
});

describe('paigu.syncProductKey / syncOrder（三端同步纯函数）', () => {
  it('syncProductKey：旧键排位整体迁到新键列尾，旧键清理并留日志', () => {
    const d = aoi.state.data;
    const n = P().syncProductKey(d, ACT, '毛绒|皮卡丘土王', '发卡|皮卡丘土王');
    expect(n).toBe(2);
    expect(d.paigu[ACT].slots['毛绒|皮卡丘土王']).toBeUndefined();
    const moved = d.paigu[ACT].slots['发卡|皮卡丘土王'];
    expect(moved.map((s) => s.id)).toEqual(['s1', 's2']);
    expect(d.paigu[ACT].log[0].text).toContain('商品键变更');
  });

  it('syncProductKey：目标列已有排位时并入尾部；空旧键只清理不迁移', () => {
    const d = aoi.state.data;
    d.paigu[ACT].slots['发卡|皮卡丘土王'] = [{ id: 's9', buyer: '先到者', status: '未付款' }];
    P().syncProductKey(d, ACT, '毛绒|皮卡丘土王', '发卡|皮卡丘土王');
    expect(d.paigu[ACT].slots['发卡|皮卡丘土王'].map((s) => s.id)).toEqual(['s9', 's1', 's2']);
    d.paigu[ACT].slots['空|键'] = [];
    expect(P().syncProductKey(d, ACT, '空|键', '发卡|皮卡丘土王')).toBe(0);
    expect(d.paigu[ACT].slots['空|键']).toBeUndefined();
  });

  it('syncOrder：买家改名同步排位；未入排订单返回 false', () => {
    const d = aoi.state.data;
    const o1 = d.orders[0];
    o1.buyer = '改名后的小混子';
    expect(P().syncOrder(d, o1)).toBe(true);
    expect(d.paigu[ACT].slots['毛绒|皮卡丘土王'][0].buyer).toBe('改名后的小混子');
    expect(P().syncOrder(d, d.orders[2])).toBe(false); // o5 未入排
  });

  it('syncOrder：类型/型号改列 → 移出原列追加到新列尾（同列其他买家不动）', () => {
    const d = aoi.state.data;
    const o1 = d.orders[0];
    o1.type = '发卡'; o1.model = '皮卡丘土王';
    P().syncOrder(d, o1);
    expect(d.paigu[ACT].slots['毛绒|皮卡丘土王'].map((s) => s.id)).toEqual(['s2']); // o2 的排位不动
    expect(d.paigu[ACT].slots['发卡|皮卡丘土王'].map((s) => s.id)).toEqual(['s1']);
    expect(d.paigu[ACT].log[0].text).toContain('排位迁入');
  });

  it('syncOrder：订单换活动 → 排位随迁目标活动排谷表', () => {
    const d = aoi.state.data;
    const o1 = d.orders[0];
    d.paigu['10.1韩国团'] = { slots: { '小卡|aespa 小卡': [{ id: 's7', orderId: 'o5', buyer: 'キム', status: '已付款' }] }, log: [] };
    o1.activity = '10.1韩国团';
    P().syncOrder(d, o1);
    expect(d.paigu[ACT].slots['毛绒|皮卡丘土王'].map((s) => s.id)).toEqual(['s2']);
    expect(d.paigu['10.1韩国团'].slots['毛绒|皮卡丘土王'].map((s) => s.id)).toEqual(['s1']);
    expect(d.paigu['10.1韩国团'].log[0].text).toContain('自活动 ' + ACT); // 来源活动标注
  });
});

describe('saveActProduct：商品改类型/型号 → 同步订单 + 限购键 + 排谷表列（类型残留 bug 修复）', () => {
  let savedHtml, origPaiguRender;
  beforeEach(() => {
    aoi.orders.renderActivities = () => {};
    origPaiguRender = aoi.paigu.renderAll;
    aoi.paigu.renderAll = vi.fn();
    savedHtml = doc.body.innerHTML;
  });
  afterEach(() => {
    aoi.paigu.renderAll = origPaiguRender;
    doc.body.innerHTML = savedHtml;
  });

  it('a(毛绒) 改为 a(发卡)：同活动同旧键订单改写、排位迁列、限购键迁移，旧类型 sheet 无残留', async () => {
    const p1 = aoi.state.data.activityMeta[ACT].products[0];
    doc.body.innerHTML = '<div id="holder">' + aoi.orders.actProductCardHtml(ACT, p1) + '</div>';
    doc.querySelector('[data-ptype="p1"]').value = '发卡';
    await aoi.orders.saveActProduct('p1');
    const d = aoi.state.data;
    expect(d.activityMeta[ACT].products[0].type).toBe('发卡');
    expect(d.orders[0].type).toBe('发卡');            // 同活动同旧键订单同步改写
    expect(d.orders[1].type).toBe('毛绒');            // 不同型号订单不受影响
    expect(d.limitPlans[ACT].limits['发卡|皮卡丘土王']).toBe(2);
    expect(d.limitPlans[ACT].limits['毛绒|皮卡丘土王']).toBeUndefined();
    expect(d.paigu[ACT].slots['毛绒|皮卡丘土王']).toBeUndefined();
    expect(d.paigu[ACT].slots['发卡|皮卡丘土王'].map((s) => s.id)).toEqual(['s1', 's2']);
    // 排谷表列聚合：旧「毛绒|皮卡丘土王」不再成列（orders/slots 均已迁走）
    const keys = P().activityProducts(d, ACT).map((c) => c.key);
    expect(keys).not.toContain('毛绒|皮卡丘土王');
    expect(keys).toContain('发卡|皮卡丘土王');
  });

  it('库存输入（data-pstock）：数字写回主档 stock，清空删除字段', async () => {
    const p1 = aoi.state.data.activityMeta[ACT].products[0];
    doc.body.innerHTML = '<div id="holder">' + aoi.orders.actProductCardHtml(ACT, p1) + '</div>';
    doc.querySelector('[data-pstock="p1"]').value = '5';
    await aoi.orders.saveActProduct('p1');
    expect(aoi.state.data.activityMeta[ACT].products[0].stock).toBe(5);
    doc.body.innerHTML = '<div id="holder">' + aoi.orders.actProductCardHtml(ACT, aoi.state.data.activityMeta[ACT].products[0]) + '</div>';
    doc.querySelector('[data-pstock="p1"]').value = '';
    await aoi.orders.saveActProduct('p1');
    expect(aoi.state.data.activityMeta[ACT].products[0].stock).toBeUndefined();
  });
});

describe('saveEdit：订单编辑同步排谷表排位', () => {
  it('改买家/类型后，排位跟随订单（买家名 + 列键），同列其他买家不动', async () => {
    const savedHtml = doc.body.innerHTML;
    const origRender = aoi.orders.render;
    const origClose = aoi.orders.closeEdit;
    aoi.orders.render = () => {};
    aoi.orders.closeEdit = () => {};
    const o1 = aoi.state.data.orders[0];
    aoi.orders.editingId = o1.id;
    doc.body.innerHTML = [
      '<input id="eType" value="发卡">', '<input id="eModel" value="皮卡丘土王">',
      '<input id="eCount" value="1">', '<input id="eActivity" value="' + ACT + '">',
      '<input id="eRemark" value="">', '<input id="eCurrency" value="jpy">',
      '<input id="ePrice" value="">', '<input id="ePriceOrig" value="5500">'
    ].join('');
    try {
      await aoi.orders.saveEdit();
    } finally {
      aoi.orders.render = origRender;
      aoi.orders.closeEdit = origClose;
      doc.body.innerHTML = savedHtml;
    }
    expect(o1.type).toBe('发卡');
    const d = aoi.state.data;
    expect(d.paigu[ACT].slots['毛绒|皮卡丘土王'].map((s) => s.id)).toEqual(['s2']); // o2 排位不动
    expect(d.paigu[ACT].slots['发卡|皮卡丘土王'].map((s) => s.id)).toEqual(['s1']);
  });
});

describe('排谷表页面：已排/库存行（v3.29.0 格式）+ 重复购买分开显示', () => {
  it('库存行展示主档 stock；已排位次超过库存标红（pq-stock-over + ⚠）', () => {
    const d = aoi.state.data;
    d.activityMeta[ACT].products[0].stock = 1; // 已排 2 位 > 库存 1
    P().renderAll();
    P().openActivity(ACT);
    let th = doc.querySelector('.paigu-head-stock');
    expect(th).not.toBeNull();
    expect(th.classList.contains('pq-stock-over')).toBe(true);
    expect(th.textContent).toContain('2/1');
    expect(th.textContent).toContain('⚠');
    d.activityMeta[ACT].products[0].stock = 10;
    P().renderAll();
    th = doc.querySelector('.paigu-head-stock');
    expect(th.classList.contains('pq-stock-over')).toBe(false);
    expect(th.textContent).toContain('2/10');
    d.activityMeta[ACT].products[0].stock = null;
    P().renderAll();
    th = doc.querySelector('.paigu-head-stock');
    expect(th.textContent).toBe('2/—'); // 未设置库存占位（已排数仍显示）
  });

  it('同买家同商品列多排位 → 逐位分开显示，不合并不标 ×N（v3.28.1 口径）', () => {
    const d = aoi.state.data;
    d.paigu[ACT].slots['毛绒|皮卡丘土王'].push({ id: 's3', buyer: '一枚小混子', status: '未付款', addedAt: '10-21 10:00' });
    P().renderAll();
    P().openActivity(ACT);
    // 无 ×N 标记
    expect(doc.querySelectorAll('#paiguBody .pq-qty')).toHaveLength(0);
    // 逐位分开：两个排位格独立存在，各显示买家名本身
    const cells = [
      doc.querySelector('[data-slot="s1"]'),
      doc.querySelector('[data-slot="s3"]')
    ];
    cells.forEach((el) => {
      expect(el).not.toBeNull();
      expect(el.textContent).toContain('一枚小混子');
    });
  });

  it('单排位买家显示无任何数量标注', () => {
    P().renderAll();
    P().openActivity(ACT);
    expect(doc.querySelectorAll('#paiguBody .pq-qty')).toHaveLength(0);
    expect(doc.querySelector('[data-slot="s1"]').textContent).toContain('一枚小混子');
  });
});

describe('导出（buildWorkbook）：库存行 + 重复购买不合并（v3.28.1）', () => {
  it('库存行在第 4 行；同买家重复排位逐位分开、格文本不附 ×N', () => {
    const d = aoi.state.data;
    d.activityMeta[ACT].products[0].stock = 2;
    d.paigu[ACT].slots['毛绒|皮卡丘土王'].push({ id: 's3', buyer: '一枚小混子', status: '未付款', addedAt: '10-21 10:00' });
    const desc = P().buildWorkbook(d, ACT);
    const mz = desc.sheets[0];
    expect(mz.rows[3][0].v).toBe('已排/库存');
    expect(mz.rows[3][1].v).toBe('3/2');
    expect(mz.rows[4][1].v).toBe('一枚小混子');   // 第 1 位，不合并不附 ×N
    expect(mz.rows[5][1].v).toBe('草莓头那个莹'); // 第 2 位
    expect(mz.rows[6][1].v).toBe('一枚小混子');   // 第 3 位，独立成格
    expect(mz.rows[3][1].s.color).toBe('FF0000'); // 已排 3 > 库存 2 → 标红
  });
});

describe('registerProduct / 新增商品表单：库存字段', () => {
  it('registerProduct 接受 stock；已存在商品缺失才补充（不覆盖已有值）', async () => {
    const p = await aoi.orders.registerProduct(ACT, { type: '吧唧', model: '新款吧唧', stock: 8 });
    expect(p.stock).toBe(8);
    const again = await aoi.orders.registerProduct(ACT, { type: '吧唧', model: '新款吧唧', stock: 12 });
    expect(again.stock).toBe(8); // 已有 stock 不被重复推入覆盖
  });
});
