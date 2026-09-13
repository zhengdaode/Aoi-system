// v3.16.0 商品详情弹窗：订单表点击型号 → 弹窗展示商品主档 + 订单价，弹窗内展开链接/限购，全程不跳转
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { aoi, doc, win } from './helpers/aoi.js';

const MASTER = {
  id: 'p1', type: '徽章', model: '皮卡丘', nameOrig: 'ピカチュウ',
  price: 28, priceOrig: 800, currency: 'jpy', limit: 3,
  refImage: 'https://img.example.com/1.jpg', refUrl: 'https://shop.example.com/1'
};

function seed(orders, products, actLink) {
  aoi.state.data = {
    activities: ['CP27'], ips: ['宝可梦'],
    activityMeta: { CP27: { ip: '宝可梦', link: actLink || '', products: products || [] } },
    orders: orders, batches: [],
    calc: { jpyRate: 0.05, jpyMarkup: 0, krwRate: 0.005, krwMarkup: 0 }
  };
}

const basicOrder = { id: 'o1', activity: 'CP27', type: '徽章', model: '皮卡丘', price: 28, priceOrig: 800, currency: 'jpy', count: 2, buyer: '小樱', remark: '', status: '已到货', batchId: null };

function openFirst() {
  const btn = doc.querySelector('#orderTbody button[data-product]');
  btn.click();
}

describe('v3.16.0 商品详情弹窗', () => {
  beforeEach(() => {
    aoi.saveTeamData = vi.fn().mockResolvedValue(undefined);
    seed([Object.assign({}, basicOrder)], [Object.assign({}, MASTER)], 'https://platform.example.com/cp27');
  });

  it('型号列渲染为可点击按钮，点击打开弹窗并回填型号/活动/类型', () => {
    aoi.orders.render();
    const btn = doc.querySelector('#orderTbody button[data-product]');
    expect(btn).toBeTruthy();
    expect(btn.textContent).toBe('皮卡丘');
    btn.click();
    expect(doc.getElementById('productModal').classList.contains('hidden')).toBe(false);
    expect(doc.getElementById('pdModel').textContent).toBe('皮卡丘');
    expect(doc.getElementById('pdSub').textContent).toBe('CP27 · 徽章');
  });

  it('有商品主档：回填原名/参考价/外币原价/参考图/限购', () => {
    aoi.orders.render();
    openFirst();
    expect(doc.getElementById('pdNameOrig').textContent).toBe('ピカチュウ');
    expect(doc.getElementById('pdPrice').textContent).toBe('¥28');
    expect(doc.getElementById('pdPriceOrig').textContent).toBe('JP¥800');
    expect(doc.getElementById('pdImg').src).toBe('https://img.example.com/1.jpg');
    expect(doc.getElementById('pdImgEmpty').classList.contains('hidden')).toBe(true);
    expect(doc.getElementById('pdLimit').textContent).toBe('每账号限 3 件');
    expect(doc.getElementById('pdOrder').textContent).toContain('×2');
    expect(doc.getElementById('pdOrder').textContent).toContain('¥56.00');
  });

  it('无主档回落订单字段：参考价标注订单价、缺图占位、购买地址回落活动平台链接', () => {
    seed([Object.assign({}, basicOrder)], [], 'https://platform.example.com/cp27');
    aoi.orders.render();
    openFirst();
    expect(doc.getElementById('pdPrice').textContent).toBe('¥28.00（订单价）');
    expect(doc.getElementById('pdPriceOrig').textContent).toBe('JP¥800');
    expect(doc.getElementById('pdNameOrig').textContent).toBe('—');
    expect(doc.getElementById('pdImgEmpty').classList.contains('hidden')).toBe(false);
    expect(doc.getElementById('pdImgLink').classList.contains('hidden')).toBe(true);
    expect(doc.getElementById('pdBuyUrl').querySelector('a').href).toBe('https://platform.example.com/cp27');
  });

  it('展开区切换：展开显示链接（超链接直接跳转、文本=完整URL），收起恢复文案', () => {
    aoi.orders.render();
    openFirst();
    const more = doc.getElementById('pdMore');
    const toggle = doc.getElementById('pdToggle');
    expect(more.classList.contains('hidden')).toBe(true);
    aoi.orders.toggleProductMore();
    expect(more.classList.contains('hidden')).toBe(false);
    expect(toggle.textContent).toBe('收起');
    const buy = doc.getElementById('pdBuyUrl').querySelector('a');
    expect(buy.href).toBe('https://shop.example.com/1');
    expect(buy.textContent).toBe('https://shop.example.com/1');
    expect(doc.getElementById('pdImgUrl').querySelector('a').href).toBe('https://img.example.com/1.jpg');
    expect(doc.getElementById('pdActUrl').querySelector('a').href).toBe('https://platform.example.com/cp27');
    aoi.orders.toggleProductMore();
    expect(more.classList.contains('hidden')).toBe(true);
    expect(toggle.textContent).toBe('展开更多信息');
  });

  it('safeUrl 白名单：javascript: 伪链接与空链接均显示 —（不渲染 <a>）', () => {
    seed([Object.assign({}, basicOrder)], [Object.assign({}, MASTER, { refUrl: 'javascript:alert(1)', refImage: '' })], '');
    aoi.orders.render();
    openFirst();
    expect(doc.getElementById('pdBuyUrl').querySelector('a')).toBeNull();
    expect(doc.getElementById('pdBuyUrl').textContent).toBe('—');
    expect(doc.getElementById('pdImgUrl').textContent).toBe('—');
    expect(doc.getElementById('pdActUrl').textContent).toBe('—');
  });

  it('closeProduct 与 Esc 均可关闭弹窗', () => {
    aoi.orders.render();
    openFirst();
    expect(doc.getElementById('productModal').classList.contains('hidden')).toBe(false);
    doc.dispatchEvent(new win.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect(doc.getElementById('productModal').classList.contains('hidden')).toBe(true);
    aoi.orders.openProduct('o1');
    expect(doc.getElementById('productModal').classList.contains('hidden')).toBe(false);
    aoi.orders.closeProduct();
    expect(doc.getElementById('productModal').classList.contains('hidden')).toBe(true);
  });

  it('重复打开重置为收起态；未知订单 id 不打开弹窗', () => {
    aoi.orders.render();
    openFirst();
    aoi.orders.toggleProductMore();
    aoi.orders.openProduct('o1');
    expect(doc.getElementById('pdMore').classList.contains('hidden')).toBe(true);
    expect(doc.getElementById('pdToggle').textContent).toBe('展开更多信息');
    doc.getElementById('productModal').classList.add('hidden');
    aoi.orders.openProduct('nonexistent');
    expect(doc.getElementById('productModal').classList.contains('hidden')).toBe(true);
  });
});
