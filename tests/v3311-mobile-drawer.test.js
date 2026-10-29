// v3.31.1 手机端适配测试
// ①工作台侧栏（wbSidebar）手机抽屉化：translate 滑入滑出 + 复用遮罩 + 头部汉堡按外壳分发
//   （workbench 开工作台侧栏、classic 开经典侧栏）+ nav 切视图自动收起 + 离开外壳复位收起位；
//   桌面端 md:translate-x-0 覆盖位移保持常驻布局（类固定在 HTML 上，此处断言类机制）。
// ②主页 14 格窄屏 2 列网格为 CSS 媒体查询（jsdom 无法断言视口），由样式文件覆盖。
import { describe, it, expect, beforeEach } from 'vitest';
import { aoi, doc, win } from './helpers/aoi.js';

function seedData() {
  aoi.state.data = {
    orders: [], activities: [], activityMeta: {}, batches: [], payments: [],
    notifications: [], announcements: [], reservoirs: [], cnChanges: [],
    typeMeta: {}, ipTypes: {}, addresses: {}, memberMeta: {}
  };
}

beforeEach(() => {
  win.localStorage.clear();
  seedData();
  aoi.navHistory.length = 0;
  aoi.setShell('classic');
  doc.querySelectorAll('[data-view]').forEach((el) => el.classList.add('hidden'));
});

describe('工作台侧栏手机抽屉（v3.31.1）', () => {
  it('wbSidebar 类含抽屉三件套（-translate-x-full / transition / md:translate-x-0）', () => {
    const cls = doc.getElementById('wbSidebar').className;
    expect(cls).toContain('-translate-x-full');
    expect(cls).toContain('transition-transform');
    expect(cls).toContain('md:translate-x-0');
  });

  it('toggleWorkbenchSidebar：开合 translate 位移并联动遮罩；workbench 模式手机端默认收起', () => {
    aoi.setShell('workbench');
    const wb = doc.getElementById('wbSidebar');
    expect(wb.classList.contains('hidden')).toBe(false);   // 外壳层已显示
    expect(wb.classList.contains('-translate-x-full')).toBe(true); // 手机端仍收起
    aoi.toggleWorkbenchSidebar();
    expect(wb.classList.contains('-translate-x-full')).toBe(false);
    expect(doc.getElementById('sidebarBackdrop').classList.contains('hidden')).toBe(false);
    aoi.toggleWorkbenchSidebar(false);
    expect(wb.classList.contains('-translate-x-full')).toBe(true);
    expect(doc.getElementById('sidebarBackdrop').classList.contains('hidden')).toBe(true);
  });

  it('汉堡按钮按外壳分发：workbench 开工作台侧栏，classic 开经典侧栏', () => {
    aoi.setShell('workbench');
    aoi.toggleNavDrawer();
    expect(doc.getElementById('wbSidebar').classList.contains('-translate-x-full')).toBe(false);
    expect(doc.getElementById('sidebar').classList.contains('-translate-x-full')).toBe(true);
    aoi.closeDrawers();
    aoi.setShell('classic');
    aoi.toggleNavDrawer();
    expect(doc.getElementById('sidebar').classList.contains('-translate-x-full')).toBe(false);
    aoi.closeDrawers();
  });

  it('nav 切视图自动收起全部抽屉；离开 workbench 外壳时复位收起位', () => {
    aoi.setShell('workbench');
    aoi.toggleWorkbenchSidebar();
    aoi.nav('view-orders');
    expect(doc.getElementById('wbSidebar').classList.contains('-translate-x-full')).toBe(true);
    aoi.toggleWorkbenchSidebar();
    aoi.setShell('home');
    expect(doc.getElementById('wbSidebar').classList.contains('hidden')).toBe(true);
    expect(doc.getElementById('wbSidebar').classList.contains('-translate-x-full')).toBe(true);
  });

  it('closeDrawers 同时收起两个抽屉并隐藏遮罩', () => {
    aoi.setShell('classic');
    aoi.toggleSidebar();
    aoi.toggleWorkbenchSidebar();
    aoi.closeDrawers();
    expect(doc.getElementById('sidebar').classList.contains('-translate-x-full')).toBe(true);
    expect(doc.getElementById('wbSidebar').classList.contains('-translate-x-full')).toBe(true);
    expect(doc.getElementById('sidebarBackdrop').classList.contains('hidden')).toBe(true);
  });
});
