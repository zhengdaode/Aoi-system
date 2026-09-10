import { describe, it, expect, beforeEach, vi } from 'vitest';
import { aoi } from './helpers/aoi.js';

// v3.9.2：商品元数据「原名（原语言）」——registerProduct 建档/重复合并两路都落库 nameOrig

describe('registerProduct nameOrig 元数据（v3.9.2）', () => {
  beforeEach(() => {
    aoi.saveTeamData = vi.fn().mockResolvedValue(undefined);
    aoi.state.data = {
      activities: ['CP27'],
      activityMeta: { CP27: { products: [], buyers: [], trackings: [] } },
      orders: []
    };
  });

  it('建档时写入 nameOrig', async () => {
    const p = await aoi.orders.registerProduct('CP27', {
      type: '毛绒挂件', model: '挂件 Pokémon Magic Hour Illusion! 索罗亚',
      nameOrig: 'マスコット Pokémon Magic Hour Illusion! ゾロア', price: 105
    });
    expect(p.nameOrig).toBe('マスコット Pokémon Magic Hour Illusion! ゾロア');
    expect(aoi.state.data.activityMeta.CP27.products[0].nameOrig).toBeTruthy();
  });

  it('重复型号合并时只补缺不覆盖', async () => {
    await aoi.orders.registerProduct('CP27', { type: '毛绒挂件', model: 'M1', nameOrig: 'マスコット' });
    const dup = await aoi.orders.registerProduct('CP27', { type: '毛绒挂件', model: 'M1', nameOrig: '別の名前' });
    expect(dup.nameOrig).toBe('マスコット');   // 已有字段不被覆盖
    // 无 nameOrig 的既有商品被补全
    await aoi.orders.registerProduct('CP27', { type: '立牌', model: 'L1' });
    const filled = await aoi.orders.registerProduct('CP27', { type: '立牌', model: 'L1', nameOrig: 'スタンド' });
    expect(filled.nameOrig).toBe('スタンド');
  });
});
