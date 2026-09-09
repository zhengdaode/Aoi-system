import { describe, it, expect, beforeEach, vi } from 'vitest';
import { aoi, doc } from './helpers/aoi.js';

function stubSave() {
  aoi.saveTeamData = vi.fn().mockResolvedValue(undefined);
}

function setValue(id, v) {
  const el = doc.getElementById(id);
  el.value = v;
}

describe('Aoi.orders.parseEntryOrder（v1.8.0 取消自动转换的双模式）', () => {
  it('人民币：price 即输入值，无外币原价', () => {
    expect(aoi.orders.parseEntryOrder('cny', 'calc', 50, null)).toEqual({ price: 50, priceOrig: null });
  });

  it('外币 + 直接输入模式：人民币价留空（null=待生成），保留原价', () => {
    const r = aoi.orders.parseEntryOrder('jpy', 'direct', 1000, null);
    expect(r.price).toBeNull();
    expect(r.priceOrig).toBe(1000);
  });

  it('外币 + 计算器模式：外币原价与人民币价同时入库', () => {
    const r = aoi.orders.parseEntryOrder('jpy', 'calc', 1000, 60);
    expect(r.price).toBe(60);
    expect(r.priceOrig).toBe(1000);
    // 人民币未手改时回退计算器公式
    const r2 = aoi.orders.parseEntryOrder('jpy', 'calc', 100, null);
    expect(r2.price).toBe(aoi.calc.toRmb(100, 'jpy'));
    expect(r2.priceOrig).toBe(100);
  });
});

describe('Aoi.orders.addManual 多行购买者批量录入', () => {
  beforeEach(() => {
    stubSave();
    aoi.state.data = {};
    setValue('oIp', '宝可梦');
    setValue('oActivity', '活动A');
    setValue('oType', '徽章');
    setValue('oModel', '皮卡丘');
    setValue('oCount', '2');
    setValue('oBuyer', '小樱\n小狼\n');
    setValue('oPrice', '50');
    doc.getElementById('oCurrency').value = 'cny';
  });

  it('购买者多行 = 多位用户各生成一条同款订单', async () => {
    await aoi.orders.addManual();
    expect(aoi.state.data.orders).toHaveLength(2);
    expect(aoi.state.data.orders.map((o) => o.buyer).sort()).toEqual(['小樱', '小狼']);
    expect(aoi.state.data.orders[0].price).toBe(50);
  });

  it('外币直输模式：人民币价留空、原价入库', async () => {
    doc.getElementById('oCurrency').value = 'jpy';
    doc.getElementById('oPriceModes').classList.remove('hidden');
    doc.querySelector('input[name="oPriceMode"][value="direct"]').checked = true;
    setValue('oPrice', '1000');
    await aoi.orders.addManual();
    const o = aoi.state.data.orders[0];
    expect(o.price).toBeNull();
    expect(o.priceOrig).toBe(1000);
    expect(o.currency).toBe('jpy');
  });

  it('购买者全为空行时不入库', async () => {
    setValue('oBuyer', '  \n\n ');
    await aoi.orders.addManual();
    expect(aoi.state.data.orders || []).toHaveLength(0);
  });
});

describe('Aoi.orders 订单管理：渲染 / 批量生成 / 编辑（v1.8.0）', () => {
  function seed() {
    aoi.state.data = {
      orders: [
        { id: 'o1', activity: 'A', type: '徽章', model: 'M1', price: 10, count: 2, buyer: '小樱', currency: 'cny', remark: '测试备注', status: '未到货', batchId: null },
        { id: 'o2', activity: 'A', type: '色纸', model: 'M2', price: null, priceOrig: 1000, currency: 'jpy', remark: '', status: '未到货', batchId: null, buyer: '小狼' }
      ],
      batches: []
    };
  }

  beforeEach(() => {
    stubSave();
    seed();
  });

  it('priceText/origText：待生成占位与外币符号', () => {
    const o1 = aoi.state.data.orders[0], o2 = aoi.state.data.orders[1];
    expect(aoi.orders.priceText(o2)).toContain('待生成');
    expect(aoi.orders.priceText(o1)).toBe('10.00');
    expect(aoi.orders.origText(o1)).toBe('—');
    expect(aoi.orders.origText(o2)).toBe('JP¥1000');
    const o3 = Object.assign({}, o2, { currency: 'krw' });
    expect(aoi.orders.origText(o3)).toContain('₩');
  });

  it('render：待生成价、外币原价、备注列与统计', () => {
    aoi.orders.render();
    const html = doc.getElementById('orderTbody').innerHTML;
    expect(html).toContain('待生成');
    expect(html).toContain('JP¥1000');
    expect(html).toContain('测试备注');
    expect(html).toContain('data-edit="o1"');
    expect(doc.getElementById('orderStat').textContent).toContain('待生成');
  });

  it('applyGenRmb：按公式回填人民币价并计入 undo', async () => {
    aoi.orders.render();
    doc.querySelector('.row-check[data-id="o2"]').checked = true;
    aoi.orders.showGenRmb();
    setValue('genRate', '0.05');
    setValue('genMarkup', '0.01');
    await aoi.orders.applyGenRmb();
    const o2 = aoi.state.data.orders[1];
    expect(o2.price).toBe(aoi.calc.roundHalf(1000 * 0.06));
    expect(aoi.undo.snapshot).not.toBeNull(); // 可撤销
  });

  it('applyGenRmb 对人民币订单不改动', async () => {
    aoi.orders.render();
    doc.querySelector('.row-check[data-id="o1"]').checked = true;
    aoi.orders.showGenRmb();
    await aoi.orders.applyGenRmb();
    expect(aoi.state.data.orders[0].price).toBe(10);
  });

  it('openEdit / saveEdit：编辑字段与备注写回', async () => {
    aoi.orders.openEdit('o1');
    setValue('eModel', 'M1改');
    setValue('eRemark', '新备注');
    setValue('ePrice', '12.5');
    await aoi.orders.saveEdit();
    const o1 = aoi.state.data.orders[0];
    expect(o1.model).toBe('M1改');
    expect(o1.remark).toBe('新备注');
    expect(o1.price).toBe(12.5);
  });

  it('saveEdit：人民币价清空 → 待生成（null）', async () => {
    aoi.orders.openEdit('o1');
    setValue('ePrice', '');
    await aoi.orders.saveEdit();
    expect(aoi.state.data.orders[0].price).toBeNull();
  });
});

