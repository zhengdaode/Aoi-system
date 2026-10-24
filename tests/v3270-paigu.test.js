// v3.27.0 排谷表 · 按活动排队表格——js/paigu.js 纯计算 / 数据动作 / 页面接线 / 导出
// 口径：商品按类型分 sheet（主档 ∪ 订单 ∪ 排位，空类型归「未分类」）；位次×买家矩阵（最少 10 行）；
// 五状态色标（未付款/已下定/已付款/已付尾款/已发货，与图例一致）；点按/右键改状态、插排/撤排/调序；
// 一单只入一个排位（防重）；手动排位仅队列虚拟（不建订单）；超排=超出限购计划 limits 的尾部队列；
// 状态独立不回写订单/审批；零 schema（d.paigu blob 新键）。
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { aoi, doc, win } from './helpers/aoi.js';

const P = () => aoi.paigu;
const ACT = '8.23涩谷场外';

function seedData() {
  aoi.state.data = {
    orders: [
      { id: 'o1', ip: '', activity: ACT, type: '毛绒', model: '皮卡丘土王', buyer: '一枚小混子', currency: 'jpy', priceOrig: 5500, price: null, count: 1, status: '未到货', remark: '' },
      { id: 'o2', ip: '', activity: ACT, type: '毛绒', model: '圣诞树皮卡丘', buyer: '草莓头那个莹', currency: 'jpy', priceOrig: 4400, price: 211, count: 1, status: '未到货', remark: '' },
      { id: 'o3', ip: '', activity: ACT, type: '毛绒', model: '圣诞节植绒', buyer: 'C.tough', currency: 'jpy', priceOrig: 870, price: null, count: 2, status: '未到货', remark: '' },
      { id: 'o4', ip: '', activity: ACT, type: '', model: '无类型散货', buyer: '依遇蜜柑', currency: 'cny', priceOrig: null, price: 30, count: 1, status: '未到货', remark: '' },
      { id: 'o5', ip: '', activity: '10.1韩国团', type: '小卡', model: 'aespa 小卡', buyer: 'キム', currency: 'krw', priceOrig: 8000, price: 85, count: 1, status: '未到货', remark: '' }
    ],
    activities: [ACT, '10.1韩国团'],
    activityMeta: {
      [ACT]: {
        products: [
          { id: 'p1', type: '毛绒', model: '皮卡丘土王', refImage: 'https://img.example/p1.jpg', refUrl: '', price: null, priceOrig: 5500, currency: 'jpy', limit: null },
          { id: 'p2', type: '毛绒', model: '圣诞树皮卡丘', refImage: '', refUrl: '', price: 211, priceOrig: null, currency: null, limit: null },
          { id: 'p3', type: '发卡', model: '星之卡比发卡', refImage: '', refUrl: '', price: 42, priceOrig: null, currency: null, limit: null }
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
          ],
          '发卡|星之卡比发卡': [
            { id: 's3', buyer: '纯手动路人', status: '已发货', addedAt: '10-20 12:02' }
          ]
        },
        log: [{ at: '10-20 12:00', text: 'seed 日志' }]
      }
    },
    batches: [], payments: [], notifications: [], announcements: [], reservoirs: [],
    typeMeta: {}, ipTypes: {}, addresses: { '一枚小混子': '上海市浦东新区' },
    memberMeta: { '一枚小混子': { qq: '1272822692' } },
    calc: { jpyRate: 0.048, jpyMarkup: 0, krwRate: 0.0053, krwMarkup: 0 }
  };
  // 持久化打桩：断言调用与入参，不真正写 Supabase/debug 通道
  aoi.saveTeamData = vi.fn(async function (data) { return data; });
}

beforeEach(seedData);

