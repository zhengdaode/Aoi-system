import { describe, it, expect } from 'vitest';
import { aoi, doc } from './helpers/aoi.js';

// 构造同构于订单表的行（checkbox 携带 data-id）
function buildTable() {
  doc.body.insertAdjacentHTML('beforeend',
    '<table id="t-export-test"><thead><tr><th>行号</th><th>型号</th><th></th></tr></thead><tbody>'
    + '<tr><td>1</td><td>M1</td><td><input type="checkbox" class="row-check" data-id="a" checked></td></tr>'
    + '<tr><td>2</td><td>M2</td><td><input type="checkbox" class="row-check" data-id="b"></td></tr>'
    + '<tr><td>3</td><td>M3</td><td><input type="checkbox" class="row-check" data-id="c" checked></td></tr>'
    + '</tbody></table>');
  return doc.getElementById('t-export-test');
}

describe('导出图片行选择（v3.2.0 T5）', () => {
  it('exportSelectedIds 收集勾选行的 data-id', () => {
    const t = buildTable();
    expect(aoi.exportSelectedIds(t)).toEqual(['a', 'c']);
    t.remove();
  });

  it('exportFilterRows 仅保留选中行、表头完整；ids 为空时原样返回', () => {
    const t = buildTable();
    const clone1 = aoi.exportFilterRows(t.cloneNode(true), ['a', 'c']);
    expect(clone1.querySelectorAll('thead tr')).toHaveLength(1);
    expect(clone1.querySelectorAll('tbody tr')).toHaveLength(2);
    expect(clone1.querySelector('tbody tr td:nth-child(2)').textContent).toBe('M1');
    // 空集合原样返回（整表导出路径）
    const clone2 = aoi.exportFilterRows(t.cloneNode(true), []);
    expect(clone2.querySelectorAll('tbody tr')).toHaveLength(3);
    t.remove();
  });
});
