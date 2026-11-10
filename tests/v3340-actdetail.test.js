// v3.34.0 活动详情全屏卡 + 画报卡改版测试（需求 4，实装自 demo/act-detail-demo 拍板方案）
// ①画报卡改版：「订单」按钮移除；「⋯」= 操作菜单（data-actmore，B3 pop）；左上 IP 名点击 = 按该 IP 筛选
//   （data-actip，与左侧 IP 分区栏同语义）；封面/正文整卡点击（data-openact）= 打开全屏详情卡；
// ②详情卡：≈4/5 屏（86vw×88vh），FLIP + 主视图共享元素（jsdom 无布局走即时路径），
//   商品 tab = actExpandHtml 同源（查订单/排谷表/导出/同步商品等全部展开区能力），
//   活动信息 tab = 日期/链接/备注/参与人；字段 data-activity 走与展开区同一保存链路；
// ③生命周期：Esc 先关菜单再关详情；Aoi.nav 离开页面即时关闭；详情打开时 renderActivities 同步刷新内容；
// ④⋯菜单外点/Esc 关闭；删除活动走 removeActivity 确认链路。
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { aoi, doc, win } from './helpers/aoi.js';

function seedData() {
  aoi.state.data = {
    orders: [
      { id: 'o1', activity: '宝可梦万圣节', type: '挂件', model: '皮卡丘', count: 1, buyer: '小樱', price: 20 },
      { id: 'o2', activity: '8.23涩谷', type: '徽章', model: '终末', count: 2, buyer: '小狼', price: 12 }
    ],
    activities: ['宝可梦万圣节', '8.23涩谷'],
    activityMeta: {
      '宝可梦万圣节': {
        ip: '宝可梦', status: '未开始', deadline: '2026-10-31', remark: '', buyDate: '', shipDate: '', shipDateFuzzy: '', link: '',
        cover: 'https://img.example/cover.jpg',
        products: [{ id: 'p1', type: '挂件', model: '皮卡丘', refImage: 'https://img.example/fallback.jpg', price: 20, currency: 'JPY' }],
        buyers: [{ buyer: '小樱', account: '', address: '' }], trackings: []
      },
      '8.23涩谷': { ip: '终末', status: '未开始', products: [], buyers: [], trackings: [] }
    },
    batches: [], payments: [], notifications: [], announcements: [], reservoirs: [], cnChanges: [],
    typeMeta: {}, ipTypes: {}, addresses: {}, memberMeta: {}, ips: ['宝可梦', '终末']
  };
}

beforeEach(() => {
  win.localStorage.clear();
  seedData();
  aoi.saveTeamData = vi.fn().mockResolvedValue(undefined);
  aoi.toast = vi.fn();
  aoi.navHistory = [];
  aoi.setShell('classic');
  aoi.orders.actIpFilter = '';
  doc.querySelectorAll('[data-view]').forEach((el) => el.classList.add('hidden'));
  doc.getElementById('actFKeyword').value = '';
  doc.getElementById('actFStatus').value = '';
  doc.getElementById('actFSort').value = 'created';
  // 详情卡与菜单复位
  doc.getElementById('actDetail').classList.add('hidden');
  doc.getElementById('actDetail').style.display = '';
  doc.getElementById('actDetailBackdrop').classList.add('hidden');
  doc.getElementById('actCardMenu').classList.add('hidden');
  aoi.orders.actDetail = { name: null, openTimer: null, closeTimer: null, fly: null };
});

