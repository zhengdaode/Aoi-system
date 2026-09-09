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

// v3.6.1：统一「添加图片」弹窗——粘贴/上传/链接三合一；弹窗打开时任意位置粘贴均可捕获
describe('Aoi.img 图片选择弹窗（v3.6.1）', () => {
  function ensureTarget() {
    let el = doc.getElementById('pickTargetTest');
    if (!el) {
      el = doc.createElement('input');
      el.id = 'pickTargetTest';
      doc.body.appendChild(el);
    }
    el.value = '';
    return el;
  }
  function pasteEvent(items) {
    const ev = new win.Event('paste', { bubbles: true, cancelable: true });
    Object.defineProperty(ev, 'clipboardData', { value: { items } });
    return ev;
  }

  it('openPicker 打开弹窗：确认禁用、目标记录；closePicker 复位', () => {
    ensureTarget();
    aoi.img.openPicker('pickTargetTest');
    expect(doc.getElementById('imgPickerModal').classList.contains('hidden')).toBe(false);
    expect(aoi.img.pickerTarget).toBe('pickTargetTest');
    expect(doc.getElementById('imgPickerConfirm').disabled).toBe(true);
    aoi.img.closePicker();
    expect(doc.getElementById('imgPickerModal').classList.contains('hidden')).toBe(true);
    expect(aoi.img.pickerTarget).toBeNull();
  });

  it('链接方式：合法 https 链接启用确认，confirmPicker 回填目标输入框', () => {
    ensureTarget();
    aoi.img.openPicker('pickTargetTest');
    aoi.img.applyPickedUrl('https://img.example/x.jpg');
    expect(doc.getElementById('imgPickerConfirm').disabled).toBe(false);
    expect(doc.getElementById('imgPickerPreview').classList.contains('hidden')).toBe(false);
    aoi.img.confirmPicker();
    expect(doc.getElementById('pickTargetTest').value).toBe('https://img.example/x.jpg');
    expect(doc.getElementById('imgPickerModal').classList.contains('hidden')).toBe(true);
  });

  it('非法链接（非 http/s）确认保持禁用且 confirm 不回填', () => {
    ensureTarget();
    aoi.img.openPicker('pickTargetTest');
    expect(aoi.img.applyPickedUrl('javascript:alert(1)')).toBe(false);
    expect(doc.getElementById('imgPickerConfirm').disabled).toBe(true);
    aoi.img.confirmPicker();
    expect(doc.getElementById('pickTargetTest').value).toBe('');
    aoi.img.closePicker();
  });

  it('弹窗打开时页面任意位置粘贴图片均可捕获（无需焦点在输入框）——核心 bug 修复', async () => {
    ensureTarget();
    aoi.img.openPicker('pickTargetTest');
    aoi.img.upload = vi.fn().mockResolvedValue('https://img.example/pasted.jpg');
    doc.body.dispatchEvent(pasteEvent([{ type: 'image/png', getAsFile: () => ({ name: 'clip.png' }) }]));
    await new Promise((r) => setTimeout(r, 0));
    expect(aoi.img.upload).toHaveBeenCalled();
    expect(doc.getElementById('imgUrlInput').value).toBe('https://img.example/pasted.jpg');
    expect(doc.getElementById('imgPickerConfirm').disabled).toBe(false);
    aoi.img.confirmPicker();
    expect(doc.getElementById('pickTargetTest').value).toBe('https://img.example/pasted.jpg');
  });

  it('pickerUpload 直接上传路径：成功后回填弹窗输入框并启用确认', async () => {
    ensureTarget();
    aoi.img.openPicker('pickTargetTest');
    aoi.img.upload = vi.fn().mockResolvedValue('https://img.example/file.jpg');
    aoi.img.pickerUpload({ name: 'f.jpg' });
    await new Promise((r) => setTimeout(r, 0));
    expect(doc.getElementById('imgUrlInput').value).toBe('https://img.example/file.jpg');
    expect(doc.getElementById('imgPickerConfirm').disabled).toBe(false);
    aoi.img.closePicker();
  });

  it('活动商品展开区与团员凭证行的图片入口已换成「图片…」按钮', () => {
    // 活动商品展开区新增表单（v3.7.0 S2：展开区取代弹窗，行内表单 id 带序号后缀）
    aoi.state.data = { activities: ['CP27'], activityMeta: { CP27: { products: [] } }, orders: [], batches: [], payments: [] };
    aoi.orders.toggleActivityExpand('CP27');
    const apBtn = [...doc.querySelectorAll('#activityTbody button')].find((b) => (b.getAttribute('onclick') || '').indexOf("Aoi.img.openPicker('apNewImage_0')") >= 0);
    expect(apBtn).not.toBeUndefined();
    // 团员端渲染凭证行后出现 data-imgpicker 按钮
    aoi.state.data = {
      activities: [], batches: [{ id: 'b1', date: '2026-09-01' }], orders: [
        { id: 'o1', activity: 'A', type: '吧唧', model: 'M', price: 10, currency: 'cny', count: 1, buyer: '小樱', status: '已到货', batchId: 'b1' }
      ],
      payments: []
    };
    aoi.member.state.cn = '小樱';
    aoi.member.state.teamName = '测试团';
    aoi.member.renderFees('小樱');
    expect(doc.querySelector('#memberFeeTbody button[data-imgpicker="receipt_b1"]')).not.toBeNull();
  });
});
