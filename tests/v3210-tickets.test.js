// v3.21.0 F11-M13 QQ 工单处理台——aoi.tickets 纯函数与映射测试
// 覆盖：状态映射与 relay QUESTION_STATUSES 对齐、contactOf（完整QQ/尾号回退）、
//       fmtTime（ISO→MM-DD HH:MM、非法输入原样）、replyText（trim）。
// DOM 渲染不在 vitest 范围（tickets.render/openDetail 需浏览器环境，行为由 relay 端点测试 + 真机验收覆盖）。
import { describe, it, expect } from 'vitest';
import { aoi } from './helpers/aoi.js';

describe('aoi.tickets 纯函数（F11-M13 工单处理台）', () => {
  it('STATUS_LABEL 覆盖 relay 四态且中文到位', () => {
    const keys = Object.keys(aoi.tickets.STATUS_LABEL).sort();
    expect(keys).toEqual(['forwarded', 'open', 'resolved', 'working']);
    expect(aoi.tickets.STATUS_LABEL.open).toBe('等待查看');
    expect(aoi.tickets.STATUS_LABEL.working).toBe('解决中');
    expect(aoi.tickets.STATUS_LABEL.resolved).toBe('已解决');
    expect(aoi.tickets.STATUS_LABEL.forwarded).toBe('已转发');
  });

  it('contactOf：有完整 QQ 显示全号，无则尾号回退', () => {
    expect(aoi.tickets.contactOf({ qq: '1272822692', qqTail: '2692' })).toBe('QQ 1272822692');
    expect(aoi.tickets.contactOf({ qqTail: '2692' })).toBe('QQ尾2692');
    expect(aoi.tickets.contactOf({})).toBe('QQ尾????');
  });

  it('fmtTime：ISO 转本地 MM-DD HH:MM；非法输入原样返回', () => {
    const out = aoi.tickets.fmtTime('2026-09-26T13:25:00.000Z');
    expect(out).toMatch(/^\d{2}-\d{2} \d{2}:\d{2}$/);
    expect(aoi.tickets.fmtTime('not-a-date')).toBe('not-a-date');
    expect(aoi.tickets.fmtTime('')).toBe('');
  });

  it('replyText：去除首尾空白', () => {
    expect(aoi.tickets.replyText({ id: 'A1' }, '  已加急  ')).toBe('已加急');
    expect(aoi.tickets.replyText({ id: 'A1' }, '')).toBe('');
  });
});
