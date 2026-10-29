// v3.30.0 主页面 + 工作台测试
// 覆盖：外壳模式切换 / 主页面渲染（待办、临近出荷）/ 自定义快捷跳转（14 格 + localStorage）/
// 启动动画（时间线 + 点击跳过 + 不重播）/ 功能面板 / 工作台侧栏（基础功能列表合集、
// 自定义排序、隐藏仅影响展示）
import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { aoi, win, doc } from './helpers/aoi.js';

function visibleView() {
  const el = doc.querySelector('[data-view]:not(.hidden)');
  return el ? el.getAttribute('id') : null;
}

beforeEach(() => {
  win.localStorage.clear();
  aoi.state.data = { orders: [], payments: [], batches: [] };
  aoi.navHistory = [];
  aoi.setShell('classic');
  doc.querySelectorAll('[data-view]').forEach(el => el.classList.add('hidden'));
  const boot = doc.getElementById('bootAnim');
  boot.classList.add('hidden');
  boot.classList.remove('stage2', 'boot-fade');
  doc.getElementById('view-home').classList.remove('pre-reveal');
  // 侧栏分组展开态在共享 DOM 中跨用例残留，逐项复位
  doc.getElementById('wbBuilderItems').classList.add('hidden');
  doc.getElementById('wbDataItems').classList.add('hidden');
  doc.getElementById('wbBuilderChevron').textContent = '▾';
  doc.getElementById('wbDataChevron').textContent = '▾';
});

describe('外壳模式 setShell / applyShellForView', () => {
  it('home 外壳隐藏默认侧栏与头部、main 去内边距', () => {
    aoi.setShell('home');
    expect(doc.getElementById('sidebar').classList.contains('hidden')).toBe(true);
    expect(doc.querySelector('#screen-app > main > header').classList.contains('hidden')).toBe(true);
    expect(doc.querySelector('#screen-app > main').classList.contains('p-0')).toBe(true);
    expect(doc.getElementById('wbSidebar').classList.contains('hidden')).toBe(true);
  });

  it('workbench 外壳显示工作台侧栏、隐藏默认侧栏', () => {
    aoi.setShell('workbench');
    expect(doc.getElementById('wbSidebar').classList.contains('hidden')).toBe(false);
    expect(doc.getElementById('sidebar').classList.contains('hidden')).toBe(true);
  });

  it('nav 到 view-home 强制 home 外壳；其余视图沿用当前外壳', () => {
    aoi.setShell('workbench');
    aoi.nav('view-home');
    expect(aoi.shell).toBe('home');
    aoi.setShell('workbench');
    aoi.nav('view-orders');
    expect(aoi.shell).toBe('workbench');
  });
});

describe('主页面渲染', () => {
  it('enter(false) 进入主页面：视图可见、14 格默认全为空格子', () => {
    aoi.home.enter(false);
    expect(visibleView()).toBe('view-home');
    expect(aoi.shell).toBe('home');
    expect(doc.querySelectorAll('.home-tile').length).toBe(14);
    expect(doc.querySelectorAll('.home-tile-empty').length).toBe(14);
    // 中央面板存在：待办 + 你好 + 临近出荷
    expect(doc.getElementById('homeTodoPending')).toBeTruthy();
    expect(doc.getElementById('homeHello').textContent).toContain('你好');
    expect(doc.getElementById('homeHello').textContent).toContain('开始工作');
  });

  it('待办数字与总览口径一致', () => {
    aoi.state.data = {
      orders: [
        { id: 'o1', status: '已到货', shipped: '未发', count: 2, batch: 'b1' },
        { id: 'o2', status: '未到货', count: 1 }
      ],
      payments: [{ id: 'p1', status: '待审核' }],
      batches: [{ id: 'b1', date: '2026-11-01', name: '第一批' }]
    };
    aoi.home.enter(false);
    expect(doc.getElementById('homeTodoPending').textContent).toBe('1');
    expect(doc.getElementById('homeTodoShip').textContent).toBe('1');
    expect(doc.getElementById('homeTodoArrive').textContent).toBe('1');
  });

  it('临近出荷：已到货未发订单按批次聚合展示批次名/日期/件数', () => {
    aoi.state.data = {
      orders: [
        { id: 'o1', status: '已到货', shipped: '未发', count: 3, batch: 'b1' },
        { id: 'o2', status: '已到货', shipped: '已发', count: 9, batch: 'b1' },
        { id: 'o3', status: '未到货', count: 5, batch: 'b1' }
      ],
      payments: [],
      batches: [
        { id: 'b1', date: '2026-11-01', name: '万圣节一批' },
        { id: 'b2', date: '2026-12-01' }
      ]
    };
    aoi.home.enter(false);
    const html = doc.getElementById('homeShipList').innerHTML;
    expect(html).toContain('万圣节一批');
    expect(html).toContain('2026-11-01');
    expect(html).toContain('3 件待发'); // 已发的 9 件与未到货的 5 件不计入
    expect(html).not.toContain('2026-12-01');
  });

  it('无临近出荷时显示占位文案', () => {
    aoi.home.enter(false);
    expect(doc.getElementById('homeShipList').textContent).toContain('暂无临近出荷');
  });
});

