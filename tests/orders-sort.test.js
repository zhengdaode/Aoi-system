import { describe, it, expect, beforeEach, vi } from 'vitest';
import { aoi, doc, win } from './helpers/aoi.js';

// v3.6.2 订单管理表头排序：纯函数 / 状态持久化 / render 集成

function resetSort() {
  win.localStorage.removeItem('aoi_orders_sort');
  aoi.orders.sortSel = null;
}

function o(id, over) {
  return Object.assign({
    id: id, activity: 'A', type: '徽章', model: 'M' + id, price: 10, count: 1,
    buyer: '买家' + id, currency: 'cny', status: '未到货', batchId: null
  }, over || {});
}

function seed(list) {
  aoi.state.data = { orders: list, batches: [] };
}

function rowIds() {
  return Array.from(doc.querySelectorAll('#orderTbody tr')).map(function (tr) {
    var btn = tr.querySelector('[data-edit]');
    return btn ? btn.getAttribute('data-edit') : null;
  });
}

beforeEach(resetSort);

describe('Aoi.orders.compareBy / sortOrders（v3.6.2 排序纯函数）', () => {
  it('型号中文按拼音升序（Intl.Collator）', () => {
    const list = [o('a', { model: '皮卡丘' }), o('b', { model: '妙蛙种子' }), o('c', { model: '杰尼龟' })];
    const out = aoi.orders.sortOrders(list, { field: 'model', dir: 1 });
    expect(out.map((x) => x.id)).toEqual(['c', 'b', 'a']); // jie < miao < pi
  });

  it('购买者中文降序', () => {
    const list = [o('a', { buyer: '小樱' }), o('b', { buyer: '阿明' }), o('c', { buyer: '小狼' })];
    expect(aoi.orders.sortOrders(list, { field: 'buyer', dir: -1 }).map((x) => x.id)).toEqual(['a', 'c', 'b']);
  });

  it('数量按数值比较（2 < 9 < 10，非字典序），升降可逆', () => {
    const list = [o('a', { count: 10 }), o('b', { count: 2 }), o('c', { count: 9 })];
    expect(aoi.orders.sortOrders(list, { field: 'count', dir: 1 }).map((x) => x.id)).toEqual(['b', 'c', 'a']);
    expect(aoi.orders.sortOrders(list, { field: 'count', dir: -1 }).map((x) => x.id)).toEqual(['a', 'c', 'b']);
  });

  it('小计 = 单价 × 数量', () => {
    const list = [o('a', { price: 5, count: 2 }), o('b', { price: 30, count: 1 })];
    expect(aoi.orders.sortOrders(list, { field: 'sum', dir: 1 }).map((x) => x.id)).toEqual(['a', 'b']);
  });

  it('到货状态按生命周期阶段：未到货→待发货→已发货→已收货', () => {
    const list = [
      o('s2', { status: '已到货', shipped: '已发', received: false }),
      o('s0', { status: '未到货' }),
      o('s3', { status: '已到货', shipped: '已发', received: true }),
      o('s1', { status: '已到货', shipped: '未发' })
    ];
    expect(aoi.orders.statusStage(list[0])).toBe(2);
    expect(aoi.orders.sortOrders(list, { field: 'status', dir: 1 }).map((x) => x.id)).toEqual(['s0', 's1', 's2', 's3']);
    expect(aoi.orders.sortOrders(list, { field: 'status', dir: -1 }).map((x) => x.id)).toEqual(['s3', 's2', 's1', 's0']);
  });

  it('空值/待生成价恒排最后（升降序皆然）', () => {
    const list = [o('empty', { model: '' }), o('b', { model: 'B' }), o('undef', { model: undefined }), o('a', { model: 'A' })];
    expect(aoi.orders.sortOrders(list, { field: 'model', dir: 1 }).map((x) => x.id)).toEqual(['a', 'b', 'empty', 'undef']);
    expect(aoi.orders.sortOrders(list, { field: 'model', dir: -1 }).map((x) => x.id)).toEqual(['b', 'a', 'empty', 'undef']);
    const prices = [o('p-null', { price: null }), o('p2', { price: 20 }), o('p1', { price: 10 })];
    expect(aoi.orders.sortOrders(prices, { field: 'price', dir: 1 }).map((x) => x.id)).toEqual(['p1', 'p2', 'p-null']);
    expect(aoi.orders.sortOrders(prices, { field: 'price', dir: -1 }).map((x) => x.id)).toEqual(['p2', 'p1', 'p-null']);
  });

  it('同值保持录入顺序（稳定排序）', () => {
    const list = [o('a', { count: 5 }), o('b', { count: 5 }), o('c', { count: 1 }), o('d', { count: 5 })];
    expect(aoi.orders.sortOrders(list, { field: 'count', dir: 1 }).map((x) => x.id)).toEqual(['c', 'a', 'b', 'd']);
  });

  it('返回新数组，原数组（d.orders 录入序）不被改动', () => {
    const list = [o('a', { count: 3 }), o('b', { count: 1 })];
    const out = aoi.orders.sortOrders(list, { field: 'count', dir: 1 });
    expect(out).not.toBe(list);
    expect(list.map((x) => x.id)).toEqual(['a', 'b']);
  });

  it('未知字段或未选排序时原样返回', () => {
    const list = [o('a'), o('b')];
    expect(aoi.orders.sortOrders(list, { field: 'nope', dir: 1 })).toBe(list);
    expect(aoi.orders.sortOrders(list, null)).toBe(list);
    expect(aoi.orders.compareBy(o('a'), o('b'), 'nope', 1)).toBe(0);
  });
});