describe('画报卡改版（v3.34.0）', () => {
  it('「订单」按钮移除；「⋯」= data-actmore；IP 名 = data-actip 按钮；封面/正文 = data-openact 整卡点击', () => {
    aoi.orders.setActView('mid');
    const html = doc.getElementById('actCardsWrap').innerHTML;
    expect(html).not.toContain('>订单</button>');            // 订单按钮已移除
    expect(html).toContain('data-actmore="宝可梦万圣节"');     // ⋯ 菜单
    expect(html).toContain('data-actip="宝可梦"');             // IP 筛选
    expect(html.match(/data-openact="宝可梦万圣节"/g).length).toBe(2); // 封面 + 正文
    expect(html).not.toContain('data-expand="宝可梦万圣节"');  // 画报卡不再内联展开
  });

  it('IP 名点击筛选：actIpFilter 切换并重渲染；再次点击取消', () => {
    aoi.orders.setActView('mid');
    doc.querySelector('#actCardsWrap [data-actip="宝可梦"]').click();
    expect(aoi.orders.actIpFilter).toBe('宝可梦');
    expect(doc.querySelectorAll('#actCardsWrap .rounded-xl').length).toBe(1);
    doc.querySelector('#actCardsWrap [data-actip="宝可梦"]').click();
    expect(aoi.orders.actIpFilter).toBe('');
    expect(doc.querySelectorAll('#actCardsWrap .rounded-xl').length).toBe(2);
  });

  it('「⋯」菜单：打开带 5 个操作项并定位；同按钮再点收起；外点/Esc 关闭；删除项走确认链路', () => {
    aoi.orders.setActView('mid');
    const btn = doc.querySelector('#actCardsWrap [data-actmore="宝可梦万圣节"]');
    btn.click();
    const menu = doc.getElementById('actCardMenu');
    expect(menu.classList.contains('hidden')).toBe(false);
    expect(menu.getAttribute('data-name')).toBe('宝可梦万圣节');
    expect(menu.querySelectorAll('button[data-cm]').length).toBe(5);
    btn.click(); // 同一按钮再点 = 收起
    expect(menu.classList.contains('hidden')).toBe(true);
    btn.click();
    doc.body.click(); // 外点关闭
    expect(menu.classList.contains('hidden')).toBe(true);
    // Esc 关闭（详情未开，菜单优先被消化）
    btn.click();
    doc.dispatchEvent(new win.KeyboardEvent('keydown', { key: 'Escape' }));
    expect(menu.classList.contains('hidden')).toBe(true);
    // 删除项 → removeActivity 确认链路（confirm 返回 false 不删除）
    aoi.confirm = vi.fn().mockResolvedValue(false);
    btn.click();
    doc.querySelector('#actCardMenu [data-cm="del"]').click();
    expect(aoi.confirm).toHaveBeenCalled();
    expect(menu.classList.contains('hidden')).toBe(true);
  });
});