describe('模块与页面接线（静默待命 / 导航 / 活动列表）', () => {
  it('view-paigu 存在且默认隐藏；侧边导航有排谷表项；弹层与买家 datalist 就位', () => {
    const view = doc.getElementById('view-paigu');
    expect(view).not.toBeNull();
    expect(view.classList.contains('hidden')).toBe(true);
    expect(doc.querySelector('a[data-nav="view-paigu"]')).not.toBeNull();
    expect(doc.getElementById('paiguBody')).not.toBeNull();
    expect(doc.getElementById('paiguModal').classList.contains('hidden')).toBe(true);
    expect(doc.getElementById('paiguBuyerOptions')).not.toBeNull();
  });

  it('Aoi.nav(view-paigu) 显示视图并渲染活动列表卡（打开/导出按钮）', () => {
    aoi.nav('view-paigu');
    expect(doc.getElementById('view-paigu').classList.contains('hidden')).toBe(false);
    const body = doc.getElementById('paiguBody').textContent;
    expect(body).toContain(ACT);
    expect(body).toContain('10.1韩国团');
    expect(body).toContain('排位 3 个');
    expect(doc.querySelector('[data-pact="open"][data-activity="' + ACT + '"]')).not.toBeNull();
  });

  it('ensure 对空数据缺省 d.paigu；无活动时空状态', () => {
    aoi.state.data.paigu = null;
    aoi.state.data.activities = [];
    expect(Array.isArray(P().ensure().paigu)).toBe(false);
    P().renderAll();
    expect(doc.getElementById('paiguBody').textContent).toContain('还没有活动');
  });

  it('openActivity 详情渲染：返回/图例/类型 tab/排位格与状态底色，位次最少 10 行', () => {
    P().openActivity(ACT);
    const body = doc.getElementById('paiguBody');
    expect(body.querySelector('[data-pact="back"]')).not.toBeNull();
    expect(body.querySelector('[data-pact="switch-type"][data-type="毛绒"]')).not.toBeNull();
    expect(body.querySelector('[data-pact="switch-type"][data-type="发卡"]')).not.toBeNull();
    expect(body.textContent).toContain('未分类');
    const chip = body.querySelector('[data-pact="slot"][data-slot="s1"]');
    expect(chip).not.toBeNull();
    expect(chip.classList.contains('pq-st-ordered')).toBe(true); // 已下定=绿
    doc.querySelector('[data-pact="switch-type"][data-type="发卡"]').click(); // s3 在发卡 sheet
    expect(body.querySelector('[data-pact="slot"][data-slot="s3"]').classList.contains('pq-st-shipped')).toBe(true);
    doc.querySelector('[data-pact="switch-type"][data-type="毛绒"]').click();
    expect(body.querySelectorAll('.paigu-sheet tbody tr').length).toBeGreaterThanOrEqual(10);
    expect(body.querySelector('[data-pact="insert"][data-key="毛绒|皮卡丘土王"][data-idx="3"]')).not.toBeNull();
  });

  it('商品列头带参考图与单价；主档缺价回落订单价、无价显示占位', () => {
    P().openActivity(ACT);
    let heads = [...doc.querySelectorAll('#paiguBody .paigu-head')].map((h) => h.textContent);
    expect(doc.querySelector('#paiguBody .pq-img[src="https://img.example/p1.jpg"]')).not.toBeNull();
    expect(heads.some((t) => t.includes('¥211'))).toBe(true); // 主档人民币价
    expect(heads.some((t) => t.includes('—'))).toBe(true);    // o3 植绒：主档无价、订单无人民币价
    doc.querySelector('[data-pact="switch-type"][data-type=""]').click(); // 未分类 sheet
    heads = [...doc.querySelectorAll('#paiguBody .paigu-head')].map((h) => h.textContent);
    expect(heads.some((t) => t.includes('¥30'))).toBe(true);  // 主档缺价回落订单价
  });

  it('超排标记与「删除超排」按钮：毛绒|皮卡丘土王 限 2，补一手动排位后第 3 位标红', async () => {
    await P().insertSlot(ACT, '毛绒|皮卡丘土王', '临时插队', 3, []);
    P().openActivity(ACT);
    const body = doc.getElementById('paiguBody');
    expect(body.textContent).toContain('超排 1');
    expect(body.querySelector('[data-pact="purge-over"]')).not.toBeNull();
    const overCell = [...body.querySelectorAll('.paigu-cell')].find((c) => c.classList.contains('pq-over'));
    expect(overCell).not.toBeNull();
    expect(overCell.textContent).toContain('临时插队');
  });
});

