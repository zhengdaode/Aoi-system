// v3.29.0 排谷表交互升级：①「已排/库存」行 ②悬浮位次名词（买家-状态-共排N位-第M名）
// ③同列拖动换位（鼠标拖拽 + 触屏长按）与右键「编辑位次」（上移/下移x位、顶部、底部）+ 列聚焦动画
// ④每页最多 20 行、超出翻页（位次号跨页连续）
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { aoi, doc, win } from './helpers/aoi.js';

const P = () => aoi.paigu;
const ACT = '8.23涩谷场外';
const KEY = '毛绒|皮卡丘土王';

function seedData() {
  aoi.state.data = {
    orders: [
      { id: 'o1', activity: ACT, type: '毛绒', model: '皮卡丘土王', buyer: '一枚小混子', currency: 'jpy', priceOrig: 5500, price: null, count: 1, status: '未到货' },
      { id: 'o2', activity: ACT, type: '毛绒', model: '皮卡丘土王', buyer: '草莓头那个莹', currency: 'jpy', priceOrig: 4400, price: 211, count: 1, status: '未到货' }
    ],
    activities: [ACT],
    activityMeta: {
      [ACT]: {
        products: [{ id: 'p1', type: '毛绒', model: '皮卡丘土王', refImage: '', refUrl: '', price: 120, priceOrig: null, currency: null, limit: null, stock: 8 }],
        buyers: [], trackings: []
      }
    },
    limitPlans: {},
    paigu: {
      [ACT]: {
        slots: {
          [KEY]: [
            { id: 's1', orderId: 'o1', buyer: '一枚小混子', status: '未付款', addedAt: '10-20 12:00' },
            { id: 's2', orderId: 'o2', buyer: '草莓头那个莹', status: '已下定', addedAt: '10-20 12:01' }
          ]
        },
        log: []
      }
    },
    batches: [], payments: [], notifications: [], announcements: [], reservoirs: [],
    typeMeta: {}, ipTypes: {}, addresses: {}, memberMeta: {},
    calc: { jpyRate: 0.048, jpyMarkup: 0 }
  };
  aoi.saveTeamData = vi.fn(async function (data) { return data; });
}

beforeEach(() => {
  seedData();
  P().renderAll();
  P().openActivity(ACT);
});

describe('①「已排/库存」行', () => {
  it('行头为「已排/库存」，格显示 已排数/库存数', () => {
    const label = [...doc.querySelectorAll('#paiguBody thead th')].map((th) => th.textContent);
    expect(label).toContain('已排/库存');
    const th = doc.querySelector('.paigu-head-stock');
    expect(th.textContent).toContain('2/8'); // 2 排位 / 库存 8
  });
});

describe('②悬浮位次名词（title）', () => {
  it('格式：买家-状态-第M名；同买家多排位加「共排N位」', () => {
    aoi.state.data.paigu[ACT].slots[KEY].push({ id: 's3', buyer: '一枚小混子', status: '未付款', addedAt: '10-21 10:00' });
    P().renderAll();
    const s1 = doc.querySelector('[data-slot="s1"]');
    const s2 = doc.querySelector('[data-slot="s2"]');
    const s3 = doc.querySelector('[data-slot="s3"]');
    expect(s1.getAttribute('title')).toBe('一枚小混子-未付款-共排2位-第1名');
    expect(s2.getAttribute('title')).toBe('草莓头那个莹-已下定-第2名');
    expect(s3.getAttribute('title')).toBe('一枚小混子-未付款-共排2位-第3名');
  });
});

describe('④每页 20 行分页', () => {
  it('超出 20 位出现翻页条：第 1 页显示 1-20，下一页显示 21+，位次号连续', async () => {
    d25(25);
    P().renderAll();
    expect(doc.getElementById('paiguBody').textContent).toContain('1 / 2 页');
    let pos = [...doc.querySelectorAll('#paiguBody tbody .pq-pos')].map((td) => Number(td.textContent));
    expect(pos[0]).toBe(1);
    expect(pos).toContain(20);
    expect(pos).not.toContain(21);
    doc.querySelector('[data-pact="page-next"]').click();
    pos = [...doc.querySelectorAll('#paiguBody tbody .pq-pos')].map((td) => Number(td.textContent));
    expect(pos[0]).toBe(21);
    expect(pos[pos.length - 1]).toBe(25);
    // 悬浮位次名词在第二页同样带全局位次
    const lastSlot = [...doc.querySelectorAll('#paiguBody [data-pact="slot"]')].pop();
    expect(lastSlot.getAttribute('title')).toContain('-第25名');
    doc.querySelector('[data-pact="page-prev"]').click();
    pos = [...doc.querySelectorAll('#paiguBody tbody .pq-pos')].map((td) => Number(td.textContent));
    expect(pos[0]).toBe(1);
  });

  it('不超过 20 位时不显示翻页条', () => {
    d25(15);
    P().renderAll();
    expect(doc.querySelector('[data-pact="page-next"]')).toBeNull();
    expect(doc.querySelector('[data-pact="page-prev"]')).toBeNull();
  });
});