describe('自定义功能快捷跳转', () => {
  it('setShortcut 持久化到 localStorage 并渲染成实格子', () => {
    aoi.home.enter(false);
    aoi.home.setShortcut(3, 'view-orders');
    const saved = JSON.parse(win.localStorage.getItem('aoi_home_shortcuts'));
    expect(saved[3]).toBe('view-orders');
    aoi.home.render();
    expect(doc.querySelectorAll('.home-tile-filled').length).toBe(1);
    const tile = doc.querySelector('.home-tile-filled');
    expect(tile.getAttribute('data-hslot')).toBe('3');
    expect(tile.getAttribute('title')).toBe('订单管理');
  });

  it('点击实格子跳转到对应功能（classic 外壳）', () => {
    aoi.home.enter(false);
    aoi.home.setShortcut(0, 'view-paigu');
    aoi.home.render();
    doc.querySelector('.home-tile-filled').click();
    expect(visibleView()).toBe('view-paigu');
    expect(aoi.shell).toBe('classic');
  });

  it('点击空格子打开功能面板并处于挑选模式；选中后回填并返回主页', () => {
    aoi.home.enter(false);
    doc.querySelector('.home-tile-empty').click();
    expect(visibleView()).toBe('view-launcher');
    expect(aoi.home.pickerSlot).toBe(0);
    aoi.home.assignFromLauncher('view-calc');
    expect(aoi.home.pickerSlot).toBe(null);
    expect(JSON.parse(win.localStorage.getItem('aoi_home_shortcuts'))[0]).toBe('view-calc');
    expect(visibleView()).toBe('view-home');
  });

  it('clearShortcut 清除后格子回到空态', () => {
    aoi.home.enter(false);
    aoi.home.setShortcut(5, 'view-orders');
    aoi.home.render();
    aoi.home.clearShortcut(5);
    expect(JSON.parse(win.localStorage.getItem('aoi_home_shortcuts'))[5]).toBe(null);
    expect(doc.querySelectorAll('.home-tile-empty').length).toBe(14);
  });

  it('损坏的 localStorage 数据回落为全空格子', () => {
    win.localStorage.setItem('aoi_home_shortcuts', '{bad json');
    expect(aoi.home.loadShortcuts().length).toBe(14);
    expect(aoi.home.loadShortcuts().every(x => x === null)).toBe(true);
  });
});

describe('功能面板（view-launcher）', () => {
  it('按类型彩色分组展示全部注册功能', () => {
    aoi.home.enter(false);
    aoi.nav('view-launcher');
    const body = doc.getElementById('launcherBody').innerHTML;
    expect(body).toContain('业务');
    expect(body).toContain('基础数据');
    expect(body).toContain('工具');
    expect(doc.querySelectorAll('[data-lview]').length).toBe(aoi.workbench.FEATURES.length);
    expect(body).toContain('lt-biz');
    expect(body).toContain('lt-data');
    expect(body).toContain('lt-tool');
  });

  it('非挑选模式下点击功能卡直接跳转', () => {
    aoi.home.enter(false);
    aoi.nav('view-launcher');
    doc.querySelector('[data-lview="view-orders"]').click();
    expect(visibleView()).toBe('view-orders');
    expect(aoi.shell).toBe('classic');
  });

  it('返回：有历史时回退上一界面（单步），无历史时回主页', () => {
    aoi.home.enter(false); // 历史：空
    aoi.nav('view-launcher');
    aoi.home.launcherBack();
    expect(visibleView()).toBe('view-home');
    aoi.nav('view-launcher');
    aoi.nav('view-orders');
    aoi.home.launcherBack(); // 单步回退 → 功能面板
    expect(visibleView()).toBe('view-launcher');
    expect(aoi.home.pickerSlot).toBe(null);
  });
});

