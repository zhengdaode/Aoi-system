import { describe, it, expect, beforeEach, vi } from 'vitest';
import { aoi } from './helpers/aoi.js';

// v3.7.0 S1：商品主档聚合（productStats / missingProducts / registerProduct / syncProductsFromOrders）
// + F9 接口预留（d.pcoItems）
describe('商品主档聚合（v3.7.0 S1）', () => {
  beforeEach(() => {
    aoi.saveTeamData = vi.fn().mockResolvedValue(undefined);
    aoi.state.data = {
      activities: ['CP27'],
      activityMeta: {
        CP27: {
          ip: '宝可梦',
          products: [
            { id: 'p1', type: '吧唧', model: 'M1', refImage: '', refUrl: '' },
            { id: 'p2', type: '立牌', model: 'L1', refImage: '', refUrl: '', price: 25 }
          ]
        }
      },
      typeMeta: { '吧唧': { route: '未分类' }, '立牌': { route: '未分类' }, '色纸': { route: '未分类' } },
      orders: [
        { id: 'o1', activity: 'CP27', type: '吧唧', model: 'M1', price: 10, currency: 'cny', count: 2, buyer: '小樱', status: '未到货', batchId: null },
        { id: 'o2', activity: 'CP27', type: '吧唧', model: 'M1', price: 20, currency: 'cny', count: 1, buyer: '小狼', status: '未到货', batchId: null },
        { id: 'o3', activity: 'CP27', type: '吧唧', model: 'M1', price: 10, currency: 'cny', count: 1, buyer: '小樱', status: '未到货', batchId: null },
        { id: 'o4', activity: 'CP27', type: '色纸', model: 'S1', price: null, currency: 'cny', count: 3, buyer: '小狼', status: '未到货', batchId: null },
        { id: 'o5', activity: '别的活动', type: '吧唧', model: 'M1', price: 99, currency: 'cny', count: 9, buyer: '路人', status: '未到货', batchId: null }
      ]
    };
  });

  it('ensure 预留 d.pcoItems（F9 接口）且幂等', () => {
    const d = aoi.orders.ensure();
    expect(Array.isArray(d.pcoItems)).toBe(true);
    d.pcoItems.push({ id: 'x' });
    aoi.orders.ensure();
    expect(d.pcoItems).toHaveLength(1);
  });

  it('productStats 聚合件数/购买者/按件加权均价', () => {
    const p = { type: '吧唧', model: 'M1' };
    const s = aoi.orders.productStats('CP27', p);
    expect(s.qty).toBe(4);                       // 2+1+1
    expect(s.buyers).toEqual(['小樱', '小狼']);
    // (10×2 + 20×1 + 10×1) / 4 = 12.5
    expect(s.priceAvg).toBe(12.5);
    expect(s.plan).toBeNull();                   // 无限购计划
  });

  it('productStats 无订单价时回落商品登记价；他活动订单不计入', () => {
    const s = aoi.orders.productStats('CP27', { type: '立牌', model: 'L1' });
    expect(s.qty).toBe(0);
    expect(s.priceAvg).toBe(25);
  });

  it('productStats 有限购计划时按状态累计件数', () => {
    aoi.state.data.limitPlans = {
      CP27: {
        activity: 'CP27',
        items: [
          { index: 1, items: [
            { type: '吧唧', model: 'M1', qty: 2, price: 10, amount: 20, status: '已购买' },
            { type: '色纸', model: 'S1', qty: 1, price: 5, amount: 5, status: '待购买' }
          ] },
          { index: 2, items: [
            { type: '吧唧', model: 'M1', qty: 1, price: 10, amount: 10, status: '购买失败' },
            { type: '吧唧', model: 'M1', qty: 1, price: 10, amount: 10, status: '待购买' }
          ] }
        ]
      }
    };
    const s = aoi.orders.productStats('CP27', { type: '吧唧', model: 'M1' });
    expect(s.plan).toEqual({ pending: 1, bought: 2, failed: 1 });
  });

  it('missingProducts 找出订单中未登记的 (类型,型号)', () => {
    expect(aoi.orders.missingProducts('CP27')).toEqual([{ type: '色纸', model: 'S1' }]);
  });

  it('registerProduct 统一登记：去重 + 可选扩展字段', async () => {
    const p = await aoi.orders.registerProduct('CP27', {
      type: ' 色纸 ', model: 'S1', refImage: 'https://img.example/s1', refUrl: 'https://shop.example/s1',
      price: 8.5, priceOrig: 220, currency: 'jpy'
    });
    expect(p).not.toBeNull();
    expect(p.type).toBe('色纸');
    expect(p.price).toBe(8.5);
    expect(p.priceOrig).toBe(220);
    expect(p.currency).toBe('jpy');
    expect(aoi.saveTeamData).toHaveBeenCalled();
    // 同 type+model：返回既有商品并回填缺失字段，不新建（v3.8.0 目录重复推入补全语义）
    const dup = await aoi.orders.registerProduct('CP27', { type: '色纸', model: 'S1', limit: 3 });
    expect(dup).not.toBeNull();
    expect(dup.id).toBe(p.id);
    expect(dup.limit).toBe(3);                    // 缺失字段被补充
    expect(dup.price).toBe(8.5);                  // 已有字段不被覆盖
    expect(aoi.state.data.activityMeta.CP27.products).toHaveLength(3);
    // 缺活动/缺型号被拒
    expect(await aoi.orders.registerProduct('', { type: '色纸', model: 'S2' })).toBeNull();
    expect(await aoi.orders.registerProduct('CP27', { type: '色纸' })).toBeNull();
  });

  it('syncProductsFromOrders 补登记未登记商品并返回数量', async () => {
    const n = await aoi.orders.syncProductsFromOrders('CP27');
    expect(n).toBe(1);
    const products = aoi.state.data.activityMeta.CP27.products;
    expect(products).toHaveLength(3);
    expect(products[2]).toMatchObject({ type: '色纸', model: 'S1' });
    // 再次同步：已全部登记
    expect(await aoi.orders.syncProductsFromOrders('CP27')).toBe(0);
  });
});
