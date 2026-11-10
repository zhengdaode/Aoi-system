// v3.31.1 手机端适配测试（v3.34.0 修订：经典侧栏桌面与手机统一「平时收起 + 弹出」悬浮层）
// ①工作台侧栏（wbSidebar）手机抽屉化：translate 滑入滑出 + 复用遮罩 + 头部汉堡按外壳分发
//   （workbench 开工作台侧栏、classic 开经典侧栏）+ nav 切视图自动收起 + 离开外壳复位收起位；
//   桌面端 md:translate-x-0 覆盖位移保持常驻布局（类固定在 HTML 上，此处断言类机制）。
// ②经典侧栏 v3.34.0 起全部视口同一套 translate 抽屉语义（汉堡点击模式 / 左缘悬停模式 /
//   遮罩默认随开随亮 / closeDrawers 两端都收），不再有 md:hidden 流内折叠分支。
// ③主页 14 格窄屏 2 列网格为 CSS 媒体查询（jsdom 无法断言视口），由样式文件覆盖。
import { describe, it, expect, beforeEach, vi } from 'vitest';
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
  // 复位侧栏到页面初始态：收起位 + 遮罩隐藏（v3.34.0 起桌面手机同一套类）
  doc.getElementById('sidebar').classList.add('-translate-x-full');
  doc.getElementById('sidebarBackdrop').classList.add('hidden');
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

  it('汉堡按钮按外壳分发：workbench 开工作台侧栏，classic 开经典侧栏（v3.34.0 起同为 translate 抽屉语义）', () => {
    aoi.setShell('workbench');
    aoi.toggleNavDrawer();
    expect(doc.getElementById('wbSidebar').classList.contains('-translate-x-full')).toBe(false);
    expect(doc.getElementById('sidebar').classList.contains('-translate-x-full')).toBe(true);
    aoi.closeDrawers();
    aoi.setShell('classic');
    aoi.toggleNavDrawer();
    expect(doc.getElementById('sidebar').classList.contains('-translate-x-full')).toBe(false);
    expect(doc.getElementById('sidebarBackdrop').classList.contains('hidden')).toBe(false);
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

  it('toggleSidebar/closeDrawers（v3.34.0）：开=位移+遮罩点亮、关=复位；两端统一无视口分支', () => {
    aoi.setShell('classic');
    aoi.toggleSidebar();
    expect(doc.getElementById('sidebar').classList.contains('-translate-x-full')).toBe(false);
    expect(doc.getElementById('sidebarBackdrop').classList.contains('hidden')).toBe(false);
    expect(aoi._sbOpenedBy).toBe('click');
    aoi.closeDrawers();
    expect(doc.getElementById('sidebar').classList.contains('-translate-x-full')).toBe(true);
    expect(doc.getElementById('sidebarBackdrop').classList.contains('hidden')).toBe(true);
    expect(aoi._sbOpenedBy).toBe('');
  });

  it('悬停模式（v3.34.0）：左缘热区 mouseenter 打开并标记 hover；移出侧栏 350ms 自动收起；点汉堡转点击模式', () => {
    vi.useFakeTimers();
    try {
      aoi.setShell('classic');
      const sb = doc.getElementById('sidebar');
      // 左缘热区悬停打开
      doc.getElementById('sidebarEdge').dispatchEvent(new win.Event('mouseenter'));
      expect(sb.classList.contains('-translate-x-full')).toBe(false);
      expect(aoi._sbOpenedBy).toBe('hover');
      expect(doc.getElementById('sidebarBackdrop').classList.contains('hidden')).toBe(false);
      // 悬停中途点汉堡 = 转点击模式（保持打开）
      aoi.toggleNavDrawer();
      expect(sb.classList.contains('-translate-x-full')).toBe(false);
      expect(aoi._sbOpenedBy).toBe('click');
      aoi.toggleSidebar(false);
      // 再次悬停打开 → 移出侧栏 → 350ms 后自动收起
      doc.getElementById('sidebarEdge').dispatchEvent(new win.Event('mouseenter'));
      sb.dispatchEvent(new win.Event('mouseleave'));
      vi.advanceTimersByTime(400);
      expect(sb.classList.contains('-translate-x-full')).toBe(true);
      // 移出后又回到侧栏（mouseenter）= 取消自动收起
      doc.getElementById('sidebarEdge').dispatchEvent(new win.Event('mouseenter'));
      sb.dispatchEvent(new win.Event('mouseleave'));
      sb.dispatchEvent(new win.Event('mouseenter'));
      vi.advanceTimersByTime(600);
      expect(sb.classList.contains('-translate-x-full')).toBe(false);
      aoi.toggleSidebar(false);
    } finally {
      vi.useRealTimers();
    }
  });

  it('Esc 收起经典侧栏（v3.34.0 悬浮层语义）', () => {
    aoi.setShell('classic');
    aoi.toggleSidebar();
    doc.dispatchEvent(new win.KeyboardEvent('keydown', { key: 'Escape' }));
    expect(doc.getElementById('sidebar').classList.contains('-translate-x-full')).toBe(true);
  });
});
