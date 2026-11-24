# -*- coding: utf-8 -*-
# 拼好邮（满赠/包邮计算器）— 上传素材生成
# 用法：python brand.py        （依赖 Pillow；字体取系统 Noto Sans SC 可变字体，缺失时回落雅黑/黑体）
# 产出 brand/icon.png（512×512 1:1）与 brand/cover.png（750×1000 3:4）：
#   icon.png  —— 由 brand/icon-src.png（图标原图）等比缩放到 512×512，透明像素铺白
#   cover.png —— 图标原图（与封面同底色无缝融入）+ 名称 + 结果卡示意 + 主按钮示意，
#                全部图形按 2× 超采样绘制后 LANCZOS 降采样抗锯齿
import os
from PIL import Image, ImageDraw, ImageFont

HERE = os.path.dirname(os.path.abspath(__file__))
BRAND = os.path.join(HERE, 'brand')
ICON_SRC = os.path.join(BRAND, 'icon-src.png')
ICON_OUT = os.path.join(BRAND, 'icon.png')
COVER_OUT = os.path.join(BRAND, 'cover.png')

RESAMPLE = getattr(Image, 'Resampling', Image).LANCZOS

# —— 配色：底色与蓝色取自图标原图，其余与小工具界面（animal-island-ui）同值 ——
BG = (255, 242, 247)          # 图标底色（封面同底 → 原图无缝融入）
BLUE = (76, 112, 255)         # 气泡蓝
WHITE = (255, 255, 255)
INK = (121, 79, 39)           # 标题 / 订单金额：界面 --ink
INK_BODY = (114, 93, 66)      # 条目文字：界面 --ink-body
CARD = (255, 251, 231)        # 订单卡底：界面 --bg-input
CARD_BORDER = (223, 210, 198) # 订单卡描边：界面 rgba(196,184,158,.55) 叠在封面上
TEAL = (25, 200, 185)         # 主按钮：界面 --teal
SHADOW_BTN = (189, 174, 160)  # 主按钮 3D 底影：界面 --shadow-btn
OK = (78, 143, 28)            # 达标药丸文字：界面 .ship-ok
OK_BG = (229, 239, 197)       # 达标药丸底：界面 rgba(111,186,44,.18) 叠在订单卡上

# —— 字体候选：(路径, 类型)。variable = 可变字体，按 wght 轴取任意字重；
#    static = 单一字重（粗体），忽略传入的 weight
FONT_CANDIDATES = [
    ('C:/Windows/Fonts/NotoSansSC-VF.ttf', 'variable'),
    ('C:/Windows/Fonts/msyhbd.ttc', 'static'),
    ('/System/Library/Fonts/Hiragino Sans GB.ttc', 'static'),
    ('/usr/share/fonts/opentype/noto/NotoSansCJK-Bold.ttc', 'static'),
    ('/usr/share/fonts/truetype/wqy/wqy-microhei.ttc', 'static'),
]

S = 2  # 超采样系数
_fonts = {}


def font(size, weight=700):
    key = (size, weight)
    if key not in _fonts:
        _fonts[key] = _load_font(int(round(size * S)), weight)
    return _fonts[key]


def _load_font(px, weight):
    for path, kind in FONT_CANDIDATES:
        if not os.path.exists(path):
            continue
        try:
            face = ImageFont.truetype(path, px)
            if kind == 'variable':
                axes = face.get_variation_axes()
                face.set_variation_by_axes([
                    max(a['minimum'], min(a['maximum'], weight)) for a in axes
                ])
            return face
        except Exception:
            continue
    return ImageFont.load_default()


def load_square_art():
    """读图标原图并居中裁成正方形（原图本就是 1:1，裁剪只是保险）"""
    src = Image.open(ICON_SRC).convert('RGBA')
    w, h = src.size
    side = min(w, h)
    x0 = (w - side) // 2
    y0 = (h - side) // 2
    return src.crop((x0, y0, x0 + side, y0 + side))


def build_icon():
    art = load_square_art()
    flat = Image.new('RGBA', art.size, WHITE + (255,))
    out = Image.alpha_composite(flat, art).convert('RGB').resize((512, 512), RESAMPLE)
    out.save(ICON_OUT, optimize=True)
    return out


def build_cover():
    W, H = 750, 1000
    img = Image.new('RGB', (W * S, H * S), BG)
    d = ImageDraw.Draw(img)

    def rr(x0, y0, x1, y1, r, fill=None, outline=None, width=0):
        d.rounded_rectangle([x0 * S, y0 * S, x1 * S, y1 * S], radius=r * S,
                            fill=fill, outline=outline, width=width * S)

    def put(x, cy, text, f, fill, align='left'):
        """单行文字：水平按 align 对齐于 x（left / center / right），垂直按墨迹包围盒居中于 cy；返回宽度"""
        l, t, r, b = d.textbbox((0, 0), text, font=f)
        ref = l if align == 'left' else ((l + r) / 2 if align == 'center' else r)
        d.text((x * S - ref, cy * S - (t + b) / 2), text, font=f, fill=fill)
        return (r - l) / S

    # 图标原图：与封面同底色，气泡与表情直接浮在封面上
    ART, ART_Y = 480, 24
    art = load_square_art().convert('RGB').resize((ART * S, ART * S), RESAMPLE)
    img.paste(art, (int((W - ART) / 2 * S), ART_Y * S))

    put(W / 2, 592, '拼好邮', font(128, 900), INK, align='center')
    put(W / 2, 700, '满赠/包邮计算器', font(40, 700), BLUE, align='center')

    # 结果卡示意（与小工具结果区同款：奶油底订单卡 + 绿色达标药丸）
    rr(60, 748, 690, 872, 18, fill=CARD, outline=CARD_BORDER, width=2)
    w = put(88, 778, '订单 1', font(22, 700), INK)
    put(88 + w + 14, 778, '¥128.00', font(24, 900), INK)
    pill = font(16, 700)
    pill_text = '已达满赠/包邮'
    pill_w = d.textlength(pill_text, font=pill) / S
    rr(662 - pill_w - 24, 764, 662, 792, 14, fill=OK_BG)
    put(662 - 12, 778, pill_text, pill, OK, align='right')
    put(88, 812, '吧唧 ×2', font(18, 500), INK_BODY)
    put(662, 812, '¥60.00', font(18, 700), INK, align='right')
    put(88, 842, '色纸 ×1', font(18, 500), INK_BODY)
    put(662, 842, '¥68.00', font(18, 700), INK, align='right')

    # 主按钮示意（3D 底影）
    rr(165, 905, 585, 957, 26, fill=SHADOW_BTN)
    rr(165, 900, 585, 952, 26, fill=TEAL)
    put(W / 2, 926, '计算购买计划', font(22, 700), WHITE, align='center')

    out = img.resize((W, H), RESAMPLE)
    out.save(COVER_OUT, optimize=True)
    return out


def main():
    if not os.path.exists(ICON_SRC):
        raise SystemExit('缺少图标原图 brand/icon-src.png')
    icon = build_icon()
    print('brand/icon.png  %dx%d  %d B' % (icon.size[0], icon.size[1], os.path.getsize(ICON_OUT)))
    cover = build_cover()
    print('brand/cover.png %dx%d (3:4)  %d B' % (cover.size[0], cover.size[1], os.path.getsize(COVER_OUT)))


if __name__ == '__main__':
    main()
