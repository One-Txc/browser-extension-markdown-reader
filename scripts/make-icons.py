"""生成扩展图标。

图形取自 folder.ts 里表示 Markdown 文件的 ICON_MD：
一个圆角卡片，里面一个 M 折线。这里加了蓝色底 ——
工具栏图标的原始形状是「描边、透明底」，直接拿来当应用图标会在
浅色工具栏上发灰、在深色工具栏上发白，加一层实底才稳定。

小尺寸（16 / 32）只画 M 折线：卡片轮廓在 16px 下只有约 1px 宽，
和折线挤在一起会糊成一团，反而认不出是什么。

用法：
    python scripts/make-icons.py
"""

from __future__ import annotations

from pathlib import Path

from PIL import Image, ImageDraw

OUT_DIR = Path('icons')

# 与扩展内的强调色（--md-toc-active）保持一致
BRAND = (9, 105, 218, 255)
WHITE = (255, 255, 255, 255)

# 超采样倍数：先按大画布画，再缩回去，得到平滑边缘
SS = 8

# ICON_MD 的原始坐标基于 16×16 的 viewBox
VB = 16.0


def _pt(x: float, y: float, size: int) -> tuple[float, float]:
    """把 viewBox 坐标映射到画布坐标"""
    return (x / VB * size, y / VB * size)


def draw_icon(size: int, with_card: bool) -> Image.Image:
    """@param with_card 是否画出卡片轮廓（大尺寸才需要）"""
    s = size * SS
    img = Image.new('RGBA', (s, s), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)

    # 底色：圆角方块，四周留一点边距让圆角完整
    pad = s * 0.055
    d.rounded_rectangle(
        [pad, pad, s - pad, s - pad],
        radius=s * 0.235,
        fill=BRAND,
    )

    # 卡片轮廓：略微内缩的圆角矩形，白色描边
    if with_card:
        stroke = s * 1.45 / VB
        d.rounded_rectangle(
            [_pt(3.4, 3.7, s)[0], _pt(3.4, 3.7, s)[1], _pt(12.6, 12.3, s)[0], _pt(12.6, 12.3, s)[1]],
            radius=s * 1.5 / VB,
            outline=WHITE,
            width=max(1, round(stroke)),
        )

    # M 折线：与 ICON_MD 同一条路径
    #   M5.3 10.9 V6.1 l2.7 3.3 2.7 -3.3 V10.9
    points = [
        _pt(5.3, 10.9, s),
        _pt(5.3, 6.1, s),
        _pt(8.0, 9.4, s),
        _pt(10.7, 6.1, s),
        _pt(10.7, 10.9, s),
    ]
    # 小尺寸下把 M 画粗一点，否则在工具栏里几乎看不见
    width = max(2, round(s * (2.2 if not with_card else 1.7) / VB))

    d.line(points, fill=WHITE, width=width, joint='curve')
    # line() 的端点是方的，两端各补一个圆点，视觉上与 stroke-linecap: round 一致
    r = width / 2
    for cx, cy in (points[0], points[-1]):
        d.ellipse([cx - r, cy - r, cx + r, cy + r], fill=WHITE)

    return img.resize((size, size), Image.LANCZOS)


def main() -> None:
    OUT_DIR.mkdir(exist_ok=True)

    # Chrome 工具栏用 16/32，扩展管理页用 48，商店与安装弹窗用 128
    for size in (16, 32, 48, 128):
        icon = draw_icon(size, with_card=size >= 48)
        path = OUT_DIR / f'icon{size}.png'
        icon.save(path, 'PNG')
        print(f'  {path}  {size}×{size}  卡片轮廓={"是" if size >= 48 else "否（小尺寸省略，避免糊成一团）"}')

    print(f'\n共 4 个文件，输出到 {OUT_DIR}/')


if __name__ == '__main__':
    main()
