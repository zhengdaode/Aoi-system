// v3.23.0 三连——①QQ 工单快捷导航（navOf/step）；②购买计划批量状态 + 一键恢复默认；
// ③活动商品与订单同步（订单删改后清理无订单商品）+ 商品卡制品类型可改。
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { aoi, doc } from './helpers/aoi.js';

// —— ① QQ 工单快捷跳转 ——

describe('aoi.tickets 快捷导航（v3.23.0）', () => {
  beforeEach(() => {
    aoi.tickets.rows = [
      { id: 'T1', cn: '甲', status: 'open' },
      { id: 'T2', cn: '乙', status: 'working' },
      { id: 'T3', cn: '丙', status: 'open' }
    ];
    aoi.tickets.current = null;
  });

  it('navOf：首条无上一条、末条无下一条、位置指示 n/total', () => {
    expect(aoi.tickets.navOf('T1')).toMatchObject({ prevId: null, nextId: 'T2', pos: '1/3' });
    expect(aoi.tickets.navOf('T2')).toMatchObject({ prevId: 'T1', nextId: 'T3', pos: '2/3' });
    expect(aoi.tickets.navOf('T3')).toMatchObject({ prevId: 'T2', nextId: null, pos: '3/3' });
    expect(aoi.tickets.navOf('不存在')).toMatchObject({ idx: -1, pos: '-', prevId: null, nextId: null });
  });

  it('step：在下一条/上一条之间跳转，到端点提示且不动', () => {
    aoi.tickets.current = aoi.tickets.rows[0];
    aoi.tickets.step(1);
    expect(aoi.tickets.current.id).toBe('T2');
    aoi.tickets.step(1);
    expect(aoi.tickets.current.id).toBe('T3');
    aoi.tickets.step(1); // 端点：toast 提示，仍停 T3
    expect(aoi.tickets.current.id).toBe('T3');
    aoi.tickets.step(-1);
    expect(aoi.tickets.current.id).toBe('T2');
    aoi.tickets.step(-1);
    aoi.tickets.step(-1); // 首条端点
    expect(aoi.tickets.current.id).toBe('T1');
  });

  it('详情卡渲染上/下一条按钮与位置指示', () => {
    doc.getElementById('ticketDetail').classList.remove('hidden');
    aoi.tickets.openDetail('T2');
    const html = doc.getElementById('ticketDetail').innerHTML;
    expect(html).toContain('Aoi.tickets.step(1)');
    expect(html).toContain('Aoi.tickets.step(-1)');
    expect(html).toContain('2/3');
    aoi.tickets.closeDetail();
  });

  it('step：未打开详情卡时为空操作', () => {
    aoi.tickets.current = null;
    aoi.tickets.step(1);
    expect(aoi.tickets.current).toBeNull();
  });
});

// —— ② 购买计划批量状态 + 一键恢复默认 ——

