import { describe, it, expect, beforeEach, vi } from 'vitest';
import { aoi, doc } from './helpers/aoi.js';

// v3.9.0：限购计划页购买清单图片导出——collect/displayName/fileBase/layout 纯函数
// + renderPlan「导出清单图」按钮 + exportAll/exportAccount 兜底提示（canvas 绘制不在 jsdom 断言）

function fixture() {
  return {
    activities: ['CP27'],
    orders: [],
    activityMeta: {
      CP27: {
        products: [
          { id: 'p1', type: '吧唧', model: '皮卡丘', refImage: 'https://img.example/m1.jpg', refUrl: 'https://www.pokemoncenter-online.com/products/jan1.html' },
          { id: 'p2', type: '立牌', model: 'L1', refImage: '', refUrl: '' },
          { id: 'p3', type: '挂件', model: 'ぬいぐるみ ピカチュウ', refImage: 'data:image/png;base64,AAA', refUrl: '' }
        ],
        buyers: [{ buyer: 'ks', account: 'ks@x.com' }, {}, {}, {}]
      }
    },
    pcoItems: [
      { id: 'c1', url: '/products/jan1.html', jpName: 'ピカチュウ バッジ', name: '皮卡丘徽章' },
      { id: 'c2', url: 'https://www.pokemoncenter-online.com/products/other.html', jpName: 'イーブイ ぬいぐるみ', name: '伊布玩偶' }
    ],
    limitPlans: {
      CP27: {
        activity: 'CP27', accountsCount: 3,
        items: [
          { index: 1, total: 20, diff: 0, reached: true, items: [
            { type: '吧唧', model: '皮卡丘', qty: 2, price: 10, amount: 20, status: '待购买' },
            { type: '立牌', model: 'L1', qty: 1, price: 10, amount: 10, status: '待购买' }
          ] },
          { index: 2, total: 5, diff: 0, reached: true, items: [
            { type: '挂件', model: 'ぬいぐるみ ピカチュウ', qty: 1, price: 5, amount: 5, status: '待购买' }
          ] },
          { index: 3, total: 0, diff: 0, reached: false, items: [] }
        ],
        remaining: []
      }
    }
  };
}

describe('plan-export 纯函数（v3.9.0）', () => {
  beforeEach(() => {
    aoi.toast = vi.fn();
  });

  it('collect：逐账号卡片 = 账号名标签 + 商品（原语言名/数量/图），空账号槽位剔除', () => {
    aoi.state.data = fixture();
    const cards = aoi.planExport.collect(aoi.state.data, 'CP27');
    expect(cards.map((c) => c.index)).toEqual([1, 2]);           // 槽位 3 无内容 → 不出卡片
    expect(cards[0].title).toBe('ks（ks@x.com）');                // 购买人标签（v3.7.0 S3）
    expect(cards[1].title).toBe('账号 2');                        // 无购买人 → 账号 N 兜底
    expect(cards[0].items[0]).toEqual({
      key: '吧唧|皮卡丘', name: 'ピカチュウ バッジ', qty: 2, image: 'https://img.example/m1.jpg'
    });
    expect(cards[0].items[1].name).toBe('L1');                    // 无原文 → 型号（中文）兜底
    expect(cards[0].items[1].image).toBe('');                     // 无参考图 → 占位由绘制层兜底
    expect(cards[1].items[0].name).toBe('ぬいぐるみ ピカチュウ'); // 型号本身即原文
    expect(cards[1].items[0].image).toBe('data:image/png;base64,AAA');
  });

  it('displayName：refUrl 绝对化后匹配 pcoItems → jpName 优先', () => {
    aoi.state.data = fixture();
    const d = aoi.state.data;
    // 主档 refUrl 是绝对地址，目录里是相对路径——绝对化后按 url 对上
    expect(aoi.planExport.displayName(d, { model: '皮卡丘', refUrl: 'https://www.pokemoncenter-online.com/products/jan1.html' })).toBe('ピカチュウ バッジ');
    // 目录译名与型号相同 → 取 jpName
    expect(aoi.planExport.displayName(d, { model: '伊布玩偶' })).toBe('イーブイ ぬいぐるみ');
    // 无命中 → 型号原样
    expect(aoi.planExport.displayName(d, { model: 'M1' })).toBe('M1');
    expect(aoi.planExport.displayName(d, {})).toBe('');
  });

  it('fileBase：文件名 = 活动-账号N[-购买人]-购买清单，非法字符替换', () => {
    const card = { index: 2, title: 'ks（ks@x.com）' };
    expect(aoi.planExport.fileBase('CP27', card)).toBe('CP27-账号2-ks（ks@x.com）-购买清单');
    expect(aoi.planExport.fileBase('A/B:C*活动', { index: 1, title: '账号 1' })).toBe('A-B-C-活动-账号1-购买清单');
  });

  it('layout：行高 H 内 图片 75% / 名称字号 10% / 数量字号 5%', () => {
    expect(aoi.planExport.layout(300)).toEqual({ img: 225, name: 30, qty: 15 });
    expect(aoi.planExport.layout(200)).toEqual({ img: 150, name: 20, qty: 10 });
  });

  it('exportAll：无活动/无计划时提示，不触发绘制', async () => {
    aoi.state.data = { activities: [], orders: [], limitPlans: {} };
    await aoi.planExport.exportAll('');
    expect(aoi.toast).toHaveBeenCalledWith('请先选择活动', 'warning');
    await aoi.planExport.exportAll('CP27');
    expect(aoi.toast).toHaveBeenCalledWith('该活动还没有购买计划——请先「计算购买计划」', 'warning');
  });

  it('exportAccount：jsdom 无 canvas → 走导出失败兜底提示', async () => {
    aoi.state.data = fixture();
    const r = await aoi.planExport.exportAccount('CP27', 1);
    expect(r).toBe(false);
    expect(aoi.toast).toHaveBeenCalledWith(expect.stringContaining('导出失败'), 'error');
  });

  it('renderPlan 账号列出现「导出清单图」按钮（限购页与活动弹窗共用），点击走委托导出', async () => {
    aoi.state.data = fixture();
    aoi.limits.renderPlan(aoi.state.data.limitPlans.CP27);
    const btns = [...doc.querySelectorAll('#limResultTbody button[data-plan-export]')];
    expect(btns.map((b) => b.getAttribute('data-plan-export'))).toEqual(['1', '2']);
    expect(btns[0].getAttribute('data-plan-export-activity')).toBe('CP27');
    btns[0].click();
    await new Promise((r) => setTimeout(r, 0));
    expect(aoi.toast).toHaveBeenCalledWith(expect.stringContaining('导出失败'), 'error');
  });
});