describe('③位次移动（moveSlotTo / moveSlotBy / moveSlot 包装）', () => {
  it('moveSlotTo：移到目标行，原行起顺延；日志留痕', async () => {
    const ok = await P().moveSlotTo(ACT, 's2', 1);
    expect(ok).toBe(true);
    expect(aoi.state.data.paigu[ACT].slots[KEY].map((s) => s.id)).toEqual(['s2', 's1']);
    expect(aoi.state.data.paigu[ACT].log[0].text).toContain('第 2 位 → 第 1 位');
    expect(aoi.saveTeamData).toHaveBeenCalled();
  });

  it('moveSlotBy：按相对位数移动并钳制边界；原位不动返回 false', async () => {
    expect(await P().moveSlotBy(ACT, 's1', 5)).toBe(true); // 下移 5 位 → 钳制到底部
    expect(aoi.state.data.paigu[ACT].slots[KEY].map((s) => s.id)).toEqual(['s2', 's1']);
    expect(await P().moveSlotBy(ACT, 's1', 0)).toBe(false);
    // v3.27.0 的 moveSlot ±1 包装行为不变
    expect(await P().moveSlot(ACT, 's1', -1)).toBe(true); // s1 在第 2 位，上移到顶部
    expect(aoi.state.data.paigu[ACT].slots[KEY].map((s) => s.id)).toEqual(['s1', 's2']);
    expect(await P().moveSlot(ACT, 's1', -1)).toBe(false); // 已在第 1 位
    expect(await P().moveSlot(ACT, 's1', 1)).toBe(true);
    expect(aoi.state.data.paigu[ACT].slots[KEY].map((s) => s.id)).toEqual(['s2', 's1']);
  });
});

describe('③右键菜单「编辑位次」+ 列聚焦动画', () => {
  it('菜单含上移/下移/顶部/底部与位数输入；打开时该列 pq-focus、其余 pq-focusing 变暗', () => {
    d25(23); // 多行便于观察列聚焦覆盖
    P().renderAll();
    P().modalSlotMenu(ACT, 's2');
    expect(doc.getElementById('pqMoveN')).not.toBeNull();
    ['up', 'down', 'top', 'bottom'].forEach((dir) => {
      expect(doc.querySelector('[data-pact="slot-move"][data-dir="' + dir + '"]')).not.toBeNull();
    });
    const table = doc.querySelector('table.paigu-sheet');
    expect(table.classList.contains('pq-focusing')).toBe(true);
    const focused = table.querySelectorAll('.pq-focus');
    expect(focused.length).toBeGreaterThanOrEqual(4); // 3 表头行 + 该列若干位次行
    [...focused].forEach((cell) => expect(cell.cellIndex).toBe(1)); // 第 2 列（位次列后第一商品列）
    P().renderAll(); // 模拟重渲染后聚焦类被清掉
    expect(doc.querySelector('table.paigu-sheet').classList.contains('pq-focusing')).toBe(false);
  });

  it('点「上移到顶部」移动并关层；位数输入生效（下移 2 位）', async () => {
    P().modalSlotMenu(ACT, 's2');
    doc.querySelector('[data-pact="slot-move"][data-dir="top"]').click();
    await new Promise((r) => setTimeout(r, 0));
    expect(aoi.state.data.paigu[ACT].slots[KEY].map((s) => s.id)).toEqual(['s2', 's1']);
    expect(doc.getElementById('paiguModal').classList.contains('hidden')).toBe(true);

    P().modalSlotMenu(ACT, 's1');
    doc.getElementById('pqMoveN').value = '2';
    doc.querySelector('[data-pact="slot-move"][data-dir="down"]').click();
    await new Promise((r) => setTimeout(r, 0));
    // s1 从第 1 位下移 2 位 → 超出列长钳制到底部（共 2 位）
    expect(aoi.state.data.paigu[ACT].slots[KEY].map((s) => s.id)).toEqual(['s2', 's1']);
  });

  it('弹层关闭（Esc/遮罩/按钮）清除聚焦类', () => {
    P().modalSlotMenu(ACT, 's1');
    expect(doc.querySelector('table.paigu-sheet').classList.contains('pq-focusing')).toBe(true);
    doc.querySelector('[data-pact="modal-close"]').click();
    expect(doc.querySelector('table.paigu-sheet').classList.contains('pq-focusing')).toBe(false);
  });
});

