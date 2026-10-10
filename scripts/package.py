"""把构建产物打成可上传的应用商店压缩包。

产物布局（见 scripts/manifest.mjs 的 LAYOUT）：

    output/MV3/   Chrome / Edge 的扩展根，manifest.json 就在这一层
    output/MV2/   Firefox 的扩展根

打包时**直接压缩扩展根**即可 —— icons/ 与 _locales/ 由 build.mjs 复制进去，
`output/` 里不含任何源码、测试或 node_modules。这一点值得确保：
把开发文件混进发布包既会撑大体积，也可能触发商店审核的额外询问。

用法：
    python scripts/package.py            # 打包两个目标
    python scripts/package.py chrome     # 只打包 Chrome
"""

from __future__ import annotations

import json
import sys
import zipfile
from pathlib import Path

# 商店包名里用得到的平台标识
TARGETS = {
    'chrome': 'output/MV3',
    'firefox': 'output/MV2',
}

OUT_DIR = Path('dist')

# 正常情况下不该出现在产物里的东西，出现就说明构建流程有问题，直接拦下
FORBIDDEN_PARTS = {'node_modules', 'src', 'scripts', 'testMd', 'preview', 'docs', '.git'}
FORBIDDEN_SUFFIX = ('.ts', '.mjs', '.py', '.map')


def collect(root: Path) -> list[Path]:
    """列出要打进包里的文件，同时挡掉不该出现的东西"""
    files: list[Path] = []
    problems: list[str] = []

    for path in sorted(root.rglob('*')):
        if not path.is_file():
            continue
        rel = path.relative_to(root)
        parts = set(rel.parts)

        bad = parts & FORBIDDEN_PARTS
        if bad:
            problems.append(f'{rel}（含开发目录 {sorted(bad)}）')
            continue
        if rel.name.endswith(FORBIDDEN_SUFFIX):
            problems.append(f'{rel}（源码文件不该出现在产物里）')
            continue
        # 编辑器与系统留下的杂物
        if rel.name in {'.DS_Store', 'Thumbs.db'} or rel.name.startswith('._'):
            continue

        files.append(path)

    if problems:
        print('  ✗ 产物里发现了不该有的文件：')
        for p in problems[:10]:
            print(f'      {p}')
        raise SystemExit('请检查构建流程，不要把这些打进发布包')

    return files


def package(target: str) -> Path:
    root = Path(TARGETS[target])
    if not (root / 'manifest.json').exists():
        raise SystemExit(f'✗ 找不到 {root}/manifest.json，先跑 npm run build')

    manifest = json.loads((root / 'manifest.json').read_text(encoding='utf-8'))
    version = manifest['version']
    name = manifest['name']

    files = collect(root)
    total = sum(f.stat().st_size for f in files)

    OUT_DIR.mkdir(exist_ok=True)
    out = OUT_DIR / f'md-reader-{version}-{target}.zip'

    with zipfile.ZipFile(out, 'w', zipfile.ZIP_DEFLATED, compresslevel=9) as zf:
        for f in files:
            # manifest.json 必须在包根目录，不能多套一层
            zf.write(f, f.relative_to(root).as_posix())

    print(
        f'  {out}  {len(files)} 个文件  '
        f'{total / 1024 / 1024:.1f} MB → {out.stat().st_size / 1024 / 1024:.1f} MB'
    )
    print(f'      name={name}  manifest_version={manifest.get("manifest_version")}  version={version}')
    return out


def main() -> None:
    wanted = sys.argv[1:] or list(TARGETS)
    unknown = [t for t in wanted if t not in TARGETS]
    if unknown:
        raise SystemExit(f'✗ 未知目标 {unknown}，可选：{list(TARGETS)}')

    for target in wanted:
        package(target)

    print(f'\n提示：应用商店上传的是 zip 里的内容，不是 zip 本身。')
    print(f'      manifest.json 必须位于压缩包根目录 —— 已按此组织。')


if __name__ == '__main__':
    main()