describe('aoi.limits 批量购买状态（v3.23.0）', () => {
  beforeEach(() => {
    aoi.saveTeamData = vi.fn().mockResolvedValue(undefined);
    aoi.confirm = vi.fn().mockResolvedValue(true);
    aoi.state.data = {
      activities: ['CP27'],
      typeMeta: {},
      orders: [],
      limitPlans: {
        CP27: {
          activity: 'CP27', freeShip: 0, freeShipRmb: 0, freeCur: 'cny',
          accountsCount: 2, maxTypes: 0, limits: {},
          items: [
            { index: 1, total: 40, diff: 0, reached: true, items: [
              { type: '吧唧', model: 'M1', qty: 2, price: 10, amount: 20, status: '已购买' },
              { type: '色纸', model: 'S1', qty: 1, price: 10, amount: 10, status: '已购买' },
              { type: '立牌', model: 'L1', qty: 1, price: 10, amount: 10, status: '待购买' }
            ] },
            { index: 2, total: 10, diff: 0, reached: true, items: [
              { type: '吧唧', model: 'M1', qty: 1, price: 10, amount: 10, status: '购买失败' }
            ] }
          ],
          remaining: []
        }
      }
    };
  });

  it('batchStatusCount：统计与目标状态不同的条目数', () => {
    const stored = aoi.state.data.limitPlans.CP27;
    expect(aoi.limits.batchStatusCount(stored, '待购买')).toBe(3);
    expect(aoi.limits.batchStatusCount(stored, '已购买')).toBe(2);
    expect(aoi.limits.batchStatusCount(stored, '购买失败')).toBe(3);
  });

  it('batchSetStatus：全部条目统一设为指定状态，落库 + 可撤销 + 双侧重渲染', async () => {
    await aoi.limits.batchSetStatus('CP27', '已购买');
    const items = aoi.state.data.limitPlans.CP27.items.flatMap(a => a.items);
    expect(items.every(it => it.status === '已购买')).toBe(true);
    expect(aoi.saveTeamData).toHaveBeenCalled();
    expect(aoi.undo.label).toBe('批量修改购买状态');
  });

  it('batchSetStatus：确认取消不改数据', async () => {
    aoi.confirm = vi.fn().mockResolvedValue(false);
    await aoi.limits.batchSetStatus('CP27', '已购买');
    const statuses = aoi.state.data.limitPlans.CP27.items.flatMap(a => a.items).map(it => it.status);
    expect(statuses).toEqual(['已购买', '已购买', '待购买', '购买失败']);
    expect(aoi.saveTeamData).not.toHaveBeenCalled();
  });

  it('resetStatuses：一键恢复默认（全部待购买）', async () => {
    await aoi.limits.resetStatuses('CP27');
    const items = aoi.state.data.limitPlans.CP27.items.flatMap(a => a.items);
    expect(items.every(it => it.status === '待购买')).toBe(true);
    expect(aoi.undo.label).toBe('购买状态恢复默认');
  });

  it('batchSetStatus：非法状态与无计划活动不动数据', async () => {
    await aoi.limits.batchSetStatus('CP27', '');
    await aoi.limits.batchSetStatus('不存在', '已购买');
    expect(aoi.saveTeamData).not.toHaveBeenCalled();
    const statuses = aoi.state.data.limitPlans.CP27.items.flatMap(a => a.items).map(it => it.status);
    expect(statuses).toEqual(['已购买', '已购买', '待购买', '购买失败']);
  });

  it('计划弹窗工具栏渲染批量操作控件', () => {
    aoi.limits.openActPlan('CP27');
    const html = doc.getElementById('actPlanBody').innerHTML;
    expect(html).toContain('actPlanBatchSel');
    expect(html).toContain('一键恢复默认');
    aoi.limits.closeActPlan();
  });
});

// —— ③ 活动商品与订单同步（清理无订单商品）——

describe('aoi.orders 无订单商品清理（v3.23.0）', () => {
  beforeEach(() => {
    aoi.saveTeamData = vi.fn().mockResolvedValue(undefined);
    aoi.confirm = vi.fn().mockResolvedValue(true);
    aoi.orders.expandedActivities = {};
    aoi.state.data = {
      activities: ['CP27'],
      activityMeta: {
        CP27: {
          products: [
            { id: 'p1', type: '吧唧', model: 'M1' },                       // 有订单 → 保留
            { id: 'p2', type: '吧唧', model: 'M2' },                       // 无订单无计划 → 孤儿
            { id: 'p3', type: '立牌', model: 'L1' },                       // 在购买计划 → 保留
            { id: 'p4', type: '卡套', model: 'K1', listed: true },         // 上架橱窗 → 保留
            { id: 'p5', type: '徽章', model: 'H1' }                        // 无订单（另一波及键） → 孤儿
          ]
        }
      },
      typeMeta: {},
      orders: [
        { id: 'o1', activity: 'CP27', type: '吧唧', model: 'M1', count: 1, buyer: '甲', status: '未到货' }
      ],
      limitPlans: {
        CP27: { activity: 'CP27', items: [{ index: 1, items: [{ type: '立牌', model: 'L1', qty: 1, status: '待购买' }] }] }
      }
    };
  });

  it('noOrderProducts：仅命中「无订单 ∧ 不在计划 ∧ 未上架」的商品', () => {
    const orphans = aoi.orders.noOrderProducts(aoi.state.data, 'CP27', null);
    expect(orphans.map(p => p.id).sort()).toEqual(['p2', 'p5']);
  });

  it('noOrderProducts：keys 限定波及面，计划内/上架的不算孤儿', () => {
    const orphans = aoi.orders.noOrderProducts(aoi.state.data, 'CP27', ['吧唧|M1', '吧唧|M2']);
    expect(orphans.map(p => p.id)).toEqual(['p2']);
    expect(aoi.orders.noOrderProducts(aoi.state.data, 'CP27', ['吧唧|M1'])).toEqual([]);
  });

  it('pruneOrphanProducts：移除命中键的孤儿并返回数量（不落库）', () => {
    const d = aoi.state.data;
    expect(aoi.orders.pruneOrphanProducts(d, 'CP27', ['吧唧|M2', '吧唧|M1'])).toBe(1);
    expect(d.activityMeta.CP27.products.map(p => p.id)).toEqual(['p1', 'p3', 'p4', 'p5']);
  });

  it('batchDelete：删除订单后同步清理失去全部订单的商品', async () => {
    doc.body.insertAdjacentHTML('beforeend', '<input type="checkbox" class="row-check" data-id="o1" checked>');
    await aoi.orders.batchDelete();
    const ids = aoi.state.data.activityMeta.CP27.products.map(p => p.id);
    expect(aoi.state.data.orders.length).toBe(0);
    expect(ids).toEqual(['p2', 'p3', 'p4', 'p5']); // p1（吧唧M1）订单删光 → 连带清理；p2 不在波及键内保留
    doc.querySelector('.row-check[data-id="o1"]').remove();
  });

  it('saveEdit：改型号后旧键商品失去全部订单 → 同步清理', async () => {
    const o1 = aoi.state.data.orders[0];
    aoi.orders.openEdit('o1');
    doc.getElementById('eModel').value = 'M9';
    await aoi.orders.saveEdit();
    const ids = aoi.state.data.activityMeta.CP27.products.map(p => p.id);
    expect(o1.model).toBe('M9');
    expect(ids).toEqual(['p2', 'p3', 'p4', 'p5']); // p1（吧唧M1）成孤儿被清理
  });

  it('pruneNoOrderProducts：手动清理整活动孤儿（确认 + 撤销保护）', async () => {
    const n = await aoi.orders.pruneNoOrderProducts('CP27');
    expect(n).toBe(2);
    const ids = aoi.state.data.activityMeta.CP27.products.map(p => p.id);
    expect(ids).toEqual(['p1', 'p3', 'p4']);
    expect(aoi.undo.label).toBe('清理无订单商品');
  });

  it('pruneNoOrderProducts：无孤儿时提示且不弹确认', async () => {
    aoi.confirm = vi.fn().mockResolvedValue(true);
    aoi.state.data.activityMeta.CP27.products = [{ id: 'p1', type: '吧唧', model: 'M1' }];
    const n = await aoi.orders.pruneNoOrderProducts('CP27');
    expect(n).toBe(0);
    expect(aoi.confirm).not.toHaveBeenCalled();
  });

  it('展开区工具行渲染「清理无订单商品」按钮', () => {
    aoi.orders.toggleActivityExpand('CP27');
    expect(doc.getElementById('activityTbody').innerHTML).toContain('data-act-prune="CP27"');
  });
});

