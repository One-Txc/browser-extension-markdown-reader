"""生成扩展图标。

图形取自 folder.ts 里表示 Markdown 文件的 ICON_MD：一张圆角卡片里一个 M 折线。

★ 最终形态：白底 + 黑字，四个尺寸一致。
演进过程（都是被否掉的版本，记下来免得再走回去）：
  1. 蓝色实心圆角方块 + 白色 M —— 整块蓝太笨重
  2. 透明底 + 蓝色描边（含卡片轮廓）—— 48/128 上那圈蓝边显得多余
  3. 现在的白底黑字

白底而不是透明底：透明底得靠描边色去适配工具栏主题，
纯黑在深色工具栏上看不清、纯白反之；白底则两种主题下都稳定。

用法：
    python scripts/tools/icons.py
"""

from __future__ import annotations

from pathlib import Path

from PIL import Image, ImageDraw

OUT_DIR = Path('icons')

BG = (255, 255, 255, 255)
# 与正文色一致（--md-fg 的浅色值），比纯黑柔和一点
INK = (31, 35, 40, 255)

# 超采样倍数：先按大画布画，再缩回去，得到平滑边缘
SS = 8

# ICON_MD 的原始坐标基于 16×16 的 viewBox
VB = 16.0


def _pt(x: float, y: float, size: int) -> tuple[float, float]:
    """把 viewBox 坐标映射到画布坐标"""
    return (x / VB * size, y / VB * size)


def draw_icon(size: int) -> Image.Image:
    s = size * SS
    img = Image.new('RGBA', (s, s), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)

    # 白色圆角底
    pad = s * 0.045
    d.rounded_rectangle(
        [pad, pad, s - pad, s - pad],
        radius=s * 0.235,
        fill=BG,
    )

    # M 折线：与 ICON_MD 同一条路径
    #   M5.3 10.9 V6.1 l2.7 3.3 2.7 -3.3 V10.9
    # 略微放大，让图形在白底里占得满一些
    k = 1.22
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
    width = max(2, round(s * 2.1 / VB))

    d.line(points, fill=INK, width=width, joint='curve')
    # line() 的端点是方的，两端各补一个圆点，视觉上与 stroke-linecap: round 一致
    r = width / 2
    for px, py in (points[0], points[-1]):
        d.ellipse([px - r, py - r, px + r, py + r], fill=INK)

    return img.resize((size, size), Image.LANCZOS)


def main() -> None:
    OUT_DIR.mkdir(exist_ok=True)

    # Chrome 工具栏用 16/32，扩展管理页用 48，商店与安装弹窗用 128。
    # 四个尺寸画法完全一致 —— 早前版本在大尺寸上多画一圈卡片轮廓，
    # 那圈边框在小尺寸里糊、在大尺寸里又显得多余，索性去掉。
    for size in (16, 32, 48, 128):
        icon = draw_icon(size)
        path = OUT_DIR / f'icon{size}.png'
        icon.save(path, 'PNG')
        print(f'  {path}  {size}×{size}')

    print(f'\n共 4 个文件，输出到 {OUT_DIR}/')


if __name__ == '__main__':
    main()