describe('纯计算（类型聚合 / 归属 / 统计 / 买家信息）', () => {
  it('sheetTypes：主档类型序优先（毛绒、发卡），订单空类型补「未分类」语义', () => {
    expect(P().sheetTypes(aoi.state.data, ACT)).toEqual(['毛绒', '发卡', '']);
  });

  it('activityProducts：主档顺序优先带图与价，订单补列排尾（按 key 字典序）', () => {
    const cols = P().activityProducts(aoi.state.data, ACT);
    expect(cols.map((c) => c.key)).toEqual(['毛绒|皮卡丘土王', '毛绒|圣诞树皮卡丘', '发卡|星之卡比发卡', '|无类型散货', '毛绒|圣诞节植绒']);
    const p1 = cols[0];
    expect(p1.master).toBe(true);
    expect(p1.refImage).toContain('p1.jpg');
    expect(p1.priceOrig).toBe(5500);
    const o4 = cols.find((c) => c.key === '|无类型散货');
    expect(o4.master).toBe(false);
    expect(o4.price).toBe(30);
  });

  it('membership：orderId 定位排位；手动排位（无 orderId）不入 map', () => {
    const mem = P().membership(aoi.state.data);
    expect(mem.o1.slot.id).toBe('s1');
    expect(mem.o1.activity).toBe(ACT);
    expect(Object.keys(mem)).toHaveLength(2); // o1、o2；s3 手动排位不入
  });

  it('activityStats：排位计数 + 超排计数（限 2 排 2 不超；限 2 排 3 超 1）', () => {
    expect(P().activityStats(aoi.state.data, ACT)).toEqual({ slots: 3, over: 0 });
    aoi.state.data.paigu[ACT].slots['毛绒|皮卡丘土王'].push({ id: 'sx', buyer: '临时', status: '未付款' });
    expect(P().activityStats(aoi.state.data, ACT)).toEqual({ slots: 4, over: 1 });
  });

  it('buyerInfo：聚合 memberMeta.qq / addresses / 该活动订单；无记录回落占位', () => {
    const b = P().buyerInfo(aoi.state.data, ACT, '一枚小混子');
    expect(b.qq).toBe('1272822692');
    expect(b.address).toContain('浦东');
    expect(b.orders.map((o) => o.id)).toEqual(['o1']);
    const none = P().buyerInfo(aoi.state.data, ACT, '路人甲');
    expect(none.qq).toBe('');
    expect(none.orders).toHaveLength(0);
  });

  it('纯计算不改数据（零干扰）', () => {
    const before = JSON.stringify(aoi.state.data);
    P().sheetTypes(aoi.state.data, ACT);
    P().activityProducts(aoi.state.data, ACT);
    P().membership(aoi.state.data);
    P().activityStats(aoi.state.data, ACT);
    P().buyerInfo(aoi.state.data, ACT, '一枚小混子');
    expect(JSON.stringify(aoi.state.data)).toBe(before);
  });
});