describe('启动动画', () => {
  afterEach(() => vi.useRealTimers());

  it('enter(true) 播放：遮罩可见、主页处于 pre-reveal；1.5s 后 stage2（黑字呼吸边框+背景渐白）；3s 后结束', () => {
    vi.useFakeTimers();
    aoi.home.enter(true);
    const ov = doc.getElementById('bootAnim');
    expect(ov.classList.contains('hidden')).toBe(false);
    expect(doc.getElementById('view-home').classList.contains('pre-reveal')).toBe(true);
    expect(aoi.home.bootPlayed).toBe(true);

    vi.advanceTimersByTime(1500);
    expect(ov.classList.contains('stage2')).toBe(true);

    vi.advanceTimersByTime(1500);
    expect(doc.getElementById('view-home').classList.contains('pre-reveal')).toBe(false);
    vi.advanceTimersByTime(400);
    expect(ov.classList.contains('hidden')).toBe(true);
  });

  it('点击遮罩任意处跳过：立即结束动画并显现主页 UI', () => {
    vi.useFakeTimers();
    aoi.home.enter(true);
    doc.getElementById('bootAnim').click();
    expect(doc.getElementById('view-home').classList.contains('pre-reveal')).toBe(false);
    vi.advanceTimersByTime(400);
    expect(doc.getElementById('bootAnim').classList.contains('hidden')).toBe(true);
  });

  it('每次启动只播一次：之后再回主页不重播', () => {
    vi.useFakeTimers();
    aoi.home.enter(true);
    vi.advanceTimersByTime(3500);
    aoi.nav('view-orders');
    aoi.home.enter(false);
    expect(doc.getElementById('bootAnim').classList.contains('hidden')).toBe(true);
    expect(doc.getElementById('view-home').classList.contains('pre-reveal')).toBe(false);
  });
});

