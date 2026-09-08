import { describe, it, expect } from 'vitest';
import { aoi, win } from './helpers/aoi.js';

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

// —— 链接导入（v3.5.0）：zwlhome 分享直链的真实结构 + 拉取通道回退 ——

// 取样自 2026-09-08 static.zwlhome.com 排谷表（明细型矩阵：分类/谷子/单价 行，买家名填格）
const PAIGU_ROWS = [
  ['【宝可梦万圣节】排表详情，制表时间：2026-09-08 23:22:46'],
  ['分类', '默认分类'],
  ['谷子', '阿罗拉雷丘松软煎饼风收纳包', '亚克力钥匙扣（盲抽）【共7款】', '索罗亚挂件玩偶', '霜奶仙挂件玩偶'],
  ['单价', '107.00', '42.50', '96.00', '96.00'],
  ['1.0', 'sunshine', '', 'yu🐳', 'Fq1An'],
  ['2.0', 'pupu', '', '一枚小混子', ''],
  ['3.0', '', '', '拿拿', '']
];

// 取样自同日汇总表（汇总型矩阵：昵称/总数 买家列 + 总金额 汇总行，数量格为数字）
const HUIZONG_ROWS = [
  ['【宝可梦万圣节】汇总详情，制表时间：2026-09-08 23:27:56'],
  ['', '分类', '默认分类'],
  ['', '种类', '阿罗拉雷丘松软煎饼风收纳包', '亚克力钥匙扣（盲抽）【共7款】', '索罗亚挂件玩偶'],
  ['', '单价', '107.00', '42.50', '96.00'],
  ['总金额', '昵称/总数', '2.0', '0.0', '1.0'],
  ['822.0', '冬藏', '', '', '1.0'],
  ['672.5', 'pupu', '1.0', '', '1.0'],
  ['459.0', 'sunshine', '1.0', '', '']
];

describe('Aoi.import.parseMatrix zwlhome 直链格式（v3.5.0）', () => {
  it('排谷表（明细型）：逐格买家出单，团期/分类/单价正确，序号列不误收', () => {
    const m = aoi.import.parseMatrix(PAIGU_ROWS, 'paigubiao_257478');
    expect(m).toHaveLength(6);
    expect(m[0]).toMatchObject({
      activity: '宝可梦万圣节', type: '默认分类',
      model: '阿罗拉雷丘松软煎饼风收纳包', price: 107, count: 1, buyer: 'sunshine'
    });
    expect(m.map((r) => r.buyer)).toEqual(['sunshine', 'yu🐳', 'Fq1An', 'pupu', '一枚小混子', '拿拿']);
    // 首列序号（1.0/2.0…）既不是制品也不是买家
    expect(m.every((r) => r.model !== '1.0' && r.buyer !== '1.0')).toBe(true);
  });

  it('汇总表（汇总型）：买家列 + 数量出单，昵称/总数与总金额行不污染', () => {
    const m = aoi.import.parseMatrix(HUIZONG_ROWS, 'huizongbiao_257478');
    expect(m).toHaveLength(4);
    expect(m[0]).toMatchObject({ activity: '宝可梦万圣节', type: '默认分类', buyer: '冬藏', model: '索罗亚挂件玩偶', price: 96 });
    expect(m[1]).toMatchObject({ buyer: 'pupu', model: '阿罗拉雷丘松软煎饼风收纳包', price: 107 });
    expect(m[2]).toMatchObject({ buyer: 'pupu', model: '索罗亚挂件玩偶' });
    expect(m.every((r) => !/昵称|总数|总金额/.test(r.buyer))).toBe(true);
    // 0.0 格不出单：pupu 只解析出 2 条（收纳包 + 挂件），亚克力钥匙扣=0.0 跳过
    expect(m.filter((r) => r.buyer === 'pupu')).toHaveLength(2);
  });
});

describe('Aoi.import 链接拉取（v3.5.0）', () => {
  const LINK = 'https://static.zwlhome.com/appMedia/paigubiao_257478_20260908232246087969.xlsx';
  const PROXIED = '/media-proxy/static.zwlhome.com/appMedia/paigubiao_257478_20260908232246087969.xlsx';

  it('mapProxyUrl：白名单主机映射同源代理，其余主机/非法串返回 null', () => {
    expect(aoi.import.mapProxyUrl(LINK)).toBe(PROXIED);
    expect(aoi.import.mapProxyUrl('http://static.zwlhome.com/appMedia/a.xlsx')).toBe('/media-proxy/static.zwlhome.com/appMedia/a.xlsx');
    expect(aoi.import.mapProxyUrl('https://evil.example.com/appMedia/a.xlsx')).toBeNull();
    expect(aoi.import.mapProxyUrl('不是链接')).toBeNull();
  });

  it('fileNameFromUrl：取末段、去查询串、空段兜底', () => {
    expect(aoi.import.fileNameFromUrl(LINK + '?t=1')).toBe('paigubiao_257478_20260908232246087969.xlsx');
    expect(aoi.import.fileNameFromUrl('https://static.zwlhome.com/appMedia/')).toBe('链接导入.xlsx');
  });

  it('fetchFromUrl：白名单主机先走同源代理通道', async () => {
    const calls = [];
    win.fetch = async (u) => {
      calls.push(String(u));
      return { ok: true, headers: { get: () => 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }, arrayBuffer: async () => new ArrayBuffer(8) };
    };
    try {
      const got = await aoi.import.fetchFromUrl(LINK);
      expect(got.via).toBe('proxy');
      expect(calls).toEqual([PROXIED]);
      expect(got.fileName).toBe('paigubiao_257478_20260908232246087969.xlsx');
      expect(got.buffer.byteLength).toBe(8);
    } finally { delete win.fetch; }
  });

  it('fetchFromUrl：代理返回 HTML 回退页（未部署）→ 直连兜底', async () => {
    const calls = [];
    win.fetch = async (u) => {
      calls.push(String(u));
      const html = String(u).indexOf('/media-proxy/') === 0;
      return { ok: true, headers: { get: () => (html ? 'text/html' : 'application/octet-stream') }, arrayBuffer: async () => new ArrayBuffer(8) };
    };
    try {
      const got = await aoi.import.fetchFromUrl(LINK);
      expect(got.via).toBe('direct');
      expect(calls).toHaveLength(2);
      expect(calls[0]).toBe(PROXIED);
      expect(calls[1]).toBe(LINK);
    } finally { delete win.fetch; }
  });

  it('fetchFromUrl：全部通道失败 → error 引导手动导入；非 http(s) 链接直接拒绝', async () => {
    win.fetch = async () => { throw new TypeError('Failed to fetch'); };
    try {
      const got = await aoi.import.fetchFromUrl(LINK);
      expect(got.error).toMatch(/无法从该链接拉取/);
    } finally { delete win.fetch; }
    const bad = await aoi.import.fetchFromUrl('ftp://x');
    expect(bad.error).toMatch(/http/);
  });
});
