import { describe, it, expect, beforeEach, vi } from 'vitest';
import { aoi, doc } from './helpers/aoi.js';

// v3.7.0 S4：信息录入「登记活动商品」——统一写入活动商品主档，废除旧预建商品池读写
describe('登记活动商品（v3.7.0 S4）', () => {
  beforeEach(() => {
    aoi.saveTeamData = vi.fn().mockResolvedValue(undefined);
    aoi.state.data = {
      activities: ['CP27'],
      ips: ['宝可梦'],
      activityMeta: { CP27: { ip: '宝可梦', products: [] } },
      products: [{ id: 'legacy', ip: '旧', type: '旧', model: '旧', price: 1 }], // 旧数据保留
      typeMeta: { '吧唧': { route: '未分类' } },
      orders: [],
      calc: { jpyRate: 0.05, jpyMarkup: 0, krwRate: 0.005, krwMarkup: 0 }
    };
    const set = (id, v) => { doc.getElementById(id).value = v; };
    set('pActivity', 'CP27');
    set('pIp', '');
    set('pType', '');
    set('pModel', '');
    set('pPrice', '');
    set('pLimit', '');
    set('pImage', '');
    set('pUrl', '');
  });

  it('人民币单价：登记进 activityMeta.products，不写 d.products', async () => {
    doc.getElementById('pType').value = '吧唧';
    doc.getElementById('pModel').value = 'M1';
    doc.getElementById('pPrice').value = '8.5';
    await aoi.orders.addProduct();
    const products = aoi.state.data.activityMeta.CP27.products;
    expect(products).toHaveLength(1);
    expect(products[0]).toMatchObject({ type: '吧唧', model: 'M1', price: 8.5 });
    expect(aoi.state.data.products).toHaveLength(1); // 旧池未被写入
    expect(aoi.saveTeamData).toHaveBeenCalled();
    // 表单清空（活动保留）
    expect(doc.getElementById('pModel').value).toBe('');
    expect(doc.getElementById('pPrice').value).toBe('');
  });

  it('外币单价：保存原价/币种，人民币价按计算器折算', async () => {
    doc.getElementById('pType').value = '毛绒';
    doc.getElementById('pModel').value = 'F1';
    doc.getElementById('pCurrency').value = 'jpy';
    doc.getElementById('pPrice').value = '2200';
    await aoi.orders.addProduct();
    const p = aoi.state.data.activityMeta.CP27.products[0];
    expect(p.priceOrig).toBe(2200);
    expect(p.currency).toBe('jpy');
    expect(p.price).toBe(110); // 2200 × 0.05
  });

  it('新活动名自动创建活动并联动 IP', async () => {
    doc.getElementById('pActivity').value = '新活动';
    doc.getElementById('pIp').value = '宝可梦';
    doc.getElementById('pType').value = '色纸';
    doc.getElementById('pModel').value = 'S1';
    await aoi.orders.addProduct();
    expect(aoi.state.data.activities).toContain('新活动');
    expect(aoi.state.data.activityMeta['新活动'].ip).toBe('宝可梦');
    expect(aoi.state.data.activityMeta['新活动'].products[0].model).toBe('S1');
  });

  it('缺活动/缺类型被拒且不写库', async () => {
    doc.getElementById('pActivity').value = '';
    doc.getElementById('pType').value = '吧唧';
    doc.getElementById('pModel').value = 'M2';
    await aoi.orders.addProduct();
    doc.getElementById('pActivity').value = 'CP27';
    doc.getElementById('pType').value = '';
    await aoi.orders.addProduct();
    expect(aoi.saveTeamData).not.toHaveBeenCalled();
    expect(aoi.state.data.activityMeta.CP27.products).toHaveLength(0);
  });

  it('限购/参考图/链接字段入库', async () => {
    doc.getElementById('pType').value = '吧唧';
    doc.getElementById('pModel').value = 'M3';
    doc.getElementById('pLimit').value = '2';
    doc.getElementById('pImage').value = 'https://img.example/m3';
    doc.getElementById('pUrl').value = 'https://shop.example/m3';
    await aoi.orders.addProduct();
    const p = aoi.state.data.activityMeta.CP27.products[0];
    expect(p.limit).toBe(2);
    expect(p.refImage).toBe('https://img.example/m3');
    expect(p.refUrl).toBe('https://shop.example/m3');
  });

  it('refillDatalists 填充登记页活动候选', () => {
    aoi.orders.refillDatalists();
    expect(doc.getElementById('pActivityOptions').innerHTML).toContain('CP27');
  });
});
