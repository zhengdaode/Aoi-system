import { describe, it, expect, beforeEach, vi } from 'vitest';
import { aoi, doc } from './helpers/aoi.js';

// v3.7.0 S8：发货管理合照列缩略图展示（保留点击打开大图）
describe('合照缩略图（v3.7.0 S8）', () => {
  beforeEach(() => {
    aoi.toast = vi.fn();
    aoi.state.data = {
      activities: [], ips: [], products: [],
      batches: [{ id: 'b1', date: '2026-09-01' }],
      orders: [
        { id: 'o1', activity: 'A', type: '吧唧', model: 'M', price: 10, currency: 'cny', count: 1, buyer: '小樱', status: '已到货', batchId: 'b1', shipped: '未发', photo: 'https://img.example/group.jpg' },
        { id: 'o2', activity: 'A', type: '色纸', model: 'S', price: 5, currency: 'cny', count: 1, buyer: '小狼', status: '已到货', batchId: 'b1', shipped: '未发' }
      ],
      payments: [], notifications: [], transfers: [], cnChanges: []
    };
    aoi.ship.refillBatches();
    doc.getElementById('shipBatch').value = 'b1';
  });

  it('有合照渲染缩略图（点击打开原图），无合照显示占位', () => {
    aoi.ship.render();
    const html = doc.getElementById('shipTbody').innerHTML;
    expect(html).toContain('<img src="https://img.example/group.jpg"');
    expect(html).toContain('查看合照大图');
    expect(html).not.toContain('undefined');
  });
});
