// v3.33.0 统一返回 + 主视图回显 + 工作台列表合并测试
// ①需求 5：活动展开区「主视图 URL」输入回显活动封面回落链（meta.cover → 首商品参考图），
//   此前只回显 meta.cover，靠商品图回落显示封面的活动输入框恒为空；
// ②需求 6：返回按钮统一——排谷表删页内「‹ 返回」，core.js 新增 Aoi.VIEW_BACK 视图内回退
//   钩子（详情态由头部返回消化回列表且不消费导航历史；钩子返回 false 落回导航历史）；
// ③需求 7：工作台「自定义排序」合并进「基础功能列表」——自建分类直接排在列表最前（分类色
//   底色），未分类按静态三分组，末尾 ⚙ 设置入口；顶部模糊搜索（汉字子串/子序列 + 拼音首字母）。
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { aoi, doc, win } from './helpers/aoi.js';

function seedData() {
  aoi.state.data = {
    orders: [],
    activities: ['宝可梦万圣节'],
    activityMeta: {
      // cover 未设置：封面回落第一张商品参考图（画报与展开区回显都应显示它）
      '宝可梦万圣节': {
        ip: '宝可梦', status: '未开始',
        products: [{ id: 'p1', type: '挂件', model: '皮卡丘', refImage: 'https://img.example/fallback.jpg', price: 20, currency: 'JPY' }]
      }
    },
    batches: [], payments: [], notifications: [], announcements: [], reservoirs: [], cnChanges: [],
    typeMeta: {}, ipTypes: {}, addresses: {}, memberMeta: {}, ips: ['宝可梦']
  };
}

beforeEach(() => {
  win.localStorage.clear();
  seedData();
  aoi.saveTeamData = vi.fn().mockResolvedValue(undefined);
  aoi.toast = vi.fn();
  aoi.navHistory = [];
  aoi.setShell('classic');
  doc.querySelectorAll('[data-view]').forEach((el) => el.classList.add('hidden'));
});

describe('需求 5：主视图 URL 回显封面回落链', () => {
  it('meta.cover 为空时展开区输入回显首商品参考图（回落链）', () => {
    const html = aoi.orders.actExpandHtml('宝可梦万圣节', 0);
    const box = doc.createElement('div');
    box.innerHTML = html;
    const inp = box.querySelector('input[data-field="cover"]');
    expect(inp).not.toBeNull();
    expect(inp.value).toBe('https://img.example/fallback.jpg');
  });

  it('meta.cover 已设置时回显设置值优先', () => {
    aoi.state.data.activityMeta['宝可梦万圣节'].cover = 'https://img.example/cover.jpg';
    const html = aoi.orders.actExpandHtml('宝可梦万圣节', 0);
    const box = doc.createElement('div');
    box.innerHTML = html;
    expect(box.querySelector('input[data-field="cover"]').value).toBe('https://img.example/cover.jpg');
  });
});

describe('需求 6：Aoi.VIEW_BACK 视图内返回钩子', () => {
  it('未登记钩子的视图：navBack 照旧消费导航历史', () => {
    aoi.nav('view-orders');
    aoi.nav('view-settings');
    expect(aoi.navHistory).toContain('view-orders');
    aoi.navBack();
    expect(doc.querySelector('[data-view]:not(.hidden)').getAttribute('id')).toBe('view-orders');
  });

  it('钩子返回 false：落回导航历史（不吞返回）', () => {
    aoi.VIEW_BACK['view-orders'] = function () { return false; };
    aoi.nav('view-settings');
    aoi.nav('view-orders');
    aoi.navBack();
    expect(doc.querySelector('[data-view]:not(.hidden)').getAttribute('id')).toBe('view-settings');
    delete aoi.VIEW_BACK['view-orders'];
  });
});

describe('需求 7：基础功能列表合并 + 模糊搜索', () => {
  it('fuzzyMatch：子串 / 汉字子序列 / 拼音首字母（含缩写）命中', () => {
    const m = aoi.workbench.fuzzyMatch;
    expect(m('订单管理', '')).toBe(true);            // 空查询全通过
    expect(m('订单管理', '订单')).toBe(true);        // 子串
    expect(m('订单管理', '订管')).toBe(true);        // 按序子序列
    expect(m('订单管理', '管理订')).toBe(false);     // 乱序不命中
    expect(m('订单管理', 'dd', 'ddgl')).toBe(true);  // 拼音首字母命中（UI 从 data-wbpy 传入）
    expect(m('订单管理', 'ddg', 'ddgl')).toBe(true);
    expect(m('订单管理', 'dd', undefined)).toBe(false); // 未传 py 不做拉丁回退
    expect(m('PCO 目录导入', 'pco')).toBe(true);
    expect(m('订单管理', 'dd', '')).toBe(false);     // 无拼音串时不做拉丁回退（py 仅作附加haystack）
  });

  it('搜索框输入过滤列表：无命中分组整组隐藏，清空恢复；拼音首字母可命中', () => {
    aoi.workbench.enter();
    aoi.workbench.toggleBuilder();
    aoi.workbench.filterNav('订管');
    let visible = Array.from(doc.querySelectorAll('#wbBuilderItems a[data-wbnav]'))
      .filter((a) => !a.classList.contains('hidden')).map((a) => a.getAttribute('data-wbnav'));
    expect(visible).toContain('订单管理');
    expect(visible).not.toContain('计算器');
    // 无命中的分组整组隐藏（工具组全灭）
    const calcSec = Array.from(doc.querySelectorAll('#wbBuilderItems [data-wbsection]'))
      .find((s) => s.querySelector('[data-nav="view-calc"]'));
    expect(calcSec.classList.contains('hidden')).toBe(true);
    aoi.workbench.filterNav('jsq'); // 拼音首字母命中计算器
    visible = Array.from(doc.querySelectorAll('#wbBuilderItems a[data-wbnav]'))
      .filter((a) => !a.classList.contains('hidden')).map((a) => a.getAttribute('data-wbnav'));
    expect(visible).toContain('计算器');
    aoi.workbench.filterNav('');
    visible = Array.from(doc.querySelectorAll('#wbBuilderItems a[data-wbnav]'))
      .filter((a) => !a.classList.contains('hidden'));
    expect(visible.length).toBe(aoi.workbench.FEATURES.length + 1); // 全部功能 + 设置入口
  });

  it('搜索态跨重渲染保持：buildNav 后输入框回显当前关键词且过滤仍生效', () => {
    aoi.workbench.enter();
    aoi.workbench.toggleBuilder();
    aoi.workbench.filterNav('排谷');
    aoi.workbench.toggleBuilder();   // 收起
    aoi.workbench.toggleBuilder();   // 再展开（触发 buildNav）
    const inp = doc.querySelector('#wbBuilderItems [data-wbsearch]');
    expect(inp.value).toBe('排谷');
    const visible = Array.from(doc.querySelectorAll('#wbBuilderItems a[data-wbnav]'))
      .filter((a) => !a.classList.contains('hidden')).map((a) => a.getAttribute('data-wbnav'));
    expect(visible).toContain('排谷表');
    expect(visible).not.toContain('计算器');
  });

  it('设置自定义排序页（view-wbsort）仍是管理入口：归属/展示/颜色操作不受合并影响', () => {
    aoi.workbench.enter();
    aoi.workbench.addCollection('常用');
    aoi.workbench.assign('view-orders', '常用');
    aoi.nav('view-wbsort');
    expect(doc.querySelector('select[data-wbassign="view-orders"]').value).toBe('常用');
    expect(doc.querySelector('input[data-wbshow="view-orders"]').checked).toBe(true);
  });
});
