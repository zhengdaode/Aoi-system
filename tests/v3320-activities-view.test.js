// v3.32.0 活动管理改版测试
// ①过滤行：关键词/状态筛选 + 四种排序（创建顺序/倒序/最近修改/名称拼音），过滤只作用渲染副本；
// ②左侧 IP 分区栏：修改IP栏顺序（本机 localStorage）+ 全部/各 IP 点击筛选（含仅存在于
//   activityMeta[].ip 的 IP）；
// ③双视图：文段模式（12 列含截止日期）与画报模式（中图标一行3 / 大图标一行2），
//   画报数据派生（种类数/参与人数/截止日期/状态徽章/价格范围/所属IP）与 cover 回落链；
// ④新增活动弹窗入口 addActivity 传参（写 createdAt）+ setActivityField 写 updatedAt。
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { aoi, doc, win } from './helpers/aoi.js';

function seedData() {
  aoi.state.data = {
    orders: [
      { id: 'o1', activity: 'AHS娃再贩', type: '娃娃', model: '樱乃', count: 1, buyer: '小樱', price: 295 },
      { id: 'o2', activity: 'AHS娃再贩', type: '娃娃', model: '小春', count: 2, buyer: '小狼', price: 295 }
    ],
    activities: ['AHS娃再贩', '8.23涩谷', '宝可梦万圣节'],
    activityMeta: {
      'AHS娃再贩': {
        ip: '术力口', status: '进行中', cover: 'https://img.example/cover.jpg', deadline: '2026-11-01',
        products: [
          { id: 'p1', type: '娃娃', model: '樱乃', refImage: 'https://img.example/1.jpg', price: 295, currency: 'CNY' },
          { id: 'p2', type: '娃娃', model: '小春', refImage: '', price: 310, currency: 'CNY' }
        ],
        buyers: [{ buyer: '小樱', account: '', address: '' }]
      },
      '8.23涩谷': { ip: '终末', status: '未开始', products: [] },
      '宝可梦万圣节': {
        ip: '宝可梦', status: '已下单',
        products: [{ id: 'p3', type: '挂件', model: '皮卡丘', price: 20, currency: 'JPY' }]
      }
    },
    batches: [], payments: [], notifications: [], announcements: [], reservoirs: [], cnChanges: [],
    typeMeta: {}, ipTypes: {}, addresses: {}, memberMeta: {}, ips: ['术力口', '终末']
  };
}

beforeEach(() => {
  win.localStorage.clear();
  seedData();
  aoi.saveTeamData = vi.fn().mockResolvedValue(undefined);
  aoi.toast = vi.fn();
  aoi.orders.actIpFilter = '';
  aoi.orders.actIpSortMode = false;
  doc.getElementById('actFKeyword').value = '';
  doc.getElementById('actFStatus').value = '';
  doc.getElementById('actFSort').value = 'created';
});

describe('过滤行（v3.32.0）', () => {
  it('文段模式渲染全部活动行 + 新增截止日期列（12 列）', () => {
    aoi.orders.renderActivities();
    const rows = doc.querySelectorAll('#activityTbody tr');
    // 3 活动行（无展开行）
    expect(rows).toHaveLength(3);
    const heads = doc.querySelectorAll('#activityTable thead th');
    expect(heads).toHaveLength(12);
    expect(Array.from(heads).map((h) => h.textContent)).toContain('截止日期');
  });

  it('关键词筛选命中活动名/备注，未命中显示空态提示', () => {
    doc.getElementById('actFKeyword').value = '涩谷';
    aoi.orders.renderActivities();
    const rows = doc.querySelectorAll('#activityTbody tr');
    expect(rows).toHaveLength(1);
    expect(rows[0].textContent).toContain('8.23涩谷');
    doc.getElementById('actFKeyword').value = '不存在的活动';
    aoi.orders.renderActivities();
    expect(doc.getElementById('activityTbody').textContent).toContain('没有符合筛选条件的活动');
  });

  it('状态筛选（下拉由首次渲染填充，保留用户选中）', () => {
    aoi.orders.renderActivities();
    const sel = doc.getElementById('actFStatus');
    expect(sel.options).toHaveLength(6); // 全部状态 + 5 状态
    sel.value = '进行中';
    aoi.orders.renderActivities();
    expect(doc.querySelectorAll('#activityTbody tr')).toHaveLength(1);
    expect(doc.getElementById('activityTbody').textContent).toContain('AHS娃再贩');
    // 重渲染不重置选中
    expect(sel.value).toBe('进行中');
  });

  it('过滤与排序只作用渲染副本，不写回 d.activities 顺序', () => {
    doc.getElementById('actFKeyword').value = '涩谷';
    aoi.orders.renderActivities();
    expect(aoi.state.data.activities).toEqual(['AHS娃再贩', '8.23涩谷', '宝可梦万圣节']);
  });

  it('排序：创建倒序 / 名称拼音', () => {
    doc.getElementById('actFSort').value = 'created_desc';
    let list = aoi.orders.filteredActivities(aoi.state.data);
    expect(list).toEqual(['宝可梦万圣节', '8.23涩谷', 'AHS娃再贩']);
    doc.getElementById('actFSort').value = 'name';
    list = aoi.orders.filteredActivities(aoi.state.data);
    // 与 Intl.Collator('zh-Hans-CN') 全序一致（数字 < 中文拼音 < 拉丁）
    const coll = new Intl.Collator('zh-Hans-CN', { numeric: true });
    const expected = ['AHS娃再贩', '8.23涩谷', '宝可梦万圣节'].sort(coll.compare);
    expect(list).toEqual(expected);
  });

  it('排序：最近修改在前（updatedAt 缺失回落 createdAt，再回落数组序）', () => {
    const d = aoi.state.data;
    d.activityMeta['8.23涩谷'].updatedAt = '2026-10-30T10:00:00.000Z';
    d.activityMeta['宝可梦万圣节'].updatedAt = '2026-10-29T10:00:00.000Z';
    doc.getElementById('actFSort').value = 'updated';
    const list = aoi.orders.filteredActivities(d);
    expect(list).toEqual(['8.23涩谷', '宝可梦万圣节', 'AHS娃再贩']);
  });
});