describe('数据动作（入排防重 / 插排顺延 / 改状态 / 调序 / 撤排 / 超排）', () => {
  it('enqueueOrders：o3 入排队尾（默认未付款）+ 落库 + 日志', async () => {
    const r = await P().enqueueOrders(ACT, ['o3']);
    expect(r).toEqual({ added: 1, skipped: 0 });
    const arr = aoi.state.data.paigu[ACT].slots['毛绒|圣诞节植绒'];
    expect(arr).toHaveLength(1);
    expect(arr[0].orderId).toBe('o3');
    expect(arr[0].buyer).toBe('C.tough');
    expect(arr[0].status).toBe('未付款');
    expect(aoi.saveTeamData).toHaveBeenCalledWith(aoi.state.data);
    expect(aoi.state.data.paigu[ACT].log[0].text).toContain('添加 1 笔订单入排');
  });

  it('enqueueOrders 防重：已排订单跳过；全部已排时不落库', async () => {
    const r = await P().enqueueOrders(ACT, ['o1', 'o3']);
    expect(r).toEqual({ added: 1, skipped: 1 });
    expect(aoi.saveTeamData).toHaveBeenCalledTimes(1);
    aoi.saveTeamData.mockClear();
    const r2 = await P().enqueueOrders(ACT, ['o1', 'o2']);
    expect(r2.added).toBe(0);
    expect(aoi.saveTeamData).not.toHaveBeenCalled();
    expect(aoi.state.data.paigu[ACT].slots['毛绒|皮卡丘土王']).toHaveLength(2);
  });

  it('insertSlot 手动排位插第 1 位：后续顺延，无 orderId', async () => {
    const n = await P().insertSlot(ACT, '毛绒|皮卡丘土王', '插队侠', 1, []);
    expect(n).toBe(1);
    const arr = aoi.state.data.paigu[ACT].slots['毛绒|皮卡丘土王'];
    expect(arr).toHaveLength(3);
    expect(arr[0].buyer).toBe('插队侠');
    expect(arr[0].orderId).toBeUndefined();
    expect(arr[1].slot ?? arr[1].buyer).toBe('一枚小混子');
    expect(arr[2].buyer).toBe('草莓头那个莹');
    expect(aoi.state.data.paigu[ACT].log[0].text).toContain('第 1 位');
  });

  it('insertSlot 带未入排订单 + 手动名：一并插入且订单防重', async () => {
    const n = await P().insertSlot(ACT, '毛绒|圣诞节植绒', '手动甲', 1, ['o3', 'o1']);
    expect(n).toBe(2); // o3 入列；o1 已在排被跳过；手动甲入列
    const arr = aoi.state.data.paigu[ACT].slots['毛绒|圣诞节植绒'];
    expect(arr[0].orderId).toBe('o3');
    expect(arr[1].buyer).toBe('手动甲');
  });

  it('setStatus：状态写入 + 日志含方向；非法状态与未知排位被拒', async () => {
    const s = await P().setStatus(ACT, 's2', '已付款');
    expect(s.status).toBe('已付款');
    expect(aoi.state.data.paigu[ACT].log[0].text).toContain('未付款 → 已付款');
    expect(aoi.saveTeamData).toHaveBeenCalledWith(aoi.state.data);
    expect(await P().setStatus(ACT, 's2', '不存在的状态')).toBeNull();
    expect(await P().setStatus(ACT, 'nope', '已付款')).toBeNull();
  });

  it('setStatus 相同状态 no-op（不重复落库）', async () => {
    aoi.saveTeamData.mockClear();
    await P().setStatus(ACT, 's1', '已下定');
    expect(aoi.saveTeamData).not.toHaveBeenCalled();
  });

  it('moveSlot：上移交换、边界不动', async () => {
    expect(await P().moveSlot(ACT, 's2', -1)).toBe(true);
    let arr = aoi.state.data.paigu[ACT].slots['毛绒|皮卡丘土王'];
    expect(arr[0].id).toBe('s2');
    expect(await P().moveSlot(ACT, 's2', -1)).toBe(false); // 已在第 1 位
    expect(await P().moveSlot(ACT, 's2', 1)).toBe(true);
    arr = aoi.state.data.paigu[ACT].slots['毛绒|皮卡丘土王'];
    expect(arr[0].id).toBe('s1');
    expect(aoi.state.data.paigu[ACT].log[0].text).toContain('调序');
  });

  it('removeSlot：撤排出队，订单本身不动', async () => {
    await P().removeSlot(ACT, 's1');
    const arr = aoi.state.data.paigu[ACT].slots['毛绒|皮卡丘土王'];
    expect(arr.map((s) => s.id)).toEqual(['s2']);
    expect(aoi.state.data.orders.find((o) => o.id === 'o1')).toBeTruthy();
    expect(aoi.state.data.paigu[ACT].log[0].text).toContain('撤排');
  });

  it('unlinkSlot：悬空订单转手动排位（去 orderId 保留买家）', async () => {
    aoi.state.data.orders = aoi.state.data.orders.filter((o) => o.id !== 'o1'); // 模拟订单管理删除
    await P().unlinkSlot(ACT, 's1');
    const s1 = aoi.state.data.paigu[ACT].slots['毛绒|皮卡丘土王'][0];
    expect(s1.orderId).toBeUndefined();
    expect(s1.buyer).toBe('一枚小混子');
  });

  it('purgeOver：删除限购键尾部超排，confirm 拒绝则不动；无超排提示', async () => {
    await P().insertSlot(ACT, '毛绒|皮卡丘土王', '临时插队', 3, []);
    aoi.confirm = vi.fn(async () => false);
    expect(await P().purgeOver(ACT)).toBe(0);
    expect(aoi.state.data.paigu[ACT].slots['毛绒|皮卡丘土王']).toHaveLength(3);
    aoi.confirm = vi.fn(async () => true);
    expect(await P().purgeOver(ACT)).toBe(1);
    expect(aoi.state.data.paigu[ACT].slots['毛绒|皮卡丘土王']).toHaveLength(2);
    expect(aoi.state.data.paigu[ACT].log[0].text).toContain('删除超排 1 个');
    expect(await P().purgeOver(ACT)).toBe(0); // 已无超排
  });

  it('日志上限 LOG_CAP：超出后仍保持 300 条（新的在前）', async () => {
    const t = aoi.state.data.paigu[ACT];
    t.log = [];
    for (let i = 0; i < P().LOG_CAP + 5; i++) t.log.unshift({ at: 'x', text: '第' + i });
    await P().setStatus(ACT, 's2', '已付款');
    expect(t.log).toHaveLength(P().LOG_CAP);
    expect(t.log[0].text).toContain('未付款 → 已付款');
  });
});

