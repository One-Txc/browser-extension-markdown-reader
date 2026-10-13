"""把浏览器截图处理成应用商店要求的尺寸。

应用商店（Chrome Web Store / Firefox Add-ons）要求截图是 1280x800 或 640x400，
比例固定 16:10 = 1.6。

处理分两步：

    1. 裁到 16:10 —— 比目标宽就裁左右，比目标窄就裁底部
    2. 等比缩放到 1280x800 与 640x400

这样既不留边、也不变形，代价只是裁掉一点点边缘像素。
截图越接近 16:10，裁得越少：实测 1314x819（比例 1.604）裁完只需缩放，
几乎是无损的。

**裁底部而不是上下均分**：截图底部往往是空白或状态栏一类可以舍弃的区域，
顶部才有标题和工具栏。横向居中裁，两侧对称。

────────────────────────────────────────────────────────────────
用法
────────────────────────────────────────────────────────────────

目录结构约定：

    截图/
    ├── 中文/                    ← 把原图直接放这里
    │   ├── 一张图.png
    │   └── 另一张.png
    ├── 英文/                    ← 需要多语言就再建一个子目录
    │   └── ...
    └── 备注.txt                 ← 非图片文件会被忽略

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
    └── 英文/…

只想处理某一个语言：

    python scripts/resize-screenshots.py 中文

另一个选项：

    --keep-stale    保留尺寸目录里原图已不存在的旧输出
                    （默认会清掉，避免删了原图后结果里留着幽灵文件）

────────────────────────────────────────────────────────────────
截图本身的建议
────────────────────────────────────────────────────────────────

- **截成 16:10 最省事**。做法：F12 打开 DevTools → Ctrl+Shift+M 开启设备工具栏
  → 尺寸填 1600x1000 或 1440x900 → Ctrl+Shift+P 输入 screenshot
  → 选 Capture screenshot。这样截出来直接就是 16:10
- 注意窗口宽度别低于 824px，否则侧边栏会收成抽屉（见 app.css 的断点注释）
- 别把浏览器边框、桌面背景截进去，那会改变比例，白白多裁一些
"""

from __future__ import annotations

import sys
from pathlib import Path

from PIL import Image

ROOT = Path('截图')
SIZES = [(1280, 800), (640, 400)]

# 商店要求的比例，两个尺寸都是它
TARGET_RATIO = 1280 / 800

IMAGE_SUFFIXES = {'.png', '.jpg', '.jpeg', '.webp'}


def looks_like_size_dir(name: str) -> bool:
    """判断目录名是不是本脚本生成的那种尺寸目录（形如 1280x800）"""
    if 'x' not in name.lower():
        return False
    left, _, right = name.lower().partition('x')
    return left.isdigit() and right.isdigit()


def crop_to_ratio(img: Image.Image, ratio: float) -> tuple[Image.Image, str]:
    """裁到指定宽高比。返回（裁好的图, 裁掉了什么的说明）"""
    w, h = img.size
    current = w / h

    if abs(current - ratio) < 0.002:
        return img, '无需裁剪'

    if current > ratio:
        # 太宽 → 裁左右，居中
        new_w = round(h * ratio)
        left = (w - new_w) // 2
        return img.crop((left, 0, left + new_w, h)), f'裁左右 {w - new_w}px'

    # 太高 → 裁底部，保住顶部的标题与工具栏
    new_h = round(w / ratio)
    return img.crop((0, 0, w, new_h)), f'裁底部 {h - new_h}px'


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
    notes: list[str] = []

    for src in sources:
        with Image.open(src) as raw:
            img = raw.convert('RGB')
            w0, h0 = img.size
            cropped, how = crop_to_ratio(img, TARGET_RATIO)

        for size in SIZES:
            out_dir = lang_dir / f'{size[0]}x{size[1]}'
            out_dir.mkdir(parents=True, exist_ok=True)
            cropped.resize(size, Image.LANCZOS).save(out_dir / src.name, 'PNG')
            written += 1

        scale = 1280 / cropped.width
        notes.append(f'    {src.name:<40} {w0}x{h0} → {how}，缩放 {scale * 100:.0f}%')

    # 清理陈旧输出
    if not keep_stale:
        for size in SIZES:
            out_dir = lang_dir / f'{size[0]}x{size[1]}'
            for old in out_dir.iterdir():
                if old.is_file() and old.name not in names:
                    old.unlink()
                    print(f'    清理陈旧输出 {out_dir.name}/{old.name}')

    for line in notes:
        print(line)
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

    print(f'输出到 {ROOT}/<语言>/{{1280x800, 640x400}}/，原图不动')
    print('处理：裁到 16:10 → 等比缩放（不留边、不变形）\n')

    total = 0
    for lang in langs:
        print(f'[{lang.name}]')
        total += process_lang(lang, keep_stale)

    print(f'\n完成：{len(langs)} 个语言目录，共写出 {total} 个文件。')
    return 0


if __name__ == '__main__':
    sys.exit(main())