describe('工作台', () => {
  it('enter 进入工作台：默认落在「首页」（总览仪表盘），工作台侧栏可见', () => {
    aoi.workbench.enter();
    expect(visibleView()).toBe('view-overview');
    expect(aoi.shell).toBe('workbench');
    expect(doc.getElementById('wbSidebar').classList.contains('hidden')).toBe(false);
  });

  it('侧栏含创建拼团 / 账号与设置 / 自定义排序 / 娱乐活动工具 / 创意工坊 / 敬请期待', () => {
    const sb = doc.getElementById('wbSidebar').innerHTML;
    expect(sb).toContain('创建拼团');
    expect(sb).toContain('账号与设置');
    expect(sb).toContain('基础功能列表');
    expect(sb).toContain('自定义排序');
    expect(sb).toContain('设置自定义排序');
    expect(sb).toContain('娱乐活动工具');
    expect(sb).toContain('创意工坊');
    expect(sb).toContain('敬请期待');
  });

  it('基础功能列表展开 = 业务+基础数据+工具 全部功能合集', () => {
    aoi.workbench.enter();
    aoi.workbench.toggleBuilder();
    const items = Array.from(doc.querySelectorAll('#wbBuilderItems [data-nav]')).map(a => a.getAttribute('data-nav'));
    expect(items.length).toBe(aoi.workbench.FEATURES.length);
    expect(items).toContain('view-orders');
    expect(items).toContain('view-activities');
    expect(items).toContain('view-calc');
    expect(items).not.toContain('view-overview');   // 首页独立入口
    expect(items).not.toContain('view-settings');   // 账号与设置独立入口
  });

  it('分组展开/收起切换 chevron 与显隐', () => {
    aoi.workbench.enter();
    expect(doc.getElementById('wbBuilderItems').classList.contains('hidden')).toBe(true);
    aoi.workbench.toggleBuilder();
    expect(doc.getElementById('wbBuilderItems').classList.contains('hidden')).toBe(false);
    aoi.workbench.toggleBuilder();
    expect(doc.getElementById('wbBuilderItems').classList.contains('hidden')).toBe(true);
  });

  it('自定义排序：归属调整渲染到侧栏「自定义排序」分组，不改动基础功能列表（v3.31.0）', () => {
    aoi.workbench.enter();
    expect(aoi.workbench.addCollection('常用')).toBe(true);
    expect(aoi.workbench.addCollection('常用')).toBe(false); // 重名拒绝
    aoi.workbench.assign('view-orders', '常用');
    aoi.workbench.assign('view-paigu', '常用');
    aoi.workbench.toggleData();
    const custom = doc.getElementById('wbDataItems').innerHTML;
    expect(custom).toContain('常用');
    const ids = Array.from(doc.querySelectorAll('#wbDataItems [data-nav]')).map(a => a.getAttribute('data-nav'));
    expect(ids).toContain('view-orders');
    expect(ids).toContain('view-paigu');
    expect(ids).toContain('view-wbsort'); // 设置入口常驻
    aoi.workbench.toggleBuilder();
    const builder = doc.getElementById('wbBuilderItems').innerHTML;
    expect(builder).not.toContain('常用');   // 自定义分类不再进基础功能列表
    expect(builder).toContain('业务');       // 仍是静态三分组全量目录
    expect(builder).toContain('基础数据');
    expect(builder).toContain('工具');
  });

  it('展示勾选只作用于「自定义排序」分组；基础功能列表恒为全量（v3.31.0）', () => {
    aoi.workbench.enter();
    aoi.workbench.addCollection('常用');
    aoi.workbench.assign('view-orders', '常用');
    aoi.workbench.toggleHidden('view-orders');
    expect(aoi.workbench.isHidden('view-orders')).toBe(true);
    aoi.workbench.toggleData();
    const ids = Array.from(doc.querySelectorAll('#wbDataItems [data-nav]')).map(a => a.getAttribute('data-nav'));
    expect(ids).not.toContain('view-orders');   // 自定义分组不再展示
    aoi.workbench.toggleBuilder();
    const items = Array.from(doc.querySelectorAll('#wbBuilderItems [data-nav]')).map(a => a.getAttribute('data-nav'));
    expect(items).toContain('view-orders');     // 基础功能列表仍全量
    expect(items.length).toBe(aoi.workbench.FEATURES.length);
    // 恢复勾选即回归自定义分组
    aoi.workbench.toggleHidden('view-orders');
    aoi.workbench.renderCustomNav();
    const ids2 = Array.from(doc.querySelectorAll('#wbDataItems [data-nav]')).map(a => a.getAttribute('data-nav'));
    expect(ids2).toContain('view-orders');
  });

  it('删除分类后其功能回落未分类', () => {
    aoi.workbench.enter();
    aoi.workbench.addCollection('临时');
    aoi.workbench.assign('view-calc', '临时');
    expect(aoi.workbench.collectionOf('view-calc')).toBe('临时');
    aoi.workbench.removeCollection('临时');
    expect(aoi.workbench.collectionOf('view-calc')).toBe('');
  });

  it('设置自定义排序面板渲染：归属下拉与展示勾选', () => {
    aoi.workbench.enter();
    aoi.workbench.addCollection('常用');
    aoi.workbench.assign('view-orders', '常用');
    aoi.nav('view-wbsort');
    expect(visibleView()).toBe('view-wbsort');
    const sel = doc.querySelector('select[data-wbassign="view-orders"]');
    expect(sel.value).toBe('常用');
    expect(doc.querySelector('input[data-wbshow="view-orders"]').checked).toBe(true);
    aoi.workbench.toggleHidden('view-orders');
    expect(doc.querySelector('input[data-wbshow="view-orders"]').checked).toBe(false);
  });

  it('工作台布局持久化到 localStorage', () => {
    aoi.workbench.addCollection('常用');
    aoi.workbench.toggleHidden('view-calc');
    const saved = JSON.parse(win.localStorage.getItem('aoi_wb_layout'));
    expect(saved.collections[0].name).toBe('常用');
    expect(saved.hidden).toContain('view-calc');
    expect(aoi.workbench.loadLayout().hidden).toContain('view-calc');
  });
});

describe('主页面顶栏占位端口', () => {
  it('头像初始填充用户名首字母', () => {
    aoi.state.user = { username: 'debug' };
    aoi.home.fillAvatar();
    expect(doc.getElementById('homeAvatar').textContent).toBe('D');
  });
});
