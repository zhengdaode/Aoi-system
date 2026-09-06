import { describe, it, expect } from 'vitest';
import { aoi } from './helpers/aoi.js';

// 本站「下载表格」导出的 orderTable 表头（一行一订单，见 index.html:448-455 / orders.js:433-452）
const SITE_HEADER = [
  '行号', '', '活动', '制品类型', '型号', '单价(¥)', '外币原价', '数量', '购买者', '备注', '到货状态', '到货批次', '小计', '操作'
];

describe('Aoi.import.parseRecords 记录式表格解析（v3.2.0 T1）', () => {
  it('识别本站导出表：解析业务列、剥离 UI 噪声列', () => {
    const rows = [
      SITE_HEADER,
      ['1', '', '2026春团', '吧唧', '初音01', '45', 'JP¥1,200', '2', '小明', '加急', '未到货', '', '90', '编辑'],
      ['2', '', '2026春团', '立牌', '初音02', '60', '—', '1', '小红', '', '未到货', '', '60', '编辑'],
      ['3', '', '2026春团', '色纸', '初音03', '30', '₩9,000', '1', '小刚', '', '未到货', '', '30', '编辑']
    ];
    const recs = aoi.import.parseRecords(rows, '文件名批次');
    expect(recs).toHaveLength(3);
    expect(recs[0]).toMatchObject({
      activity: '2026春团', type: '吧唧', model: '初音01', price: 45,
      priceOrig: 1200, currency: 'jpy', count: 2, buyer: '小明', remark: '加急'
    });
    // 外币原价为 — → null / 人民币
    expect(recs[1].priceOrig).toBeNull();
    expect(recs[1].currency).toBe('cny');
    expect(recs[1].remark).toBe('');
    // 韩元前缀识别
    expect(recs[2]).toMatchObject({ priceOrig: 9000, currency: 'krw' });
    // UI 噪声列不污染业务字段
    recs.forEach((r) => {
      expect(r.type).not.toBe('编辑');
      expect(String(r.buyer)).not.toMatch(/编辑|到货/);
    });
  });

  it('无活动列时回退文件名批次；数量缺失/非法时按 1', () => {
    const rows = [
      ['型号', '单价(¥)', '购买者'],
      ['初音01', '45', '小明'],
      ['初音02', '60', '']
    ];
    const recs = aoi.import.parseRecords(rows, '【7月团】');
    expect(recs).toHaveLength(1);
    expect(recs[0]).toMatchObject({ activity: '【7月团】', model: '初音01', price: 45, count: 1, buyer: '小明' });
  });

  it('跳过汇总行与非购买者行', () => {
    const rows = [
      SITE_HEADER,
      ['1', '', '团A', '吧唧', 'M1', '45', '—', '1', '小明', '', '', '', '45', '编辑'],
      ['', '', '', '', '总数', '', '', '3', '', '', '', '', '135', ''],
      ['', '', '', '', '总金额', '', '', '', '', '', '', '', '135', '']
    ];
    const recs = aoi.import.parseRecords(rows, 'x');
    expect(recs).toHaveLength(1);
    expect(recs[0].buyer).toBe('小明');
  });

  it('表头在前 5 行内才识别（避免误判正文）', () => {
    const rows = [[], [], [], [], ['型号', '单价', '购买者'], ['M1', '10', '小明']];
    expect(aoi.import.parseRecords(rows, 'x')).toHaveLength(1);
    // 表头在第 6 行及以后 → 不识别
    const late = [[], [], [], [], [], ['型号', '单价', '购买者'], ['M1', '10', '小明']];
    expect(aoi.import.parseRecords(late, 'x')).toHaveLength(0);
  });
});

describe('Aoi.import 矩阵式旧格式回归（v3.2.0 不回退）', () => {
  // 矩阵格式：表头行（制品名占列头）在「单价行」上一行，买家填制品列
  const MATRIX_ROWS = [
    ['【2026夏团】'],
    ['款式', '吧唧'],
    ['单价', '45'],
    ['', '小明'],
    ['', '小红']
  ];

  it('外部排谷表（明细型）仍走 parseMatrix 正常解析', () => {
    const m = aoi.import.parseMatrix(MATRIX_ROWS, 'x');
    expect(m).toHaveLength(2);
    expect(m[0]).toMatchObject({ model: '吧唧', price: 45, buyer: '小明', activity: '2026夏团' });
    // 记录式不得把矩阵表误判成记录表（款式列在矩阵表为空，无 model 值即跳过）
    const recs = aoi.import.parseRecords(MATRIX_ROWS, 'x');
    expect(recs.every((r) => r.activity === '2026夏团')).toBe(true);
  });

  it('parse 对矩阵格式产出与 parseMatrix 一致（回退顺序不改变旧结果）', () => {
    const rows = [['【2026夏团】'], ['款式', '吧唧'], ['单价', '45'], ['', '小明']];
    // parse 需要 XLSX（测试环境未加载 CDN），此处直接验证矩阵式解析行为本身
    const m = aoi.import.parseMatrix(rows, 'x');
    expect(m).toHaveLength(1);
    expect(m[0]).toMatchObject({ model: '吧唧', price: 45, buyer: '小明', activity: '2026夏团' });
  });
});
