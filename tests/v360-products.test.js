import { describe, it, expect, beforeEach, vi } from 'vitest';
import { aoi, doc } from './helpers/aoi.js';

// 活动商品（v3.6.0 S2 引入；v3.7.0 S2 改为活动管理行内展开商品卡片区）+ 团员端参考列 + 按商品筛购买者
describe('活动商品展开区（v3.7.0 S2）', () => {
  beforeEach(() => {
    aoi.saveTeamData = vi.fn().mockResolvedValue(undefined);
    aoi.orders.expandedActivities = {}; // 模块级展开状态，逐用例重置
    aoi.state.data = {
      activities: ['CP27'],
      activityMeta: {
        CP27: {
          ip: '宝可梦', link: 'https://shop.example/cp27',
          products: [
            { id: 'p1', type: '吧唧', model: 'M1', refImage: 'https://img.example/m1.jpg', refUrl: '' },
            { id: 'p2', type: '吧唧', model: 'M2', refImage: '', refUrl: 'https://shop.example/p/2' },
            { id: 'p3', type: '立牌', model: 'L1', refImage: '', refUrl: '' }
          ]
        }
      },
      typeMeta: { '吧唧': { route: '未分类' }, '立牌': { route: '未分类' } },
      orders: [
        { id: 'o1', activity: 'CP27', type: '吧唧', model: 'M1', price: 10, currency: 'cny', count: 1, buyer: '小樱', status: '未到货', batchId: null },
        { id: 'o2', activity: 'CP27', type: '吧唧', model: 'M1', price: 10, currency: 'cny', count: 1, buyer: '小狼', status: '未到货', batchId: null },
        { id: 'o3', activity: 'CP27', type: '立牌', model: 'L1', price: 20, currency: 'cny', count: 1, buyer: '小樱', status: '未到货', batchId: null }
      ]
    };
  });

  it('activityProduct 按 活动+类型+型号 查找商品登记', () => {
    const p = aoi.orders.activityProduct('CP27', '吧唧', 'M1');
    expect(p.id).toBe('p1');
    expect(aoi.orders.activityProduct('CP27', '吧唧', '不存在')).toBeNull();
    expect(aoi.orders.activityProduct('无此活动', '吧唧', 'M1')).toBeNull();
  });

  it('productLink 链接回落：refUrl 优先 → 活动平台链接 → 空', () => {
    expect(aoi.orders.productLink('CP27', { refUrl: 'https://x.example/a' })).toBe('https://x.example/a');
    expect(aoi.orders.productLink('CP27', { refUrl: '' })).toBe('https://shop.example/cp27');   // 空 → 平台链接
    expect(aoi.orders.productLink('CP27', null)).toBe('https://shop.example/cp27');
    expect(aoi.orders.productLink('无此活动', null)).toBe('');
  });

  it('productBuyers 按商品聚合购买者（去重）', () => {
    expect(aoi.orders.productBuyers('CP27', '吧唧', 'M1')).toEqual(['小樱', '小狼']);
    expect(aoi.orders.productBuyers('CP27', '吧唧', 'M2')).toEqual([]);
  });

  it('点击活动名展开/收起商品卡片区，卡片含图/链接/聚合信息', () => {
    aoi.orders.renderActivities();
    expect(doc.querySelector('[data-pcard="p1"]')).toBeNull();
    aoi.orders.toggleActivityExpand('CP27');
    expect(doc.querySelector('[data-pcard="p1"]')).not.toBeNull();
    const html = doc.getElementById('activityTbody').innerHTML;
    expect(html).toContain('https://img.example/m1.jpg');          // 参考图缩略图
    expect(html).toContain('购买链接');                             // refUrl / 平台链接
    expect(html).toContain('已订 <b>2</b> 件 · 2 人');              // M1 聚合（o1+o2）
    expect(html).toContain('从订单同步商品');                        // 展开区操作
    expect(html).toContain('data-act-addproduct="CP27"');           // 新增商品表单
    // 再点收起
    aoi.orders.toggleActivityExpand('CP27');
    expect(doc.querySelector('[data-pcard="p1"]')).toBeNull();
  });

  it('活动行「商品」按钮显示款数·件数', () => {
    aoi.orders.renderActivities();
    // 行内有两个 data-expand 按钮（活动名 + 商品），取第二个（商品按钮）
    const btns = doc.querySelectorAll('button[data-expand="CP27"]');
    expect(btns.length).toBe(2);
    expect(btns[1].textContent).toContain('3 款·3 件');
  });

  it('addActProduct 从展开区新表单添加商品（含单价/限购），写入 blob 并清空表单', async () => {
    aoi.orders.toggleActivityExpand('CP27');
    doc.getElementById('apNewType_0').value = '色纸';
    doc.getElementById('apNewModel_0').value = 'S1';
    doc.getElementById('apNewPrice_0').value = '8.5';
    doc.getElementById('apNewLimit_0').value = '2';
    doc.getElementById('apNewUrl_0').value = 'https://shop.example/s1';
    const btn = doc.querySelector('button[data-act-addproduct="CP27"]');
    await aoi.orders.addActProduct(btn);
    const products = aoi.state.data.activityMeta.CP27.products;
    expect(products).toHaveLength(4);
    expect(products[3]).toMatchObject({ type: '色纸', model: 'S1', refUrl: 'https://shop.example/s1', price: 8.5, limit: 2 });
    expect(aoi.saveTeamData).toHaveBeenCalled();
    // 表单已清空
    expect(doc.getElementById('apNewType_0').value).toBe('');
    // 同型号重复被拒
    doc.getElementById('apNewType_0').value = '色纸';
    doc.getElementById('apNewModel_0').value = 'S1';
    await aoi.orders.addActProduct(doc.querySelector('button[data-act-addproduct="CP27"]'));
    expect(aoi.state.data.activityMeta.CP27.products).toHaveLength(4);
  });

  it('saveActProduct 卡内保存型号/链接/单价/限购', async () => {
    aoi.orders.toggleActivityExpand('CP27');
    doc.querySelector('[data-pmodel="p2"]').value = 'M2改';
    doc.querySelector('[data-purl="p2"]').value = 'https://shop.example/p/2v2';
    doc.querySelector('[data-pprice="p2"]').value = '15';
    doc.querySelector('[data-plimit="p2"]').value = '3';
    await aoi.orders.saveActProduct('p2');
    const p2 = aoi.orders.activityProduct('CP27', '吧唧', 'M2改');
    expect(p2.refUrl).toBe('https://shop.example/p/2v2');
    expect(p2.price).toBe(15);
    expect(p2.limit).toBe(3);
  });

  it('removeActProduct 需确认，删除后 blob 同步', async () => {
    aoi.confirm = vi.fn().mockResolvedValue(true);
    await aoi.orders.removeActProduct('p3');
    expect(aoi.state.data.activityMeta.CP27.products).toHaveLength(2);
    expect(aoi.orders.activityProduct('CP27', '立牌', 'L1')).toBeNull();
  });

  it('jumpToProduct 跳订单管理并按活动+型号筛选出购买者', () => {
    aoi.orders.jumpToProduct('CP27', '吧唧', 'M1');
    expect(doc.getElementById('view-orders').classList.contains('hidden')).toBe(false);
    expect(doc.getElementById('fActivity').value).toBe('CP27');
    expect(doc.getElementById('fModel').value).toBe('M1');
    expect(doc.getElementById('fBuyer').value).toBe('');
    // M1 只有小樱/小狼两单
    expect(doc.querySelectorAll('#orderTbody tr')).toHaveLength(2);
  });

  it('订单表 fModel 型号筛选独立可用', () => {
    doc.getElementById('fModel').value = 'L1';
    aoi.orders.render();
    expect(doc.querySelectorAll('#orderTbody tr')).toHaveLength(1);
  });
});