describe('活动详情全屏卡（v3.34.0）', () => {  function openDetail() {
    aoi.orders.setActView('mid');
    doc.querySelector('#actCardsWrap [data-openact="宝可梦万圣节"]').click();
  }

  it('打开：面板显示 ≈4/5 屏尺寸、遮罩点亮、标题/状态/IP/截止就位且 data-activity 指向活动', () => {
    openDetail();
    const panel = doc.getElementById('actDetail');
    expect(panel.classList.contains('hidden')).toBe(false);
    expect(panel.style.display).toBe('flex');
    expect(panel.style.width).toContain('86vw');
    expect(doc.getElementById('actDetailBackdrop').classList.contains('hidden')).toBe(false);
    expect(doc.getElementById('actDetailTitle').textContent).toBe('宝可梦万圣节');
    expect(doc.getElementById('actDetailStatus').getAttribute('data-activity')).toBe('宝可梦万圣节');
    expect(doc.getElementById('actDetailIp').getAttribute('data-activity')).toBe('宝可梦万圣节');
    expect(doc.getElementById('actDetailDeadline').value).toBe('2026-10-31');
    // jsdom 无布局（getBoundingClientRect 全 0）→ 走即时路径，内容直接就绪
    expect(panel.classList.contains('act-detail-ready')).toBe(true);
  });

  it('商品 tab = 展开区同源：查订单/排谷表/同步商品等按钮与商品卡齐全，字段保存走同一链路', () => {
    openDetail();
    const body = doc.getElementById('actDetailBody');
    expect(body.textContent).toContain('查订单');
    expect(body.textContent).toContain('从订单同步商品');
    expect(body.querySelector('[data-psave="p1"]')).not.toBeNull();
    // 字段保存：改详情头状态 select → setActivityField 被调用（saveTeamData stub）
    const st = doc.getElementById('actDetailStatus');
    st.value = '进行中';
    st.dispatchEvent(new win.Event('change', { bubbles: true }));
    expect(aoi.state.data.activityMeta['宝可梦万圣节'].status).toBe('进行中');
  });

  it('活动信息 tab：日期/链接/备注/参与人字段渲染，tab 切换显隐', () => {
    openDetail();
    doc.querySelector('#actDetail .act-detail-tab[data-tab="info"]').click();
    expect(doc.getElementById('actDetailPaneProducts').style.display).toBe('none');
    expect(doc.getElementById('actDetailPaneInfo').style.display).not.toBe('none');
    const info = doc.getElementById('actDetailPaneInfo');
    expect(info.querySelector('[data-field="buyDate"]')).not.toBeNull();
    expect(info.querySelector('[data-field="remark"]')).not.toBeNull();
    expect(info.querySelector('[data-act-buyers="宝可梦万圣节"]')).not.toBeNull();
    doc.querySelector('#actDetail .act-detail-tab[data-tab="products"]').click();
    expect(doc.getElementById('actDetailPaneProducts').style.display).not.toBe('none');
  });

  it('关闭：Esc / × 按钮 / 遮罩点击均可关闭（jsdom 即时路径）', () => {
    openDetail();
    doc.dispatchEvent(new win.KeyboardEvent('keydown', { key: 'Escape' }));
    expect(doc.getElementById('actDetail').classList.contains('hidden')).toBe(true);
    expect(aoi.orders.actDetailOpen()).toBe(false);
    openDetail();
    doc.getElementById('actDetailClose').click();
    expect(doc.getElementById('actDetail').classList.contains('hidden')).toBe(true);
    openDetail();
    doc.getElementById('actDetailBackdrop').click();
    expect(doc.getElementById('actDetail').classList.contains('hidden')).toBe(true);
  });

  it('nav 离开页面即时关闭；详情打开时 renderActivities 同步刷新详情内容', () => {
    openDetail();
    // 商品卡保存后 renderActivities 被调 → 详情内容重渲染（actExpandHtml 重画）
    doc.querySelector('#actDetailBody [data-psave="p1"]').click();
    expect(doc.getElementById('actDetailBody').textContent).toContain('查订单');
    // nav 走注册表渲染，钩子即时关闭详情
    aoi.nav('view-orders');
    expect(doc.getElementById('actDetail').classList.contains('hidden')).toBe(true);
    expect(aoi.orders.actDetailOpen()).toBe(false);
  });

  it('主视图共享元素：有封面时 hero 放活动封面；无封面回落「暂无主视图」', () => {
    openDetail();
    expect(doc.querySelector('#actDetailHero img').getAttribute('src')).toBe('https://img.example/cover.jpg');
    doc.getElementById('actDetailClose').click();
    doc.querySelector('#actCardsWrap [data-openact="8.23涩谷"]').click();
    expect(doc.getElementById('actDetailHero').textContent).toContain('暂无主视图');
  });
});

describe('登录竞态防护（v3.34.0，浏览器实测发现）', () => {
  it('enterApp 置位 aoi._enteredApp=true（晚到的启动自检不再踢回登录屏）；logout 复位', async () => {
    expect(aoi._enteredApp === undefined || aoi._enteredApp === false).toBe(true);
    doc.getElementById('loginUsername').value = 'debug';
    doc.getElementById('loginPassword').value = 'debug123';
    await aoi.auth.login();
    expect(aoi._enteredApp).toBe(true);
    await aoi.auth.logout();
    expect(aoi._enteredApp).toBe(false);
  });
});
