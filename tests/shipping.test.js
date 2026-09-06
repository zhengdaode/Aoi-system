import { describe, it, expect, beforeEach, vi } from 'vitest';
import { aoi, doc } from './helpers/aoi.js';

function setup(orders) {
  aoi.state.data = {
    batches: [{ id: 'b1', date: '2026-09-01' }],
    activities: ['CP27'],
    ips: [],
    orders: JSON.parse(JSON.stringify(orders)),
    warehouses: [{ id: 'w1', name: '广东站', qrCode: '' }],
    payments: []
  };
  aoi.saveTeamData = async (d) => { aoi.state.data = d; };
}

const ORDERS = [
  { id: 'o1', batchId: 'b1', buyer: '小樱', type: '吧唧', model: 'A款', price: 10, count: 2, status: '已到货', shipped: '已发', tracking: 'SF001' },
  { id: 'o2', batchId: 'b1', buyer: '小明', type: '色纸', model: 'B款', price: 5, count: 1, status: '已到货' }
];

describe('Aoi.ship 发货管理', () => {
  beforeEach(() => {
    aoi.state.user = { id: 'boss', username: 'boss', role: 'super' };
    aoi.notify.sync = vi.fn();
    aoi.overview.render = vi.fn();
  });

  it('shippedBadge：已发绿色，未发灰色', () => {
    expect(aoi.ship.shippedBadge('已发')).toContain('text-green-600');
    expect(aoi.ship.shippedBadge('未发')).toContain('text-gray-400');
    expect(aoi.ship.shippedBadge()).toContain('未发');
  });

  it('refillBatches：通用批次下拉填充（含批次标签与计数）', () => {
    setup(ORDERS);
    aoi.orders.batchCount = vi.fn().mockReturnValue(2);
    aoi.ship.refillBatches();
    const sel = doc.getElementById('shipBatch');
    expect(sel.innerHTML).toContain('value="b1"');
    expect(sel.innerHTML).toContain('（2）');
  });

  it('render：排发表渲染买家/单号/状态徽章与统计', () => {
    setup(ORDERS);
    doc.getElementById('shipBatch').value = 'b1';
    aoi.ship.render();
    const html = doc.getElementById('shipTbody').innerHTML;
    expect(html).toContain('小樱');
    expect(html).toContain('SF001');
    expect(html).toContain('text-green-600');
    expect(doc.getElementById('shipStat').textContent).toContain('共 2 条 · 已发 1');
  });

  it('render：未选批次时清空表格', () => {
    setup(ORDERS);
    doc.getElementById('shipBatch').value = '';
    aoi.ship.render();
    expect(doc.getElementById('shipTbody').innerHTML).toBe('');
  });

  it('selectedIds / toggleAll：行勾选与全选', () => {
    setup(ORDERS);
    doc.getElementById('shipBatch').value = 'b1';
    aoi.ship.render();
    expect(aoi.ship.selectedIds()).toEqual([]);
    doc.querySelector('.ship-check[data-id="o1"]').checked = true;
    expect(aoi.ship.selectedIds()).toEqual(['o1']);
  });

  it('setShipped：勾选行批量标记发货状态并触发通知同步', async () => {
    setup(ORDERS);
    doc.getElementById('shipBatch').value = 'b1';
    aoi.ship.render();
    doc.querySelector('.ship-check[data-id="o2"]').checked = true;
    doc.getElementById('shipStatus').value = '已发';
    await aoi.ship.setShipped();
    expect(aoi.state.data.orders.find(o => o.id === 'o2').shipped).toBe('已发');
    expect(aoi.state.data.orders.find(o => o.id === 'o1').shipped).toBe('已发'); // 原状态不变
    expect(aoi.notify.sync).toHaveBeenCalledTimes(1);
  });

  it('setShipped：未勾选时不写数据', async () => {
    setup(ORDERS);
    await aoi.ship.setShipped();
    expect(aoi.notify.sync).not.toHaveBeenCalled();
  });

  it('setTracking：保存快递单号', async () => {
    setup(ORDERS);
    await aoi.ship.setTracking('o1', 'SF999');
    expect(aoi.state.data.orders.find(o => o.id === 'o1').tracking).toBe('SF999');
  });

  it('setWarehouse：更新订单囤货地（空值置 null）', async () => {
    setup(ORDERS);
    await aoi.ship.setWarehouse('o1', 'w1');
    expect(aoi.state.data.orders.find(o => o.id === 'o1').warehouseId).toBe('w1');
    await aoi.ship.setWarehouse('o1', '');
    expect(aoi.state.data.orders.find(o => o.id === 'o1').warehouseId).toBeNull();
  });
});
