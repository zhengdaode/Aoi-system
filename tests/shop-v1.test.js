// F12 C 端商城（v3.22.0）——shop.js 纯函数 / RPC 封装 / 管理端橱窗上架开关
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { aoi, doc, win } from './helpers/aoi.js';

const shop = aoi.shop;

beforeEach(() => {
  // 隔离：清空状态与购物车
  shop.state.cart = [];
  shop.state.orders = [];
  shop.state.me = null;
  shop.state.catalog = null;
  shop.state.byId = {};
  win.localStorage.removeItem('aoi_shop_cart');
});

describe('shop.js 在管理端 harness 中静默待命', () => {
  it('index.html 无 #shop-root，UI 不启动、无异常', () => {
    expect(doc.getElementById('shop-root')).toBeNull();
    expect(shop.state.view).toBe('auth'); // init 未执行
    expect(shop.state.me).toBeNull();
  });
});

describe('splitTail 金额尾数拆分', () => {
  it('paidTotal - total 的分位整数', () => {
    expect(shop.splitTail(58, 58.37)).toBe(37);
    expect(shop.splitTail(100, 100.01)).toBe(1);
    expect(shop.splitTail(43, 43.83)).toBe(83);
  });
});

describe('statusMeta 订单展示状态推导', () => {
  it('待付款优先', () => {
    const m = shop.statusMeta({ status: '待付款', progress: { lines: 3, shipped: 3, received: 3 } });
    expect(m.key).toBe('unpaid');
    expect(m.text).toBe('待付款');
  });
  it('全部收货 → 已完成', () => {
    const m = shop.statusMeta({ status: '已付款', progress: { lines: 2, received: 2, shipped: 2, arrived: 2 } });
    expect(m.key).toBe('done');
  });
  it('全部发货 → 已发货；部分发货 → 部分发货', () => {
    expect(shop.statusMeta({ status: '已付款', progress: { lines: 2, shipped: 2, received: 0 } }).key).toBe('shipped');
    expect(shop.statusMeta({ status: '已付款', progress: { lines: 2, shipped: 1, received: 0 } }).key).toBe('partial');
  });
  it('仅到货 → 已到货；无进度 → 已付款', () => {
    expect(shop.statusMeta({ status: '已付款', progress: { lines: 3, arrived: 1, shipped: 0, received: 0 } }).key).toBe('arrived');
    expect(shop.statusMeta({ status: '已付款', progress: { lines: 3, arrived: 0, shipped: 0, received: 0 } }).key).toBe('paid');
  });
});

describe('progressText 与 orderVmKey', () => {
  it('进度文案拼接', () => {
    expect(shop.progressText({ progress: { lines: 3, arrived: 2, shipped: 1, received: 0 } }))
      .toBe('到货 2/3 · 发货 1/3 · 收货 0/3');
    expect(shop.progressText({ progress: {} })).toBe('');
  });
  it('部分发货/已到货归入「已付款」tab', () => {
    expect(shop.orderVmKey({ status: '已付款', progress: { lines: 2, shipped: 1, received: 0 } })).toBe('paid');
    expect(shop.orderVmKey({ status: '待付款', progress: {} })).toBe('unpaid');
  });
});

describe('cartAdd 购物车合并与限购夹紧', () => {
  const p = { id: 'p1', limit: 4, price: 22 };
  it('新商品入车', () => {
    const r = shop.cartAdd([], p, 2);
    expect(r.cart).toHaveLength(1);
    expect(r.item.qty).toBe(2);
    expect(r.clamped).toBe(false);
  });
  it('同商品合并数量', () => {
    const r = shop.cartAdd([{ pid: 'p1', qty: 1, checked: true }], p, 2);
    expect(r.item.qty).toBe(3);
    expect(r.cart).toHaveLength(1);
  });
  it('超限购夹紧并标记 clamped', () => {
    const r = shop.cartAdd([{ pid: 'p1', qty: 3, checked: true }], p, 2);
    expect(r.item.qty).toBe(4);
    expect(r.clamped).toBe(true);
  });
  it('无 limit 时默认上限 99', () => {
    const r = shop.cartAdd([], { id: 'p2', price: 5 }, 200);
    expect(r.item.qty).toBe(99);
  });
});