describe('团员端参考列（v3.6.0 S2）', () => {
  beforeEach(() => {
    aoi.state.data = {
      activities: ['CP27'],
      activityMeta: {
        CP27: {
          link: 'https://shop.example/cp27',
          products: [
            { id: 'p1', type: '吧唧', model: 'M1', refImage: 'https://img.example/m1.jpg', refUrl: 'https://shop.example/p/1' },
            { id: 'p2', type: '色纸', model: 'S1', refImage: '', refUrl: '' }
          ]
        }
      },
      orders: [
        { id: 'o1', activity: 'CP27', type: '吧唧', model: 'M1', price: 10, currency: 'cny', count: 1, buyer: '小樱', status: '未到货', batchId: null },
        { id: 'o2', activity: 'CP27', type: '色纸', model: 'S1', price: 5, currency: 'cny', count: 1, buyer: '小樱', status: '未到货', batchId: null },
        { id: 'o3', activity: 'CP27', type: '立牌', model: 'L1', price: 20, currency: 'cny', count: 1, buyer: '小樱', status: '未到货', batchId: null }
      ]
    };
    aoi.member.state.cn = '小樱';
    aoi.member.state.teamName = '测试团';
  });

  it('我的订单渲染参考列：商品图+商品链接 / 平台链接回落 / 占位', () => {
    aoi.member.renderOrders('小樱');
    const html = doc.getElementById('memberOrderTbody').innerHTML;
    // M1：参考图缩略图 + 商品链接
    expect(html).toContain('https://img.example/m1.jpg');
    expect(html).toContain('商品链接');
    // S1：无 refUrl → 回落活动平台链接，文案为平台链接
    expect(html).toContain('https://shop.example/cp27');
    expect(html).toContain('平台链接');
    expect(html).not.toContain('undefined');
  });
});