describe('③同列拖动换位（HTML5 拖拽）', () => {
  it('dragstart → dragover 目标行标记 pq-drop → drop 落位；跨列拖动被忽略', async () => {
    const s1 = doc.querySelector('[data-slot="s1"]');
    const s2 = doc.querySelector('[data-slot="s2"]');
    expect(s1.getAttribute('draggable')).toBe('true');
    expect(s1.getAttribute('data-key')).toBe(KEY);
    expect(s1.getAttribute('data-idx')).toBe('1');
    // s2 拖到第 1 行
    s2.dispatchEvent(new win.Event('dragstart', { bubbles: true }));
    expect(s2.classList.contains('pq-dragging')).toBe(true);
    s1.dispatchEvent(new win.Event('dragover', { bubbles: true }));
    expect(s1.classList.contains('pq-drop')).toBe(true);
    s1.dispatchEvent(new win.Event('drop', { bubbles: true }));
    await new Promise((r) => setTimeout(r, 0));
    expect(aoi.state.data.paigu[ACT].slots[KEY].map((s) => s.id)).toEqual(['s2', 's1']);
    expect(s2.classList.contains('pq-dragging')).toBe(false);
    expect(doc.querySelector('.pq-drop')).toBeNull();
  });

  it('dragend 未落位时只清理标记不移动', async () => {
    const s1 = doc.querySelector('[data-slot="s1"]');
    s1.dispatchEvent(new win.Event('dragstart', { bubbles: true }));
    doc.dispatchEvent(new win.Event('dragend', { bubbles: true }));
    await new Promise((r) => setTimeout(r, 0));
    expect(aoi.state.data.paigu[ACT].slots[KEY].map((s) => s.id)).toEqual(['s1', 's2']);
    expect(doc.querySelector('.pq-dragging')).toBeNull();
  });
});

describe('③触屏长按拖动（350ms 进入拖动态）', () => {
  it('长按后加 pq-dragging，松手清理（jsdom 无 elementFromPoint 不落位）', () => {
    vi.useFakeTimers();
    const td = doc.querySelector('[data-slot="s1"]');
    const ts = new win.Event('touchstart', { bubbles: true });
    ts.touches = [{ clientX: 0, clientY: 0 }];
    td.dispatchEvent(ts);
    vi.advanceTimersByTime(400);
    expect(td.classList.contains('pq-dragging')).toBe(true);
    const te = new win.Event('touchend', { bubbles: true, cancelable: true });
    te.changedTouches = [{ clientX: 0, clientY: 0 }];
    td.dispatchEvent(te);
    expect(td.classList.contains('pq-dragging')).toBe(false);
    vi.useRealTimers();
  });

  it('长按前移动超过 10px 取消拖动', () => {
    vi.useFakeTimers();
    const td = doc.querySelector('[data-slot="s1"]');
    const ts = new win.Event('touchstart', { bubbles: true });
    ts.touches = [{ clientX: 0, clientY: 0 }];
    td.dispatchEvent(ts);
    const tm = new win.Event('touchmove', { bubbles: true, cancelable: true });
    tm.touches = [{ clientX: 40, clientY: 0 }];
    doc.dispatchEvent(tm);
    vi.advanceTimersByTime(400);
    expect(td.classList.contains('pq-dragging')).toBe(false);
    vi.useRealTimers();
  });
});

// 在该商品列补 N 个排位（总量达到 N；seed 已有 2 个）
function d25(total) {
  const arr = aoi.state.data.paigu[ACT].slots[KEY];
  for (let i = arr.length + 1; i <= total; i++) {
    arr.push({ id: 'sx' + i, buyer: '买家' + i, status: '未付款', addedAt: '10-21 10:00' });
  }
}