describe('cartTotal 合计（仅勾选项）', () => {
  it('金额与件数', () => {
    const byId = { p1: { id: 'p1', price: 22 }, p2: { id: 'p2', price: 10.5 } };
    const t = shop.cartTotal([
      { pid: 'p1', qty: 2, checked: true },
      { pid: 'p2', qty: 3, checked: false },
      { pid: 'pX', qty: 9, checked: true } // 失效商品忽略
    ], byId);
    expect(t.total).toBe(44);
    expect(t.count).toBe(2);
  });
});

describe('RPC 封装错误处理', () => {
  it('普通错误 toast 并抛出', async () => {
    aoi.db = { rpc: vi.fn(async () => ({ error: { message: '圈名「X」已绑定其他登录账号' } })) };
    await expect(shop.rpc('shop_bind_cn', { p_cn: 'X' })).rejects.toThrow('已绑定其他登录账号');
  });
  it('会话过期错误 → 清会话回登录页', async () => {
    const signOut = vi.fn(async () => {});
    aoi.db = { rpc: vi.fn(async () => ({ error: { message: 'Invalid Refresh Token: already used' } })), auth: { signOut } };
    await expect(shop.rpc('shop_me')).rejects.toThrow('登录已过期');
    expect(signOut).toHaveBeenCalled();
    expect(shop.state.me).toBeNull();
  });
});

describe('管理端橱窗上架开关（actProductCardHtml + saveActProduct）', () => {
  const act = '测试团期';
  beforeEach(() => {
    aoi.state.data = {
      orders: [],
      activities: [act],
      ips: [],
      activityMeta: {
        [act]: {
          ip: '宝可梦', status: '进行中', buyDate: '', shipDate: '', link: '', remark: '', buyers: [], trackings: [],
          products: [{ id: 'prod1', type: '吧唧', model: '皮卡丘', refImage: '', refUrl: '', price: 22, limit: 4, listed: true }]
        }
      },
      typeMeta: {}, ipTypes: {}, addresses: {}, memberMeta: {}, cnChanges: [],
      batches: [], payments: [], warehouses: [], transfers: [], notifications: [], announcements: []
    };
  });

  it('商品卡渲染 listed 复选框并反映当前值', () => {
    const html = aoi.orders.actProductCardHtml(act, aoi.state.data.activityMeta[act].products[0]);
    expect(html).toContain('data-plisted="prod1"');
    expect(html).toContain('checked'); // listed: true → 勾选
    expect(html).toContain('上架到 C 端商城橱窗');
  });

  it('saveActProduct 持久化 listed 取消勾选', async () => {
    const p = aoi.state.data.activityMeta[act].products[0];
    doc.body.innerHTML = '<div id="holder">' + aoi.orders.actProductCardHtml(act, p) + '</div>';
    doc.querySelector('[data-plisted="prod1"]').checked = false;
    doc.querySelector('[data-pprice="prod1"]').value = '25';
    let saved = null;
    const origSave = aoi.saveTeamData;
    const origRender = aoi.orders.renderActivities;
    aoi.saveTeamData = async (d) => { saved = d; };
    aoi.orders.renderActivities = () => {};
    try {
      await aoi.orders.saveActProduct('prod1');
    } finally {
      aoi.saveTeamData = origSave;
      aoi.orders.renderActivities = origRender;
      doc.body.innerHTML = '';
    }
    expect(saved.activityMeta[act].products[0].listed).toBe(false);
    expect(saved.activityMeta[act].products[0].price).toBe(25);
  });
});
