// v3.30.2 导航/刷新统一渲染注册表（VIEW_RENDERERS）测试
// 背景：此前 Aoi.renderView 只覆盖部分视图（历史逐版本增量补的白名单），订单/国际计算/
// 审批/发货等核心业务页缺席——它们只在登录时渲染一次，跨页改动不可见、「↻ 刷新」在
// 那些页是空操作（仅弹 toast）。v3.30.2 起全部视图统一登记，nav / 刷新 / 撤销三处同源。
// 覆盖：注册表覆盖全部视图 / nav 进入与 navRefresh 对国际计算、订单页真实重渲染 /
// 「标记到货」后直接导航国际计算立即可见（用户实测场景，此前需 F5）/ 批次下拉选中态
// 跨导航保持 / refreshViews 与注册表同源且不触发工单网络拉取 / navRefresh 仅确有
// 重渲染时提示成功
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { aoi, doc, win } from './helpers/aoi.js';

const ACT = '8.23涩谷场外';
const BATCH = { id: 'b1', date: '2026-10-29' };

function seedData() {
  aoi.state.data = {
    orders: [
      { id: 'o1', activity: ACT, type: '毛绒', model: '皮卡丘土王', buyer: '一枚小混子', currency: 'jpy', priceOrig: 5500, price: null, count: 1, status: '未到货', batchId: null }
    ],
    activities: [ACT],
    activityMeta: { [ACT]: { products: [] } },
    batches: [BATCH],
    payments: [], notifications: [], announcements: [], reservoirs: [],
    typeMeta: {}, ipTypes: {}, addresses: {}, memberMeta: {},
    cnChanges: [],
    calc: { jpyRate: 0.048, jpyMarkup: 0, krwRate: 0.0053, krwMarkup: 0 }
  };
  aoi.saveTeamData = vi.fn(async function (data) { return data; });
}

beforeEach(() => {
  win.localStorage.clear();
  seedData();
  aoi.navHistory.length = 0;
  aoi.setShell('classic');
  doc.querySelectorAll('[data-view]').forEach((el) => el.classList.add('hidden'));
});

function showOnly(viewId) {
  doc.querySelectorAll('[data-view]').forEach((el) => el.classList.add('hidden'));
  doc.getElementById(viewId).classList.remove('hidden');
}

describe('VIEW_RENDERERS 注册表', () => {
  it('覆盖 DOM 中全部 [data-view] 视图（v3.30.2 修复点：核心业务页不再缺席）', () => {
    const missing = Array.from(doc.querySelectorAll('[data-view]'))
      .map((el) => el.id)
      .filter((id) => typeof aoi.VIEW_RENDERERS[id] !== 'function');
    expect(missing).toEqual([]);
  });

  it('renderView 对无注册项的视图返回 false（防御分支）', () => {
    expect(aoi.renderView('view-nonexistent')).toBe(false);
    expect(aoi.renderView('view-intl')).toBe(true);
  });

  it('view-approval 渲染器连带刷新改圈名申请表（cnChangeTbody 在审批视图内）', () => {
    aoi.state.data.cnChanges = [{ id: 'c1', oldCn: '旧圈名', newCn: '新圈名', qq: '123', date: '2026-10-29', status: '待处理' }];
    aoi.renderView('view-approval');
    expect(doc.getElementById('cnChangeTbody').textContent).toContain('新圈名');
  });
});

