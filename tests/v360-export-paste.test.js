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

// v3.6.0 S4：焦点在 data-img-paste 输入框内 Ctrl+V 粘贴图片 → 压缩上传 → URL 回填
describe('Aoi.img.bindPaste 粘贴上传（v3.6.0 S4）', () => {
  function pasteEvent(items) {
    const ev = new win.Event('paste', { bubbles: true, cancelable: true });
    Object.defineProperty(ev, 'clipboardData', { value: { items } });
    return ev;
  }

  it('粘贴图片：调用 upload 并把 URL 回填输入框', async () => {
    const input = doc.createElement('input');
    input.setAttribute('data-img-paste', '');
    doc.body.appendChild(input);
    const file = { name: 'clip.png', type: 'image/png' };
    aoi.img.upload = vi.fn().mockResolvedValue('https://img.example/abc.jpg');
    input.dispatchEvent(pasteEvent([{ type: 'image/png', getAsFile: () => file }]));
    await new Promise((r) => setTimeout(r, 0));
    expect(aoi.img.upload).toHaveBeenCalledWith(file);
    expect(input.value).toBe('https://img.example/abc.jpg');
    input.remove();
  });

  it('上传失败：输入框不被误填', async () => {
    const input = doc.createElement('input');
    input.setAttribute('data-img-paste', '');
    doc.body.appendChild(input);
    aoi.img.upload = vi.fn().mockRejectedValue(new Error('无法连接图床'));
    input.dispatchEvent(pasteEvent([{ type: 'image/jpeg', getAsFile: () => ({ name: 'x.jpg' }) }]));
    await new Promise((r) => setTimeout(r, 0));
    expect(input.value).toBe('');
    input.remove();
  });

  it('无 data-img-paste 的输入框 / 剪贴板无图片：不触发上传', async () => {
    const plain = doc.createElement('input');
    doc.body.appendChild(plain);
    aoi.img.upload = vi.fn();
    plain.dispatchEvent(pasteEvent([{ type: 'image/png', getAsFile: () => ({ name: 'x.png' }) }]));
    await new Promise((r) => setTimeout(r, 0));
    const marked = doc.createElement('input');
    marked.setAttribute('data-img-paste', '');
    doc.body.appendChild(marked);
    marked.dispatchEvent(pasteEvent([{ type: 'text/plain', getAsFile: () => null }]));
    await new Promise((r) => setTimeout(r, 0));
    expect(aoi.img.upload).not.toHaveBeenCalled();
    plain.remove();
    marked.remove();
  });

  it('页面既有图片输入框已标记 data-img-paste（二维码/收款码/合照）', () => {
    ['botQrUrl', 'whQr', 'shipPhoto'].forEach((id) => {
      const el = doc.getElementById(id);
      expect(el).not.toBeNull();
      expect(el.hasAttribute('data-img-paste')).toBe(true);
    });
  });
});