// —— ④ 商品卡制品类型可改 ——

describe('aoi.orders 商品卡类型编辑（v3.23.0）', () => {
  beforeEach(() => {
    aoi.saveTeamData = vi.fn().mockResolvedValue(undefined);
    aoi.confirm = vi.fn().mockResolvedValue(true);
    aoi.orders.expandedActivities = {};
    aoi.state.data = {
      activities: ['CP27'],
      activityMeta: {
        CP27: {
          products: [
            { id: 'p1', type: '默认类型', model: '蓝色宇航员皮卡丘' },
            { id: 'p2', type: '大玩偶', model: '蓝色宇航员皮卡丘' }
          ]
        }
      },
      typeMeta: { '大玩偶': { route: '未分类' }, '玩偶': { route: '未分类' } },
      orders: []
    };
  });

  it('商品卡渲染类型输入框（data-ptype，datalist 绑定类型库）', () => {
    aoi.orders.toggleActivityExpand('CP27');
    const card = doc.querySelector('[data-pcard="p1"]');
    const typeInput = card.querySelector('[data-ptype="p1"]');
    expect(typeInput).not.toBeNull();
    expect(typeInput.value).toBe('默认类型');
    expect(typeInput.getAttribute('list')).toBe('actProductTypeOptions');
  });

  it('saveActProduct：修改制品类型写回主档', async () => {
    aoi.orders.toggleActivityExpand('CP27');
    doc.querySelector('[data-ptype="p1"]').value = '玩偶';
    await aoi.orders.saveActProduct('p1');
    expect(aoi.state.data.activityMeta.CP27.products[0].type).toBe('玩偶');
    expect(aoi.saveTeamData).toHaveBeenCalled();
  });

  it('saveActProduct：改成与现有商品同 类型+型号 拒绝（查重按新 type）', async () => {
    aoi.orders.toggleActivityExpand('CP27');
    doc.querySelector('[data-ptype="p1"]').value = '大玩偶';
    await aoi.orders.saveActProduct('p1');
    expect(aoi.state.data.activityMeta.CP27.products[0].type).toBe('默认类型'); // 未写回
    expect(aoi.saveTeamData).not.toHaveBeenCalled();
  });

  it('saveActProduct：类型清空拒绝', async () => {
    aoi.orders.toggleActivityExpand('CP27');
    doc.querySelector('[data-ptype="p1"]').value = '';
    await aoi.orders.saveActProduct('p1');
    expect(aoi.state.data.activityMeta.CP27.products[0].type).toBe('默认类型');
  });
});
