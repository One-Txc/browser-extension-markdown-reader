"""生成扩展图标。

图形取自 folder.ts 里表示 Markdown 文件的 ICON_MD：
一个圆角卡片，里面一个 M 折线。

★ 透明底、不铺色块。
初版铺了一个蓝色圆角方块，看着笨重；现在是描边式图标。
描边用固定的品牌蓝而不是 currentColor —— manifest 里的位图没有
「当前文字色」这个概念，浏览器工具栏也不会传色，用黑色在白底、深色底
各有一半看不清，蓝色则在两种主题下都有足够对比。

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

    # 卡片轮廓：圆角矩形描边
    if with_card:
        x0, y0 = _pt(1.9, 2.3, s)
        x1, y1 = _pt(14.1, 13.7, s)
        d.rounded_rectangle(
            [x0, y0, x1, y1],
            radius=s * 1.9 / VB,
            outline=BRAND,
            width=max(1, round(s * 1.35 / VB)),
        )

    # M 折线：与 ICON_MD 同一条路径
    #   M5.3 10.9 V6.1 l2.7 3.3 2.7 -3.3 V10.9
    # 没有卡片轮廓时把 M 放大一些，否则四周留白太多显得小
    k = 1.0 if with_card else 1.18
    cx = cy = VB / 2

    def scaled(x: float, y: float) -> tuple[float, float]:
        return _pt(cx + (x - cx) * k, cy + (y - cy) * k, s)

    points = [
        scaled(5.3, 10.9),
        scaled(5.3, 6.1),
        scaled(8.0, 9.4),
        scaled(10.7, 6.1),
        scaled(10.7, 10.9),
    ]
    width = max(2, round(s * (2.0 if with_card else 2.3) / VB))

    d.line(points, fill=BRAND, width=width, joint='curve')
    # line() 的端点是方的，两端各补一个圆点，视觉上与 stroke-linecap: round 一致
    r = width / 2
    for px, py in (points[0], points[-1]):
        d.ellipse([px - r, py - r, px + r, py + r], fill=BRAND)

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