describe('Aoi.orders.previewRmb 回归（迭代1：周边表单引用曾被误删）', () => {
  beforeEach(() => {
    aoi.state.data = { calc: { jpyRate: 0.05, jpyMarkup: 0.01 } };
  });

  it('周边表单引用的 previewRmb 存在且写入预览元素', () => {
    expect(typeof aoi.orders.previewRmb).toBe('function');
    setValue('pPrice', '100');
    doc.getElementById('pCurrency').value = 'jpy';
    aoi.orders.previewRmb('pPrice', 'pCurrency', 'pPricePreview');
    // 100 × 0.06 = 6
    expect(doc.getElementById('pPricePreview').textContent).toBe('= ¥6.00');
  });

  it('空输入时预览清空、不报错', () => {
    setValue('pPrice', '');
    expect(() => aoi.orders.previewRmb('pPrice', 'pCurrency', 'pPricePreview')).not.toThrow();
    expect(doc.getElementById('pPricePreview').textContent).toBe('');
  });
});

describe('Aoi.orders.quickAddType 类型面板快捷新建（v1.8.0）', () => {
  beforeEach(() => {
    stubSave();
    aoi.state.data = {};
  });

  it('新建类型并回填到录入框', async () => {
    setValue('oTypeNewName', '透卡');
    await aoi.orders.quickAddType('oType');
    expect(aoi.state.data.typeMeta['透卡']).toBeDefined();
    expect(doc.getElementById('oType').value).toBe('透卡');
  });

  it('已存在的类型直接选用，不重复创建', async () => {
    aoi.state.data.typeMeta = { '透卡': { route: '常规二次元线路' } };
    setValue('oTypeNewName', '透卡');
    await aoi.orders.quickAddType('oType');
    expect(aoi.state.data.typeMeta['透卡'].route).toBe('常规二次元线路');
    expect(doc.getElementById('oType').value).toBe('透卡');
  });
});

describe('活动购买人搜索下拉与地址回填（v3.2.0 T3）', () => {
  const d = {
    orders: [{ buyer: '小明' }, { buyer: '小红' }, { buyer: '小明' }],
    memberMeta: { 小刚: { qq: '123' } },
    addresses: { 小明: '广东省珠海市香洲区某某路1号' },
    activityMeta: {
      团A: { buyers: [{ buyer: '小樱', account: 'a@x.com', address: '' }] },
      团B: { buyers: [{ buyer: '', account: 'b@x.com', address: '' }, { buyer: '小明', account: 'a@x.com', address: '' }] }
    }
  };

  it('buyerCandidates 仅取既有购买人（v3.7.0 S3：不再合并订单 CN/团员圈名）', () => {
    expect(aoi.orders.buyerCandidates(d)).toEqual(['小明', '小樱']);
  });

  it('accountCandidates 收集全站既有购买账号并去重', () => {
    expect(aoi.orders.accountCandidates(d)).toEqual(['a@x.com', 'b@x.com']);
  });

  it('addressFor 取团员端提交过的地址', () => {
    expect(aoi.orders.addressFor(d, '小明')).toBe('广东省珠海市香洲区某某路1号');
    expect(aoi.orders.addressFor(d, '小刚')).toBe('');
    expect(aoi.orders.addressFor(d, '')).toBe('');
  });

  it('圈名输入后自动带出地址；已手填地址不覆盖', () => {
    aoi.state.data = d;
    doc.getElementById('actBuyerRows').innerHTML =
      aoi.orders.buyerRowHtml({}) + aoi.orders.buyerRowHtml({ address: '已有地址' });
    const rows = doc.querySelectorAll('#actBuyerRows .act-buyer-row');
    const in1 = rows[0].querySelector('.ab-buyer');
    in1.value = '小明';
    aoi.orders.autofillBuyerAddress(in1);
    expect(rows[0].querySelector('.ab-address').value).toBe('广东省珠海市香洲区某某路1号');
    const in2 = rows[1].querySelector('.ab-buyer');
    in2.value = '小明';
    aoi.orders.autofillBuyerAddress(in2);
    expect(rows[1].querySelector('.ab-address').value).toBe('已有地址');
  });
});
