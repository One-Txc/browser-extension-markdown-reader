"""把浏览器截图处理成应用商店要求的尺寸。

应用商店（Chrome Web Store / Firefox Add-ons）要求截图是 1280x800 或 640x400，
比例固定 16:10 = 1.6。而实际截出来的图往往宽得多（例如 1920x921，比例 2.08），
直接拉伸会让界面明显走形 —— 垂直方向要放大约 33% —— 所以这里的做法是：

    等比缩放到能放进目标框 → 居中贴到目标画布 → 四周留边

留边颜色从原图四角采样（取中位数），浅色主题配浅边、深色主题配深边，
不会出现突兀的白框。

缩放用 LANCZOS，**不做锐化**。曾经加过一次 UnsharpMask 想补偿缩放带来的
软化，但那是多余的：商店展示时图片本身会被缩放，锐化过的边缘在二次缩放里
反而容易出现生硬的黑白边（halo）。保持干净的等比缩放更稳妥。

顺带一提，输出文件通常比原图小很多（实测 5 MB → 140 KB），这是正常的：
截图工具（如 Snipaste）默认几乎不做 PNG 压缩，原图常常接近 3 字节/像素，
而 UI 截图有大片同色区域，正常压缩后只有 0.1~0.2 字节/像素。
差别来自冗余数据，不是细节丢失。

────────────────────────────────────────────────────────────────
用法
────────────────────────────────────────────────────────────────

目录结构约定：

    截图/
    ├── 中文/                    ← 把原图直接放这里
    │   ├── 一张图.png
    │   └── 另一张.png
    ├── english/                 ← 需要多语言就再建一个子目录
    │   └── ...
    └── 备注.txt                 ← 可选：非图片文件会被忽略

跑一次：

    npm run screenshots
    # 等价于
    python scripts/resize-screenshots.py

输出（会覆盖同名结果，原图永远不动）：

    截图/
    ├── 中文/
    │   ├── 一张图.png            ← 原图，保持原样
    │   ├── 1280x800/
    │   │   └── 一张图.png        ← 商店首选尺寸
    │   └── 640x400/
    │       └── 一张图.png        ← 小尺寸备选
    └── english/…

只想处理某一个语言：

    python scripts/resize-screenshots.py 中文

另一个选项：

    --keep-stale    保留尺寸目录里原图已不存在的旧输出
                    （默认会清掉，避免删了原图后结果里留着幽灵文件）

────────────────────────────────────────────────────────────────
截图本身的建议
────────────────────────────────────────────────────────────────

- **尽量截成 16:10**：这样不留边、缩放损失最小。窗口内容区调到接近 16:10 最理想
- **按 F11 全屏**能去掉浏览器界面占掉的高度，是普通窗口达不到 16:10 时最简单的解法
- 别把浏览器边框、桌面背景截进去 —— 那会改变比例，白白多出留边
"""

from __future__ import annotations

import statistics
import sys
from pathlib import Path

from PIL import Image

ROOT = Path('截图')
SIZES = [(1280, 800), (640, 400)]

# 采样留边色时，从四角各取这么大的一小块（相对短边的比例）
CORNER_SAMPLE = 1 / 100

IMAGE_SUFFIXES = {'.png', '.jpg', '.jpeg', '.webp'}


def looks_like_size_dir(name: str) -> bool:
    """判断目录名是不是本脚本生成的那种尺寸目录（形如 1280x800）"""
    if 'x' not in name.lower():
        return False
    left, _, right = name.lower().partition('x')
    return left.isdigit() and right.isdigit()


def edge_color(img: Image.Image) -> tuple[int, int, int]:
    """取四角小块像素的中位数当留边色 —— 比单点采样稳，不会被图标之类带偏"""
    w, h = img.size
    pad = max(2, int(min(w, h) * CORNER_SAMPLE))
    boxes = [
        (0, 0, pad, pad),
        (w - pad, 0, w, pad),
        (0, h - pad, pad, h),
        (w - pad, h - pad, w, h),
    ]

    samples: list[tuple[int, int, int]] = []
    for box in boxes:
        region = img.crop(box).convert('RGB')
        samples.extend(region.getdata())

    return tuple(  # type: ignore[return-value]
        int(statistics.median(c[i] for c in samples)) for i in range(3)
    )


def fit_into(img: Image.Image, size: tuple[int, int]) -> Image.Image:
    """等比缩放到能放进目标框，再居中贴到目标尺寸的画布上"""
    target_w, target_h = size

    scale = min(target_w / img.width, target_h / img.height)
    new_w = max(1, round(img.width * scale))
    new_h = max(1, round(img.height * scale))
    resized = img.resize((new_w, new_h), Image.LANCZOS)

    canvas = Image.new('RGB', size, edge_color(img))
    canvas.paste(resized, ((target_w - new_w) // 2, (target_h - new_h) // 2))
    return canvas


def process_lang(lang_dir: Path, keep_stale: bool) -> int:
    sources = sorted(
        p for p in lang_dir.iterdir()
        if p.is_file() and p.suffix.lower() in IMAGE_SUFFIXES
    )
    if not sources:
        print(f'  ({lang_dir.name} 里没有图片，跳过)')
        return 0

    names = {s.name for s in sources}
    written = 0

    for size in SIZES:
        out_dir = lang_dir / f'{size[0]}x{size[1]}'
        out_dir.mkdir(parents=True, exist_ok=True)

        # 清掉原图已删除、但上一轮生成过的旧文件
        if not keep_stale:
            for old in out_dir.iterdir():
                if old.is_file() and old.name not in names:
                    old.unlink()
                    print(f'    清理陈旧输出 {out_dir.name}/{old.name}')

        for src in sources:
            fit_into(Image.open(src).convert('RGB'), size).save(out_dir / src.name, 'PNG')
            written += 1

    for src in sources:
        with Image.open(src) as im:
            scale = min(1280 / im.width, 800 / im.height)
            print(f'    {src.name:<44} {im.width}x{im.height} → 缩放 {scale * 100:.0f}%')
    return written


def main() -> int:
    args = [a for a in sys.argv[1:] if not a.startswith('-')]
    keep_stale = '--keep-stale' in sys.argv

    if not ROOT.is_dir():
        print(f'✗ 找不到 {ROOT}/ 目录。请把截图放进去，结构见脚本注释。')
        return 1

    langs = [
        d for d in sorted(ROOT.iterdir())
        if d.is_dir() and not looks_like_size_dir(d.name) and (not args or d.name in args)
    ]
    if not langs:
        print(f'✗ {ROOT}/ 下没有可处理的子目录' + (f'（指定的是 {args}）' if args else ''))
        return 1

    print(f'输出到 {ROOT}/<语言>/{{1280x800, 640x400}}/，原图不动\n')

    total = 0
    for lang in langs:
        print(f'[{lang.name}]')
        total += process_lang(lang, keep_stale)

    print(f'\n完成：{len(langs)} 个语言目录，共写出 {total} 个文件。')
    return 0


if __name__ == '__main__':
    sys.exit(main())