describe('Aoi.orders 排序状态与 localStorage（v3.6.2 跨刷新记忆）', () => {
  it('saveSort/loadSort 往返；非法字段/方向/损坏 JSON 一律拒绝', () => {
    aoi.orders.saveSort({ field: 'model', dir: -1 });
    expect(aoi.orders.loadSort()).toEqual({ field: 'model', dir: -1 });
    win.localStorage.setItem('aoi_orders_sort', JSON.stringify({ field: 'nope', dir: 1 }));
    expect(aoi.orders.loadSort()).toBeNull();
    win.localStorage.setItem('aoi_orders_sort', JSON.stringify({ field: 'model', dir: 2 }));
    expect(aoi.orders.loadSort()).toBeNull();
    win.localStorage.setItem('aoi_orders_sort', '{oops');
    expect(aoi.orders.loadSort()).toBeNull();
    aoi.orders.saveSort(null);
    expect(win.localStorage.getItem('aoi_orders_sort')).toBeNull();
    expect(aoi.orders.loadSort()).toBeNull();
  });

  it('setSort 同列循环 升→降→清除；异列直接升序', () => {
    seed([o('a', { count: 3 }), o('b', { count: 1 })]);
    aoi.orders.render();
    aoi.orders.setSort('count');
    expect(aoi.orders.sortSel).toEqual({ field: 'count', dir: 1 });
    aoi.orders.setSort('count');
    expect(aoi.orders.sortSel).toEqual({ field: 'count', dir: -1 });
    aoi.orders.setSort('count');
    expect(aoi.orders.sortSel).toBeNull();
    aoi.orders.setSort('count');
    expect(aoi.orders.sortSel).toEqual({ field: 'count', dir: 1 });
    aoi.orders.setSort('buyer');
    expect(aoi.orders.sortSel).toEqual({ field: 'buyer', dir: 1 });
    expect(JSON.parse(win.localStorage.getItem('aoi_orders_sort'))).toEqual({ field: 'buyer', dir: 1 });
  });
});

describe('Aoi.orders.render 排序集成（v3.6.2 表头点击 / 移动端下拉）', () => {
  it('表头点击 → 行序变化、箭头显示、下拉同步、localStorage 持久化', () => {
    seed([o('a', { count: 3 }), o('b', { count: 1 }), o('c', { count: 2 })]);
    aoi.orders.render();
    expect(rowIds()).toEqual(['a', 'b', 'c']); // 默认 = 录入序

    const th = doc.querySelector('#orderTable thead th[data-sort="count"]');
    th.click();
    expect(rowIds()).toEqual(['b', 'c', 'a']);
    expect(th.querySelector('.sort-arrow').textContent).toBe('↑');
    expect(th.classList.contains('font-semibold')).toBe(true);
    expect(doc.getElementById('fSort').value).toBe('count:1');
    expect(JSON.parse(win.localStorage.getItem('aoi_orders_sort'))).toEqual({ field: 'count', dir: 1 });

    th.click();
    expect(rowIds()).toEqual(['a', 'c', 'b']);
    expect(th.querySelector('.sort-arrow').textContent).toBe('↓');
    expect(doc.getElementById('fSort').value).toBe('count:-1');

    th.click();
    expect(aoi.orders.sortSel).toBeNull();
    expect(rowIds()).toEqual(['a', 'b', 'c']);
    expect(th.querySelector('.sort-arrow').textContent).toBe('');
  });

  it('移动端下拉 → 行序与表头箭头同步；选「默认顺序」清除', () => {
    seed([o('a', { buyer: '小樱' }), o('b', { buyer: '阿明' })]);
    aoi.orders.render();
    const menu = doc.getElementById('fSort');
    expect(menu.getAttribute('onchange')).toContain('onSortMenu'); // 内联绑定（jsdom 不执行内联句柄，直接调函数）
    menu.value = 'buyer:1';
    aoi.orders.onSortMenu(menu);
    expect(rowIds()).toEqual(['b', 'a']);
    expect(doc.querySelector('#orderTable thead th[data-sort="buyer"] .sort-arrow').textContent).toBe('↑');
    expect(menu.value).toBe('buyer:1');
    menu.value = '';
    aoi.orders.onSortMenu(menu);
    expect(aoi.orders.sortSel).toBeNull();
    expect(rowIds()).toEqual(['a', 'b']);
  });

  it('排序后 d.orders 原序与统计不受影响', () => {
    seed([o('a', { count: 3 }), o('b', { count: 1 })]);
    aoi.orders.render();
    aoi.orders.setSort('count');
    expect(aoi.state.data.orders.map((x) => x.id)).toEqual(['a', 'b']);
    expect(doc.getElementById('orderStat').textContent).toContain('共 2 条');
  });

  it('筛选 + 排序叠加：先按购买者筛，再按数量排', () => {
    seed([
      o('a', { buyer: '小樱', count: 9 }),
      o('b', { buyer: '阿明', count: 2 }),
      o('c', { buyer: '小樱', count: 5 })
    ]);
    aoi.orders.render();
    doc.getElementById('fBuyer').value = '小樱';
    aoi.orders.render();
    aoi.orders.setSort('count');
    expect(rowIds()).toEqual(['c', 'a']);
  });
});
