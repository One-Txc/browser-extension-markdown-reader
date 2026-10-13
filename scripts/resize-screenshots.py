"""把浏览器截图处理成应用商店要求的尺寸。

应用商店（Chrome Web Store / Firefox Add-ons）要求截图是 1280x800 或 640x400。

本脚本**直接拉伸到目标尺寸，不保持比例** —— 这是明确选定的行为，
不是疏忽。截图工具截出来的比例（常见 2.08）与商店要求的 16:10 = 1.6 差得较多，
另外两种做法各有各的代价：

    等比缩放 + 留边   内容完整，但上下会有大片空白
    等比缩放 + 裁剪   没有空白，但会切掉左右内容（侧边栏首当其冲）

拉伸则没有空白、也不丢内容，代价是**画面被压扁**：1920x921 拉到 1280x800 时，
宽度缩到 67%、高度只缩到 87%，横向比纵向多缩约 23%，文字会变窄、图标会变瘦。

想要既不变形又没空白，唯一的办法是**截图时就截成 16:10** ——
按 F11 全屏后内容区就是 1536x864（比例 1.78），已经很接近了。

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
"""

from __future__ import annotations

import sys
from pathlib import Path

from PIL import Image

ROOT = Path('截图')
SIZES = [(1280, 800), (640, 400)]

IMAGE_SUFFIXES = {'.png', '.jpg', '.jpeg', '.webp'}


def looks_like_size_dir(name: str) -> bool:
    """判断目录名是不是本脚本生成的那种尺寸目录（形如 1280x800）"""
    if 'x' not in name.lower():
        return False
    left, _, right = name.lower().partition('x')
    return left.isdigit() and right.isdigit()


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
            img = Image.open(src).convert('RGB')
            img.resize(size, Image.LANCZOS).save(out_dir / src.name, 'PNG')
            written += 1

    for src in sources:
        with Image.open(src) as im:
            sx, sy = 1280 / im.width, 800 / im.height
            if abs(sx - sy) > 0.005:
                note = f'横向 {sx * 100:.0f}% / 纵向 {sy * 100:.0f}%  ← 不等比，画面会压扁'
            else:
                note = f'等比例 {sx * 100:.0f}%'
            print(f'    {src.name:<44} {im.width}x{im.height} → {note}')
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
    print('处理：直接拉伸到目标尺寸（不保持比例）\n')

    total = 0
    for lang in langs:
        print(f'[{lang.name}]')
        total += process_lang(lang, keep_stale)

    print(f'\n完成：{len(langs)} 个语言目录，共写出 {total} 个文件。')
    return 0


if __name__ == '__main__':
    sys.exit(main())
