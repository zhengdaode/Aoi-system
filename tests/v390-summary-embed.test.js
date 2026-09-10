import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { aoi, win } from './helpers/aoi.js';

// v3.9.0：汇总表导出升级——参考图内嵌（fetch→base64，exceljs 通道）+ 链接绝对化可点击（两渲染通道）

const cell = (sh, r, c) => (sh.rows[r] && sh.rows[r][c]) || null;
const val = (sh, r, c) => { const x = cell(sh, r, c); return x ? x.v : undefined; };

function fixture() {
  return {
    activities: ['CP27'],
    activityMeta: {
      CP27: {
        link: 'https://shop.example/cp27',
        products: [
          { id: 'p1', type: '吧唧', model: 'M1', refImage: '//img.example/m1.jpg', refUrl: '/products/jan1.html', price: 10 },
          { id: 'p2', type: '立牌', model: 'L1', refImage: '', refUrl: 'https://shop.example/p/2' }
        ],
        buyers: []
      }
    },
    orders: [
      { id: 'o1', activity: 'CP27', type: '吧唧', model: 'M1', price: 10, currency: 'cny', count: 2, buyer: '小狼', status: '未到货', batchId: null }
    ],
    limitPlans: {}
  };
}

describe('汇总表：链接绝对化 + 内嵌图描述符（v3.9.0 buildWorkbook）', () => {
  it('absUrl：相对/协议相对/缺协议链接绝对化，data: 与绝对链接原样', () => {
    const abs = aoi.exportSummary.absUrl;
    expect(abs('')).toBe('');
    expect(abs('//img.example/m1.jpg')).toBe('https://img.example/m1.jpg');
    expect(abs('/products/jan1.html')).toBe('https://www.pokemoncenter-online.com/products/jan1.html');
    expect(abs('img.example/a.png')).toBe('https://img.example/a.png');
    expect(abs('https://a.b/c?d=1')).toBe('https://a.b/c?d=1');
    expect(abs('data:image/png;base64,AAA')).toBe('data:image/png;base64,AAA');
  });

  it('cellAddr：0 基行列 → Excel 地址', () => {
    expect(aoi.exportSummary.cellAddr(0, 0)).toBe('A1');
    expect(aoi.exportSummary.cellAddr(2, 4)).toBe('E3');
    expect(aoi.exportSummary.cellAddr(1, 26)).toBe('AA2');
  });

  it('采购表参考图单元格：s.img + s.link 均为绝对地址，行高加到 90pt', () => {
    const pc = aoi.exportSummary.buildWorkbook(fixture(), null).sheets[0];
    expect(val(pc, 2, 4)).toBe('图片链接');
    expect(cell(pc, 2, 4).s.img).toBe('https://img.example/m1.jpg');
    expect(cell(pc, 2, 4).s.link).toBe('https://img.example/m1.jpg');
    expect(pc.rowHeights[2]).toBe(90);
    expect(cell(pc, 2, 5)).toBeNull();            // 无参考图的商品不占格
    // 跳转商品链接：相对链接绝对化后写 s.link（可点击直达）
    expect(cell(pc, 6, 4).s.link).toBe('https://www.pokemoncenter-online.com/products/jan1.html');
    expect(cell(pc, 6, 5).s.link).toBe('https://shop.example/p/2');
  });

  it('每活动汇总参考图行同样内嵌 + 加高', () => {
    const desc = aoi.exportSummary.buildWorkbook(fixture(), null);
    const sh = desc.sheets.find((s) => s.name === '【CP27】汇总');
    expect(cell(sh, 1, 2).s.img).toBe('https://img.example/m1.jpg');
    expect(sh.rowHeights[1]).toBe(90);
  });

  it('collectImageCells：汇总全部内嵌图单元格（sheet/行/列定位）', () => {
    const desc = aoi.exportSummary.buildWorkbook(fixture(), null);
    const jobs = aoi.exportSummary.collectImageCells(desc);
    expect(jobs).toEqual([
      { si: 0, ri: 2, ci: 4, url: 'https://img.example/m1.jpg' },
      { si: 1, ri: 1, ci: 2, url: 'https://img.example/m1.jpg' }
    ]);
  });
});