describe('弹层交互（统一委托 [data-pact] / 右键 / Esc / 遮罩）', () => {
  it('点排位格 → 操作菜单：5 状态按钮 + 当前态 ✓ + 撤排', () => {
    P().openActivity(ACT);
    doc.querySelector('[data-pact="slot"][data-slot="s1"]').click();
    expect(doc.getElementById('paiguModal').classList.contains('hidden')).toBe(false);
    expect(doc.querySelectorAll('[data-pact="set-status"]')).toHaveLength(5);
    expect(doc.querySelector('[data-pact="set-status"][data-status="已下定"]').textContent).toContain('✓');
    expect(doc.querySelector('[data-pact="slot-remove"]')).not.toBeNull();
  });

  it('点状态按钮 → 即改 + 关弹层 + 落库', async () => {
    P().openActivity(ACT);
    doc.querySelector('[data-pact="slot"][data-slot="s2"]').click();
    doc.querySelector('[data-pact="set-status"][data-status="已付尾款"]').click();
    await new Promise((r) => setTimeout(r, 0));
    expect(aoi.state.data.paigu[ACT].slots['毛绒|皮卡丘土王'][1].status).toBe('已付尾款');
    expect(aoi.saveTeamData).toHaveBeenCalledWith(aoi.state.data);
    expect(doc.getElementById('paiguModal').classList.contains('hidden')).toBe(true);
  });

  it('右键排位格 → preventDefault 并打开同一菜单', () => {
    P().openActivity(ACT);
    const cell = doc.querySelector('[data-pact="slot"][data-slot="s1"]');
    const ev = new win.MouseEvent('contextmenu', { bubbles: true, cancelable: true });
    cell.dispatchEvent(ev);
    expect(ev.defaultPrevented).toBe(true);
    expect(doc.getElementById('paiguModal').classList.contains('hidden')).toBe(false);
  });

  it('悬空订单：菜单显示「订单已删除」+「转为手动排位」；正常订单不显示', async () => {
    aoi.state.data.orders = aoi.state.data.orders.filter((o) => o.id !== 'o1');
    P().openActivity(ACT);
    doc.querySelector('[data-pact="slot"][data-slot="s1"]').click();
    expect(doc.getElementById('paiguModalBox').textContent).toContain('订单已删除');
    expect(doc.querySelector('[data-pact="slot-unlink"]')).not.toBeNull();
    doc.querySelector('[data-pact="modal-close"]').click();
    doc.querySelector('[data-pact="slot"][data-slot="s2"]').click();
    expect(doc.getElementById('paiguModalBox').textContent).not.toContain('转为手动排位');
  });

  it('点空格 → 插排弹窗；勾选订单+填买家名一并插入并关层', async () => {
    P().openActivity(ACT);
    doc.querySelector('[data-pact="insert"][data-key="毛绒|圣诞节植绒"][data-idx="1"]').click();
    expect(doc.getElementById('paiguModal').classList.contains('hidden')).toBe(false);
    doc.querySelector('.pq-ins-check[data-order="o3"]').checked = true;
    doc.getElementById('paiguInsBuyer').value = ' 手动乙 ';
    doc.querySelector('[data-pact="insert-save"]').click();
    await new Promise((r) => setTimeout(r, 0));
    const arr = aoi.state.data.paigu[ACT].slots['毛绒|圣诞节植绒'];
    expect(arr).toHaveLength(2);
    expect(arr[0].orderId).toBe('o3');
    expect(arr[1].buyer).toBe('手动乙');
    expect(doc.getElementById('paiguModal').classList.contains('hidden')).toBe(true);
  });

  it('添加订单弹窗：已排置灰 disabled；勾选未排保存入排并关层', async () => {
    P().openActivity(ACT);
    doc.querySelector('[data-pact="add-orders"]').click();
    const disabled = doc.querySelector('.pq-add-check[data-order="o1"]');
    expect(disabled.disabled).toBe(true);
    doc.querySelector('.pq-add-check[data-order="o3"]').checked = true;
    doc.querySelector('[data-pact="add-orders-save"]').click();
    await new Promise((r) => setTimeout(r, 0));
    expect(aoi.state.data.paigu[ACT].slots['毛绒|圣诞节植绒']).toHaveLength(1);
    expect(doc.getElementById('paiguModal').classList.contains('hidden')).toBe(true);
  });

  it('买家信息弹窗：QQ / 送达地址 / 该活动订单；无订单提示手动排位', () => {
    P().openActivity(ACT);
    doc.querySelector('[data-pact="slot"][data-slot="s1"]').click();
    doc.querySelector('[data-pact="buyer-info"]').click();
    const box = doc.getElementById('paiguModalBox').textContent;
    expect(box).toContain('1272822692');
    expect(box).toContain('上海市浦东新区');
    expect(box).toContain('皮卡丘土王');
    doc.querySelector('[data-pact="modal-close"]').click();
    doc.querySelector('[data-pact="switch-type"][data-type="发卡"]').click(); // s3 在发卡 sheet
    doc.querySelector('[data-pact="slot"][data-slot="s3"]').click();
    doc.querySelector('[data-pact="buyer-info"]').click();
    expect(doc.getElementById('paiguModalBox').textContent).toContain('暂无正式订单');
  });

  it('排谷日志弹窗：展示历史记录', () => {
    P().openActivity(ACT);
    doc.querySelector('[data-pact="log"]').click();
    expect(doc.getElementById('paiguModalBox').textContent).toContain('seed 日志');
  });

  it('图例折叠切换', () => {
    P().openActivity(ACT);
    expect(doc.getElementById('paiguLegend').classList.contains('hidden')).toBe(true);
    doc.querySelector('[data-pact="legend-toggle"]').click();
    expect(doc.getElementById('paiguLegend').classList.contains('hidden')).toBe(false);
  });

  it('Esc 关弹层；点遮罩关、点弹窗内部不关', () => {
    P().openActivity(ACT);
    doc.querySelector('[data-pact="slot"][data-slot="s1"]').click();
    doc.dispatchEvent(new win.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect(doc.getElementById('paiguModal').classList.contains('hidden')).toBe(true);
    doc.querySelector('[data-pact="slot"][data-slot="s1"]').click();
    doc.getElementById('paiguModalBox').click();
    expect(doc.getElementById('paiguModal').classList.contains('hidden')).toBe(false);
    doc.getElementById('paiguModal').click();
    expect(doc.getElementById('paiguModal').classList.contains('hidden')).toBe(true);
  });

  it('返回列表 / 切类型 tab', () => {
    P().openActivity(ACT);
    doc.querySelector('[data-pact="switch-type"][data-type="发卡"]').click();
    expect(doc.getElementById('paiguBody').querySelector('[data-pact="slot"][data-slot="s3"]')).not.toBeNull();
    expect(doc.getElementById('paiguBody').querySelector('[data-pact="slot"][data-slot="s1"]')).toBeNull();
    doc.querySelector('[data-pact="back"]').click();
    expect(doc.getElementById('paiguBody').textContent).toContain('打开排谷表');
  });
});

describe('导出（buildWorkbook 纯函数 / exceljs 通道）', () => {
  it('每类型一个 Sheet + 排谷日志：种类/参考图/单价/库存四行头 + 位次行买家与状态填充（v3.28.0 表头加库存行）', () => {
    const desc = P().buildWorkbook(aoi.state.data, ACT);
    expect(desc.sheets.map((s) => s.name)).toEqual(['毛绒', '发卡', '未分类', '排谷日志']);
    const mz = desc.sheets[0];
    expect(mz.rows[0][0].v).toBe('种类');
    expect(mz.rows[0][1].v).toBe('皮卡丘土王');
    expect(mz.rows[1][1].s.img).toContain('p1.jpg');   // 参考图内嵌标记
    expect(mz.rows[2][1].v).toBe('JP¥5500');            // 主档外币原价+币种符号
    expect(mz.rows[3][0].v).toBe('库存');               // v3.28.0：库存行（未设置时空串）
    // 第 1 位 = s1 一枚小混子（已下定=绿 BBF7D0）；第 2 位 = s2（未付款=黄 FEF3C7）
    expect(mz.rows[4][0].v).toBe(1);
    expect(mz.rows[4][1].v).toBe('一枚小混子');
    expect(mz.rows[4][1].s.fill).toBe('BBF7D0');
    expect(mz.rows[5][1].v).toBe('草莓头那个莹');
    expect(mz.rows[5][1].s.fill).toBe('FEF3C7');
    expect(mz.rows).toHaveLength(14); // 表头 4 行 + 位次 10 行
    const lg = desc.sheets[3];
    expect(lg.rows[1][1].v).toBe('seed 日志');
  });

  it('未分类 sheet 名回退；无排谷数据返回空 sheets', () => {
    aoi.state.data.paigu[ACT].slots['|无类型散货'] = [{ id: 's9', buyer: '依遇蜜柑', status: '未付款' }];
    let desc = P().buildWorkbook(aoi.state.data, ACT);
    expect(desc.sheets.map((s) => s.name)).toContain('未分类');
    aoi.state.data.paigu = {};
    desc = P().buildWorkbook(aoi.state.data, ACT);
    expect(desc.sheets).toHaveLength(0);
  });

  it('exportActivity：exceljs 通道渲染 + loading 收尾；无数据 toast 拒绝', async () => {
    win.ExcelJS = { Workbook: function () {} };
    const spy = vi.spyOn(aoi.exportSummary, 'renderExcelJS').mockReturnValue(Promise.resolve());
    P().exportActivity(ACT);
    expect(spy).toHaveBeenCalled();
    const desc = spy.mock.calls[0][0];
    expect(desc.sheets.length).toBeGreaterThanOrEqual(2);
    spy.mockRestore();
    delete win.ExcelJS;
    aoi.state.data.paigu = {};
    P().exportActivity(ACT); // 空数据：toast + return，不抛错
  });
});