describe('nav / navRefresh 对核心业务页真实重渲染（此前为空操作）', () => {
  it('国际计算：已选批次页，别处标记到货后「↻ 刷新」/重新进入均立即出现', () => {
    // 用户先到国际计算选中批次 b1（此时订单未到货，表格无该商品）
    aoi.nav('view-intl');
    doc.getElementById('intlBatch').value = 'b1';
    aoi.intl.render();
    expect(doc.getElementById('intlTbody').textContent).not.toContain('皮卡丘土王');
    // 数据层把订单标记到货（markArrived 的数据效果：status + batchId）
    aoi.state.data.orders[0].status = '已到货';
    aoi.state.data.orders[0].batchId = 'b1';
    // 旧实现：tbody 保持旧渲染、↻ 是空操作；新实现：不重选批次，刷新即见
    aoi.navRefresh();
    expect(doc.getElementById('intlTbody').textContent).toContain('皮卡丘土王');
    // 再增一笔同批订单，导航离开再回来（不重选批次）→ 进页即见
    aoi.state.data.orders.push({ id: 'o2', activity: ACT, type: '小卡', model: 'aespa 小卡', buyer: 'キム', currency: 'jpy', priceOrig: 800, price: null, count: 2, status: '已到货', batchId: 'b1' });
    aoi.nav('view-orders');
    aoi.nav('view-intl');
    expect(doc.getElementById('intlTbody').textContent).toContain('aespa 小卡');
  });

  it('订单页：数据在别处被改型号后，重新进入即显示新值（跨页同步）', () => {
    aoi.nav('view-orders');
    expect(doc.getElementById('orderTbody').textContent).toContain('皮卡丘土王');
    // 模拟活动管理商品卡改型号对同键订单的改写（saveActProduct 的数据层效果）
    aoi.state.data.orders[0].type = '挂画';
    aoi.state.data.orders[0].model = '宝可梦中心挂画';
    aoi.nav('view-activities');
    aoi.nav('view-orders');
    const tb = doc.getElementById('orderTbody').textContent;
    expect(tb).toContain('宝可梦中心挂画');
    expect(tb).not.toContain('皮卡丘土王');
  });

  it('用户实测场景：已选批次 → 订单管理「标记到货」→ 回国际计算立即可见（此前需 F5）', async () => {
    aoi.nav('view-intl');
    doc.getElementById('intlBatch').value = 'b1';
    aoi.intl.render();
    aoi.nav('view-orders');
    const cb = doc.querySelector('.row-check[data-id="o1"]');
    cb.checked = true;
    doc.getElementById('arriveBatchSel').value = 'b1';
    await aoi.orders.markArrived();
    expect(aoi.state.data.orders[0].status).toBe('已到货');
    aoi.nav('view-intl');
    expect(doc.getElementById('intlBatch').value).toBe('b1');
    expect(doc.getElementById('intlTbody').textContent).toContain('皮卡丘土王');
  });

  it('国际计算批次下拉选中态跨导航保持（refillBatchSelect 选中保持）', () => {
    aoi.state.data.orders[0].batchId = 'b1';
    aoi.nav('view-intl');
    doc.getElementById('intlBatch').value = 'b1';
    aoi.intl.render();
    aoi.nav('view-orders');
    aoi.nav('view-intl');
    expect(doc.getElementById('intlBatch').value).toBe('b1');
    expect(doc.getElementById('intlTbody').textContent).toContain('皮卡丘土王');
  });
});

describe('refreshViews 与注册表同源（撤销恢复路径）', () => {
  it('走注册表全量重画（订单/国际计算渲染器被调用）且不触发工单网络拉取', () => {
    const loadSpy = vi.spyOn(aoi.tickets, 'load');
    const orderSpy = vi.spyOn(aoi.orders, 'render');
    const intlSpy = vi.spyOn(aoi.intl, 'render');
    aoi.refreshViews();
    expect(orderSpy).toHaveBeenCalled();
    expect(intlSpy).toHaveBeenCalled();
    expect(loadSpy).not.toHaveBeenCalled();
    orderSpy.mockRestore();
    intlSpy.mockRestore();
    loadSpy.mockRestore();
  });
});

describe('navRefresh 提示语义', () => {
  it('确有重渲染时提示成功；无注册项视图提示 info 而非伪成功', () => {
    const spy = vi.spyOn(aoi, 'toast');
    showOnly('view-intl');
    aoi.state.data.orders[0].batchId = 'b1';
    aoi.navRefresh();
    expect(spy).toHaveBeenLastCalledWith('已刷新当前页面', 'success');
    const ghost = doc.createElement('div');
    ghost.id = 'view-ghost';
    ghost.setAttribute('data-view', '');
    doc.getElementById('screen-app').appendChild(ghost);
    doc.getElementById('view-intl').classList.add('hidden');
    ghost.classList.remove('hidden');
    aoi.navRefresh();
    expect(spy).toHaveBeenLastCalledWith('当前页面暂无可刷新内容', 'info');
    ghost.remove();
    spy.mockRestore();
  });
});
