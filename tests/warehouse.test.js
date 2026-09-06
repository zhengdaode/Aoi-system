import { describe, it, expect, beforeEach, vi } from 'vitest';
import { aoi, doc } from './helpers/aoi.js';

function setup() {
  aoi.state.data = {
    batches: [{ id: 'b1', date: '2026-09-01' }],
    activities: ['CP27'],
    ips: [],
    orders: [
      { id: 'o1', batchId: 'b1', buyer: '小樱', type: '吧唧', model: 'A款', price: 10, count: 2, status: '已到货' },
      { id: 'o2', batchId: 'b1', buyer: '小明', type: '色纸', model: 'B款', price: 5, count: 1, status: '已到货' }
    ],
    warehouses: [{ id: 'w1', name: '广东站', qrCode: '' }],
    transfers: [
      { id: 't1', buyer: '小樱', batchId: 'b1', toWarehouseId: 'w1', reason: '就近', status: '待处理', date: '2026-09-02' },
      { id: 't2', buyer: '小明', batchId: 'b1', toWarehouseId: 'w1', reason: '', status: '已驳回', date: '2026-09-01' }
    ]
  };
  aoi.saveTeamData = async (d) => { aoi.state.data = d; };
}

describe('Aoi.warehouse 囤货地管理', () => {
  beforeEach(() => {
    aoi.state.user = { id: 'boss', username: 'boss', role: 'super' };
    aoi.toast = vi.fn();
  });

  it('ensure：补齐 warehouses/transfers 数组', () => {
    aoi.state.data = { orders: [] };
    const d = aoi.warehouse.ensure();
    expect(Array.isArray(d.warehouses)).toBe(true);
    expect(Array.isArray(d.transfers)).toBe(true);
  });

  it('name：按 id 查囤货地名，未知 id 返回空串', () => {
    setup();
    expect(aoi.warehouse.name('w1')).toBe('广东站');
    expect(aoi.warehouse.name('nope')).toBe('');
  });

  it('add：录入名称后新增囤货地并清空输入', async () => {
    setup();
    doc.getElementById('whName').value = '江苏站';
    doc.getElementById('whQr').value = 'https://qr.example/abc';
    await aoi.warehouse.add();
    expect(aoi.state.data.warehouses.length).toBe(2);
    expect(aoi.state.data.warehouses[1].name).toBe('江苏站');
    expect(doc.getElementById('whName').value).toBe('');
  });

  it('add：名称为空时不写入', async () => {
    setup();
    doc.getElementById('whName').value = '   ';
    await aoi.warehouse.add();
    expect(aoi.state.data.warehouses.length).toBe(1);
    expect(aoi.toast).toHaveBeenCalledWith('请输入囤货地名称', 'warning');
  });

  it('remove：按 id 删除囤货地', async () => {
    setup();
    await aoi.warehouse.remove('w1');
    expect(aoi.state.data.warehouses.length).toBe(0);
  });

  it('render：囤货地列表渲染名称与删除按钮', () => {
    setup();
    aoi.warehouse.render();
    const html = doc.getElementById('whList').innerHTML;
    expect(html).toContain('广东站');
    expect(html).toContain('data-wh-del="w1"');
  });

  it('renderTransfers：只渲染待处理申请', () => {
    setup();
    aoi.warehouse.renderTransfers();
    const html = doc.getElementById('transferTbody').innerHTML;
    expect(html).toContain('小樱');
    expect(html).not.toContain('小明');
  });

  it('approve：同意后申请置已同意，且该买家该批次订单改囤货地', async () => {
    setup();
    await aoi.warehouse.approve('t1');
    expect(aoi.state.data.transfers.find(t => t.id === 't1').status).toBe('已同意');
    expect(aoi.state.data.orders.find(o => o.id === 'o1').warehouseId).toBe('w1');
    expect(aoi.state.data.orders.find(o => o.id === 'o2').warehouseId).toBeUndefined(); // 他人订单不受影响
  });

  it('reject：驳回后申请置已驳回，订单不动', async () => {
    setup();
    await aoi.warehouse.reject('t1');
    expect(aoi.state.data.transfers.find(t => t.id === 't1').status).toBe('已驳回');
    expect(aoi.state.data.orders.find(o => o.id === 'o1').warehouseId).toBeUndefined();
  });
});
