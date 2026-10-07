// v3.24.0 账户与设置「关于」选项卡——Aoi.ABOUT 元数据 / render 填充 / toggle 折叠 / nav 进入自动刷新
import { describe, it, expect, beforeEach } from 'vitest';
import { aoi, doc } from './helpers/aoi.js';

describe('「关于」选项卡（v3.24.0）', () => {
  beforeEach(() => {
    doc.getElementById('aboutBody').classList.add('hidden'); // 复位折叠态
  });

  it('Aoi.ABOUT 元数据完整：版本号格式 / https 链接 / 作者署名 / 日志非空且首条对应当前版本', () => {
    expect(aoi.ABOUT.version).toMatch(/^v\d+\.\d+\.\d+$/);
    expect(aoi.ABOUT.buildDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(aoi.ABOUT.repo).toBe('https://github.com/zhengdaode/Aoi-system');
    expect(aoi.ABOUT.site).toMatch(/^https:\/\//);
    expect(aoi.ABOUT.changelog).toContain('CHANGELOG.md');
    expect(aoi.ABOUT.originalAuthor).toContain('秋洛');
    expect(aoi.ABOUT.originalRepo).toContain('mossasari');
    expect(aoi.ABOUT.maintainer).toContain('zhengdaode');
    expect(aoi.ABOUT.log.length).toBeGreaterThanOrEqual(3);
    expect(aoi.ABOUT.log[0]).toContain(aoi.ABOUT.version);
  });

  it('render：填充版本 / 日志列表 / 仓库·线上站·完整日志·原项目四个链接', () => {
    aoi.about.render();
    expect(doc.getElementById('aboutVersion').textContent).toContain(aoi.ABOUT.version);
    expect(doc.getElementById('aboutLog').children.length).toBe(aoi.ABOUT.log.length);
    expect(doc.getElementById('aboutRepoLink').href).toBe('https://github.com/zhengdaode/Aoi-system');
    expect(doc.getElementById('aboutSiteLink').href).toBe(aoi.ABOUT.site);
    expect(doc.getElementById('aboutChangelogLink').href).toContain('CHANGELOG.md');
    expect(doc.getElementById('aboutOrigLink').href).toContain('mossasari');
  });

  it('toggle：点开显示 / 再点收起，aria-expanded 与箭头方向同步', () => {
    const body = doc.getElementById('aboutBody');
    expect(body.classList.contains('hidden')).toBe(true);
    aoi.about.toggle();
    expect(body.classList.contains('hidden')).toBe(false);
    expect(doc.getElementById('aboutToggleBtn').getAttribute('aria-expanded')).toBe('true');
    expect(doc.getElementById('aboutChevron').style.transform).toContain('180');
    aoi.about.toggle();
    expect(body.classList.contains('hidden')).toBe(true);
    expect(doc.getElementById('aboutToggleBtn').getAttribute('aria-expanded')).toBe('false');
    expect(doc.getElementById('aboutChevron').style.transform).not.toContain('180');
  });

  it('Aoi.nav 进入设置页自动刷新关于内容（render 钩子）', () => {
    doc.getElementById('aboutVersion').textContent = '';
    aoi.nav('view-settings');
    expect(doc.getElementById('aboutVersion').textContent).toContain(aoi.ABOUT.version);
  });
});
