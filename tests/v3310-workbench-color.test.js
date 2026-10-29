// v3.31.0 工作台分组行为与分类颜色测试
// ①「设置自定义排序」的成果（分类/顺序/展示）改挂侧栏「自定义排序」分组展示，
//   基础功能列表回归静态全量目录（业务→基础数据→工具，不受自定义影响）
// ②分类颜色：新建时选色 + 随时改色（左列色块展开调色板），分类色作为该分类功能的 UI 底色
//  （侧栏「自定义排序」行底色 + 主页快捷格底色）
// ③主页快捷格（自定义展示）：功能标题居中放大（去分组圆点）、底色取分类色，无分类回落默认奶油底
import { describe, it, expect, beforeEach } from 'vitest';
import { aoi, doc, win } from './helpers/aoi.js';

beforeEach(() => {
  win.localStorage.clear();
  aoi.state.data = { orders: [], payments: [], batches: [] };
  aoi.navHistory.length = 0;
  aoi.setShell('classic');
  doc.querySelectorAll('[data-view]').forEach((el) => el.classList.add('hidden'));
  // 侧栏分组展开态在共享 DOM 中跨用例残留，逐项复位
  doc.getElementById('wbBuilderItems').classList.add('hidden');
  doc.getElementById('wbDataItems').classList.add('hidden');
  doc.getElementById('wbBuilderChevron').textContent = '▾';
  doc.getElementById('wbDataChevron').textContent = '▾';
});

describe('分类颜色（数据层）', () => {
  it('addCollection 支持颜色；setCollectionColor 可改色/清色；collectionColorOf 回查', () => {
    expect(aoi.workbench.addCollection('常用', '#f97362')).toBe(true);
    expect(aoi.workbench.loadLayout().collections[0].color).toBe('#f97362');
    expect(aoi.workbench.collectionColorOf('view-orders')).toBe('');
    aoi.workbench.assign('view-orders', '常用');
    expect(aoi.workbench.collectionColorOf('view-orders')).toBe('#f97362');
    aoi.workbench.setCollectionColor('常用', '#3b82f6');
    expect(aoi.workbench.collectionColorOf('view-orders')).toBe('#3b82f6');
    aoi.workbench.setCollectionColor('常用', '');
    expect(aoi.workbench.collectionColorOf('view-orders')).toBe('');
  });

  it('旧布局数据（无 color 字段）向后兼容：collectionColorOf 返回空串', () => {
    win.localStorage.setItem('aoi_wb_layout', JSON.stringify({ hidden: [], collections: [{ name: '旧分类', views: ['view-calc'] }] }));
    expect(aoi.workbench.collectionColorOf('view-calc')).toBe('');
    expect(aoi.workbench.collectionColorOf('view-orders')).toBe('');
  });
});

describe('设置自定义排序页（颜色 UI + 分类内排序）', () => {
  it('新建区色板渲染（色板 + 无颜色）；左列点色块展开调色板，选色即生效并收起', () => {
    aoi.workbench.addCollection('常用', '');
    aoi.workbench.renderSort();
    expect(doc.getElementById('wbNewCollColors').querySelectorAll('[data-wbnewcol]').length)
      .toBe(aoi.workbench.COLORS.length + 1);
    doc.querySelector('[data-wbcolcolor="常用"]').click();
    expect(doc.querySelector('[data-wbcolset="常用|#10b981"]')).toBeTruthy();
    doc.querySelector('[data-wbcolset="常用|#10b981"]').click();
    expect(aoi.workbench.loadLayout().collections[0].color).toBe('#10b981');
    // 选色后调色行收起
    expect(doc.querySelector('[data-wbcolset]')).toBeNull();
  });

  it('分类内上移/下移（moveInView）即「自定义排序」分组内的展示顺序', () => {
    aoi.workbench.addCollection('常用');
    aoi.workbench.assign('view-orders', '常用');
    aoi.workbench.assign('view-paigu', '常用');
    aoi.workbench.moveInView('view-orders', 1);
    expect(aoi.workbench.loadLayout().collections[0].views).toEqual(['view-paigu', 'view-orders']);
    aoi.workbench.moveInView('view-orders', -1);
    expect(aoi.workbench.loadLayout().collections[0].views).toEqual(['view-orders', 'view-paigu']);
    aoi.workbench.renderCustomNav();
    const ids = Array.from(doc.querySelectorAll('#wbDataItems [data-nav]'))
      .map(a => a.getAttribute('data-nav')).filter(id => id !== 'view-wbsort');
    expect(ids).toEqual(['view-orders', 'view-paigu']);
  });
});

describe('侧栏「自定义排序」分组底色', () => {
  it('分类色作功能行底色（淡 tint）；无色分类行无内联背景；未自定义时给引导文案 + 设置入口常驻', () => {
    aoi.workbench.addCollection('珊瑚组', '#f97362');
    aoi.workbench.assign('view-orders', '珊瑚组');
    aoi.workbench.addCollection('无色组');
    aoi.workbench.assign('view-calc', '无色组');
    aoi.workbench.renderCustomNav();
    const colored = doc.querySelector('#wbDataItems [data-nav="view-orders"]');
    expect(colored.getAttribute('style')).toContain('#f97362');
    const plain = doc.querySelector('#wbDataItems [data-nav="view-calc"]');
    expect(plain.getAttribute('style')).toBeNull();
    // 未自定义（清空布局）：引导文案 + 设置入口
    win.localStorage.removeItem('aoi_wb_layout');
    aoi.workbench.renderCustomNav();
    const box = doc.getElementById('wbDataItems').innerHTML;
    expect(box).toContain('尚未自定义');
    expect(box).toContain('设置自定义排序');
  });
});

describe('主页快捷格（自定义展示）', () => {
  it('标题居中放大（无分组圆点）；底色 = 分类色；无分类回落默认奶油底', () => {
    aoi.workbench.addCollection('珊瑚组', '#f97362');
    aoi.workbench.assign('view-orders', '珊瑚组');
    const shorts = Array(14).fill(null);
    shorts[0] = 'view-orders'; // 有分类色
    shorts[1] = 'view-calc';   // 无分类
    win.localStorage.setItem('aoi_home_shortcuts', JSON.stringify(shorts));
    aoi.home.enter(false);
    const grid = doc.getElementById('homeGrid');
    const t0 = grid.querySelector('[data-hslot="0"]');
    expect(t0.getAttribute('style')).toContain('background:#f97362');
    expect(t0.querySelector('.home-tile-label')).toBeTruthy();
    expect(t0.querySelector('.home-tile-dot')).toBeNull();
    const t1 = grid.querySelector('[data-hslot="1"]');
    expect(t1.getAttribute('style')).not.toContain('background');
    expect(t1.querySelector('.home-tile-label')).toBeTruthy();
  });
});