describe('左侧 IP 分区栏（v3.32.0）', () => {
  it('渲染「修改IP栏顺序」+「全部」+ 各 IP（含仅存在于 activityMeta[].ip 的宝可梦）', () => {
    aoi.orders.renderActivities();
    const rail = doc.getElementById('actIpRail');
    expect(rail.textContent).toContain('修改IP栏顺序');
    expect(rail.textContent).toContain('全部');
    expect(rail.textContent).toContain('术力口');
    expect(rail.textContent).toContain('终末');
    expect(rail.textContent).toContain('宝可梦');
  });

  it('点击 IP 行筛选该 IP 活动，点「全部」恢复', () => {
    aoi.orders.setActIpFilter('术力口');
    expect(aoi.orders.actIpFilter).toBe('术力口');
    const rows = doc.querySelectorAll('#activityTbody tr');
    expect(rows).toHaveLength(1);
    expect(rows[0].textContent).toContain('AHS娃再贩');
    aoi.orders.setActIpFilter('');
    expect(doc.querySelectorAll('#activityTbody tr')).toHaveLength(3);
  });

  it('修改IP栏顺序：上移/下移写入本机 localStorage，未收录 IP 追加其后', () => {
    aoi.orders.moveIpOrder('终末', -1); // [终末, 术力口, 宝可梦]
    expect(aoi.orders.actIpOrder(aoi.state.data)).toEqual(['终末', '术力口', '宝可梦']);
    expect(JSON.parse(win.localStorage.getItem('aoi_act_ip_order'))).toEqual(['终末', '术力口', '宝可梦']);
    aoi.orders.moveIpOrder('终末', -1); // 已到顶不动
    expect(aoi.orders.actIpOrder(aoi.state.data)).toEqual(['终末', '术力口', '宝可梦']);
    aoi.orders.moveIpOrder('终末', 1); // 下移一位
    expect(aoi.orders.actIpOrder(aoi.state.data)).toEqual(['术力口', '终末', '宝可梦']);
  });

  it('排序模式行显示 ↑↓；退出模式恢复普通行', () => {
    aoi.orders.toggleIpSortMode();
    expect(doc.getElementById('actIpRail').querySelectorAll('button[title="上移"]').length).toBeGreaterThan(0);
    aoi.orders.toggleIpSortMode();
    expect(doc.getElementById('actIpRail').querySelector('button[title="上移"]')).toBeNull();
  });
});