describe('fetchImageBase64（v3.9.0）', () => {
  beforeEach(() => { aoi.toast = vi.fn(); });
  afterEach(() => { delete win.fetch; });

  it('data: URL 直通并识别扩展名', async () => {
    expect(await aoi.exportSummary.fetchImageBase64('data:image/jpeg;base64,AAA')).toEqual({ dataUrl: 'data:image/jpeg;base64,AAA', ext: 'jpeg' });
    expect(await aoi.exportSummary.fetchImageBase64('')).toBeNull();
  });

  it('http(s)：fetch 成功 → content-type 识别格式 + base64 dataURL', async () => {
    const bytes = new Uint8Array([0x89, 0x50, 0x4e, 0x47]);
    win.fetch = vi.fn(async () => ({
      ok: true,
      headers: { get: (h) => (String(h).toLowerCase() === 'content-type' ? 'image/png' : null) },
      arrayBuffer: async () => bytes.buffer
    }));
    const r = await aoi.exportSummary.fetchImageBase64('https://img.example/a.png');
    expect(r.ext).toBe('png');
    expect(r.dataUrl.startsWith('data:image/png;base64,')).toBe(true);
    expect(Buffer.from(r.dataUrl.split(',')[1], 'base64')).toEqual(Buffer.from(bytes));
  });

  it('非 png/jpeg/gif（如 webp）/ HTTP 错误 / 网络异常 → null（回落链接单元格）', async () => {
    win.fetch = vi.fn(async () => ({
      ok: true,
      headers: { get: () => 'image/webp' },
      arrayBuffer: async () => new Uint8Array([1, 2, 3]).buffer
    }));
    expect(await aoi.exportSummary.fetchImageBase64('https://img.example/a.webp')).toBeNull();
    win.fetch = vi.fn(async () => ({ ok: false, status: 404, headers: { get: () => '' } }));
    expect(await aoi.exportSummary.fetchImageBase64('https://img.example/gone.png')).toBeNull();
    win.fetch = vi.fn(async () => { throw new Error('CORS'); });
    expect(await aoi.exportSummary.fetchImageBase64('https://img.example/x.png')).toBeNull();
  });

  it('imageCandidates：白名单主机 直连→/media-proxy→/media-relay，非白名单仅直连', () => {
    const c1 = aoi.exportSummary.imageCandidates('https://esaimg.cdn1.vip/images/a.png');
    expect(c1).toEqual([
      'https://esaimg.cdn1.vip/images/a.png',
      '/media-proxy/esaimg.cdn1.vip/images/a.png',
      '/media-relay/esaimg.cdn1.vip/images/a.png'
    ]);
    expect(aoi.exportSummary.imageCandidates('https://img.example/a.png')).toEqual(['https://img.example/a.png']);
  });

  it('直连被 CORS 拒后经同源代理通道取回字节（v3.9.1 图床无 ACAO 场景）', async () => {
    const bytes = new Uint8Array([0x89, 0x50, 0x4e, 0x47]);
    win.fetch = vi.fn(async (u) => {
      if (String(u).indexOf('/media-proxy/') === 0) {
        return { ok: true, headers: { get: () => 'image/png' }, arrayBuffer: async () => bytes.buffer };
      }
      throw new TypeError('Failed to fetch'); // 直连无 CORS 头源站的典型报错
    });
    const r = await aoi.exportSummary.fetchImageBase64('https://esaimg.cdn1.vip/images/a.png');
    expect(r).not.toBeNull();
    expect(r.ext).toBe('png');
    expect(r.dataUrl.startsWith('data:image/png;base64,')).toBe(true);
    // 通道顺序：先直连、失败后走 /media-proxy
    expect(win.fetch.mock.calls.map((c) => c[0])).toEqual([
      'https://esaimg.cdn1.vip/images/a.png',
      '/media-proxy/esaimg.cdn1.vip/images/a.png'
    ]);
  });
});

describe('SheetJS 回退通道超链接（v3.9.0 renderPlain）', () => {
  beforeEach(() => { aoi.toast = vi.fn(); });
  afterEach(() => { delete win.XLSX; });

  it('图片链接与跳转商品链接写入单元格 .l，点击可直达', () => {
    const written = [];
    const seen = {};
    const enc = ({ r, c }) => aoi.exportSummary.cellAddr(r, c);
    win.XLSX = {
      utils: {
        book_new: () => ({}),
        aoa_to_sheet: (aoa) => {
          const ws = {};
          aoa.forEach((row, r) => (row || []).forEach((v, c) => { if (v != null) ws[enc({ r, c })] = { t: 's', v }; }));
          return ws;
        },
        encode_cell: enc,
        book_append_sheet: (wb, ws, name) => { wb[name] = ws; seen[name] = ws; }
      },
      writeFile: (wb, f) => written.push(f)
    };
    const desc = aoi.exportSummary.buildWorkbook(fixture(), null);
    aoi.exportSummary.renderPlain(desc, '测试汇总');
    expect(written).toEqual(['测试汇总.xlsx']);
    // renderPlain 写入的采购表 ws：图片链接格 E3 与跳转链接格 E7 均带 .l 绝对地址
    const pc = seen[desc.sheets[0].name];
    expect(pc['E3'].v).toBe('图片链接');
    expect(pc['E3'].l.Target).toBe('https://img.example/m1.jpg');
    expect(pc['E7'].l.Target).toBe('https://www.pokemoncenter-online.com/products/jan1.html');
  });
});
