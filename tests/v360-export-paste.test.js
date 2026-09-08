import { describe, it, expect, beforeEach, vi } from 'vitest';
import { aoi, win, doc } from './helpers/aoi.js';

// v3.6.0 S5：导出文件名 = 活动名-表格类型（活动来自 data-activity-from 指向的下拉）
describe('Aoi.exportBaseName 导出文件名（v3.6.0 S5）', () => {
  beforeEach(() => {
    doc.getElementById('fActivity').innerHTML = '<option value="2026春团">2026春团</option>';
    doc.getElementById('fActivity').value = '';
  });

  function btn(attrs) {
    const b = doc.createElement('button');
    Object.keys(attrs).forEach((k) => b.setAttribute(k, attrs[k]));
    doc.body.appendChild(b);
    return b;
  }

  it('无 data-activity-from：维持 data-name 原名', () => {
    const b = btn({ 'data-name': '订单管理' });
    expect(aoi.exportBaseName(b)).toBe('订单管理');
    b.remove();
  });

  it('有 data-activity-from 且活动已选：活动名-表格类型', () => {
    doc.getElementById('fActivity').value = '2026春团';
    const b = btn({ 'data-name': '订单管理', 'data-activity-from': 'fActivity' });
    expect(aoi.exportBaseName(b)).toBe('2026春团-订单管理');
    b.remove();
  });

  it('下拉为空 / 元素不存在：回落原名', () => {
    const b1 = btn({ 'data-name': '订单管理', 'data-activity-from': 'fActivity' });
    expect(aoi.exportBaseName(b1)).toBe('订单管理');
    b1.remove();
    const b2 = btn({ 'data-name': '限购购买计划', 'data-activity-from': 'notExist' });
    expect(aoi.exportBaseName(b2)).toBe('限购购买计划');
    b2.remove();
  });

  it('活动名含非法文件名字符：替换为 -', () => {
    doc.getElementById('fActivity').innerHTML = '<option value="A/B:C*D?E&quot;F&lt;G&gt;H|I"></option>';
    doc.getElementById('fActivity').value = 'A/B:C*D?E"F<G>H|I';
    const b = btn({ 'data-name': '订单管理', 'data-activity-from': 'fActivity' });
    expect(aoi.exportBaseName(b)).toBe('A-B-C-D-E-F-G-H-I-订单管理');
    b.remove();
  });

  it('tableExport 接线：writeFile 收到 活动名-表格类型.xlsx', () => {
    doc.getElementById('fActivity').innerHTML = '<option value="CP27">CP27</option>';
    doc.getElementById('fActivity').value = 'CP27';
    const writeFile = vi.fn();
    win.XLSX = { utils: { table_to_book: vi.fn(() => ({ SheetNames: [] })) }, writeFile };
    const b = btn({ 'data-table': 'orderTable', 'data-name': '订单管理', 'data-activity-from': 'fActivity' });
    aoi.tableExport(b);
    expect(writeFile.mock.calls[0][1]).toBe('CP27-订单管理.xlsx');
    b.remove();
    delete win.XLSX;
  });

  it('页面上的订单/限购结果导出按钮已接线 data-activity-from', () => {
    const orderBtns = [...doc.querySelectorAll('button[data-table="orderTable"]')];
    expect(orderBtns.length).toBeGreaterThan(0);
    orderBtns.forEach((b) => expect(b.getAttribute('data-activity-from')).toBe('fActivity'));
    const limBtns = [...doc.querySelectorAll('button[data-table="limResultTable"]')];
    expect(limBtns.length).toBeGreaterThan(0);
    limBtns.forEach((b) => expect(b.getAttribute('data-activity-from')).toBe('limActivity'));
  });
});