describe('画报模式（v3.32.0）', () => {
  it('setActView 记忆展示方式；中图标渲染一行3容器，文段/画报复切正常', () => {
    aoi.orders.setActView('mid');
    expect(win.localStorage.getItem('aoi_activities_view')).toBe('mid');
    expect(doc.getElementById('actTextWrap').classList.contains('hidden')).toBe(true);
    expect(doc.getElementById('actCardsWrap').classList.contains('hidden')).toBe(false);
    expect(doc.getElementById('actFView').value).toBe('mid');
    expect(doc.querySelectorAll('#actCardsWrap .grid > div').length).toBe(3);
    aoi.orders.setActView('text');
    expect(doc.getElementById('actTextWrap').classList.contains('hidden')).toBe(false);
    expect(doc.getElementById('actCardsWrap').classList.contains('hidden')).toBe(true);
  });

  it('大图标/中图标容器列数类区分（一行2 / 一行3）', () => {
    aoi.orders.setActView('large');
    expect(doc.querySelector('#actCardsWrap .grid').className).toContain('sm:grid-cols-2');
    aoi.orders.setActView('mid');
    expect(doc.querySelector('#actCardsWrap .grid').className).toContain('sm:grid-cols-3');
  });

  it('画报卡片内容：标题/种类数/参与人数/截止日期/状态徽章/价格范围/所属IP', () => {
    aoi.orders.setActView('mid');
    const html = doc.getElementById('actCardsWrap').innerHTML;
    expect(html).toContain('AHS娃再贩');
    expect(html).toContain('周边 2 种');
    expect(html).toContain('参与 2 人'); // activityProductSummary 口径 = 订单去重买家（小樱/小狼）
    expect(html).toContain('预计 2026-11-01 截团');
    expect(html).toContain('进行中');
    expect(html).toContain('¥295~310');
    expect(html).toContain('术力口');
  });

  it('画报参与人数取自订单去重买家（activityProductSummary 口径）', () => {
    const sum = aoi.orders.activityProductSummary('AHS娃再贩');
    expect(sum.buyers).toBe(2); // 小樱 + 小狼
    expect(sum.count).toBe(2); // 商品主档款数
  });

  it('封面回落链：meta.cover → 第一张商品参考图 → 空（占位「暂无主视图」）', () => {
    const d = aoi.state.data;
    expect(aoi.orders.activityCover(d, 'AHS娃再贩')).toBe('https://img.example/cover.jpg');
    expect(aoi.orders.activityCover(d, '宝可梦万圣节')).toBe(''); // 无 cover、商品无 refImage
    d.activityMeta['宝可梦万圣节'].products[0].refImage = 'https://img.example/p3.jpg';
    expect(aoi.orders.activityCover(d, '宝可梦万圣节')).toBe('https://img.example/p3.jpg');
  });

  it('价格范围按币种分组（单值一个数、区间 min~max、多币种 / 连接）', () => {
    const d = aoi.state.data;
    expect(aoi.orders.priceRangeText(d, 'AHS娃再贩')).toBe('¥295~310');
    expect(aoi.orders.priceRangeText(d, '宝可梦万圣节')).toBe('JP¥20');
    d.activityMeta['宝可梦万圣节'].products.push({ id: 'p4', type: '挂件', model: '伊布', price: 35, currency: 'JPY' });
    expect(aoi.orders.priceRangeText(d, '宝可梦万圣节')).toBe('JP¥20~35');
    expect(aoi.orders.priceRangeText(d, '8.23涩谷')).toBe('');
  });
});

describe('新增活动与字段更新（v3.32.0）', () => {
  it('addActivity 传参：入列表 + 写 createdAt/updatedAt + 渲染可见 + 弹窗收起', async () => {
    doc.getElementById('actNewModal').classList.remove('hidden');
    await aoi.orders.addActivity('测试新活动', '新IP');
    const d = aoi.state.data;
    expect(d.activities).toContain('测试新活动');
    expect(d.activityMeta['测试新活动'].ip).toBe('新IP');
    expect(d.activityMeta['测试新活动'].createdAt).toBeTruthy();
    expect(d.activityMeta['测试新活动'].updatedAt).toBeTruthy();
    expect(doc.getElementById('actNewModal').classList.contains('hidden')).toBe(true);
    expect(doc.getElementById('activityTbody').textContent).toContain('测试新活动');
  });

  it('addActivity 重名拒绝（不写数据）', async () => {
    await aoi.orders.addActivity('AHS娃再贩', '');
    expect(aoi.toast).toHaveBeenCalled();
    expect(aoi.state.data.activities.filter((n) => n === 'AHS娃再贩')).toHaveLength(1);
  });

  it('setActivityField 保存 deadline 并刷新 updatedAt（最近修改排序依据）', async () => {
    const d = aoi.state.data;
    d.activityMeta['8.23涩谷'].createdAt = '2026-08-01T00:00:00.000Z';
    delete d.activityMeta['8.23涩谷'].updatedAt;
    await aoi.orders.setActivityField('8.23涩谷', 'deadline', '2026-12-01');
    expect(d.activityMeta['8.23涩谷'].deadline).toBe('2026-12-01');
    expect(d.activityMeta['8.23涩谷'].updatedAt).toBeTruthy();
  });
});
