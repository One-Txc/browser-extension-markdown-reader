"""把构建产物打成可上传的应用商店压缩包。

产物布局（见 scripts/build/manifest.mjs 的 LAYOUT）：

    output/MV3/        Chrome / Edge 的扩展根，manifest.json 就在这一层
    output/MV2/        Firefox 的扩展根
    output/dist/       ← 本脚本的输出，两个 zip 放这里

打包时**直接压缩扩展根**即可 —— icons/ 与 _locales/ 由 build.mjs 从 src/ 下复制进去，
`output/` 里不含任何源码、测试或 node_modules。这一点值得确保：
把开发文件混进发布包既会撑大体积，也可能触发商店审核的额外询问。

zip 与扩展根放在同一个 output/ 下，是为了「加载用」和「上传用」两套东西
集中在一处，找起来不用来回切换目录。每次打包前会**清空 output/dist 里的历史
压缩包**：商店上传是人工操作，目录里躺着旧版本（甚至改名前的包）很容易传错，
而新包名里带版本号，旧包永远不会被同名覆盖。

版本号的唯一来源是 package.json（见 scripts/build/manifest.mjs 的注释），
`npm run release` 会先用 `npm version patch` 把它 +1 再构建。所以这里要核对
「产物里的版本」与 package.json 是否一致：改完版本没重新构建就来打包，zip 会
带着旧版本号，上传时被商店按「重复版本」退件，而报错完全看不出是产物过期。

用法：
    python scripts/build/package.py            # 打包两个目标
    python scripts/build/package.py chrome     # 只打包 Chrome
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

# 产物与构建结果放在一起，output/ 一个目录就装齐「加载用」和「上传用」两套东西
#
# ★ 注意：build.mjs 清理时只删各自的目标目录（output/MV3 与 output/MV2），
# 不会碰这里。若以后有人把清理逻辑改成整个 output/，这份包会被一并删掉 ——
# 所以 zip 放在 output/ 下是安全的，但改清理逻辑时要记得这一点。
OUT_DIR = Path('output/dist')

# 产品名与文件名用的短标识，唯一出处是 src/shared/brand.json（与前端共用）。
# 改名只改那个文件，zip 文件名会自动跟着变，这里不要再写死一份。
BRAND = json.loads(Path('src/shared/brand.json').read_text(encoding='utf-8'))

# 版本号的唯一来源是 package.json（构建时由 manifest.mjs 写进清单）
SOURCE_VERSION = json.loads(Path('package.json').read_text(encoding='utf-8'))['version']

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


def clean_archives() -> None:
    """打包前清空 output/dist 里的历史压缩包。

    商店上传是人工操作：目录里留着旧版本、甚至改名前的包，很容易传错；
    而新包名里带版本号，旧包永远不会被同名覆盖，只会越攒越多。
    所以每次打包一律先清空 —— 只删 *.zip，不碰目录里别的东西。
    """
    if not OUT_DIR.exists():
        return

    old = sorted(OUT_DIR.glob('*.zip'))
    for path in old:
        path.unlink()

    if old:
        print(f'  清理 {OUT_DIR}：删除 {len(old)} 个历史压缩包')
        for path in old:
            print(f'      {path.name}')


def package(target: str) -> Path:
    root = Path(TARGETS[target])
    if not (root / 'manifest.json').exists():
        raise SystemExit(f'✗ 找不到 {root}/manifest.json，先跑 npm run build')

    manifest = json.loads((root / 'manifest.json').read_text(encoding='utf-8'))
    version = manifest['version']
    name = manifest['name']

    # 产物过期就停下，别打出一个带着旧版本号的包（商店会按重复版本退件）
    if version != SOURCE_VERSION:
        raise SystemExit(
            f'✗ {root / "manifest.json"} 里的版本 {version} 与 package.json 的 '
            f'{SOURCE_VERSION} 不一致 —— 产物过期了，先跑 npm run build:all'
        )

    files = collect(root)
    total = sum(f.stat().st_size for f in files)

    OUT_DIR.mkdir(exist_ok=True)
    # 包名跟产品名走（slug 取自 src/shared/brand.json），便于在商店后台辨认
    out = OUT_DIR / f'{BRAND["slug"]}-{version}-{target}.zip'

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

    # 先清历史包再打新包：只在循环外做一次，否则第二个目标会把第一个刚出的包删掉
    clean_archives()

    for target in wanted:
        package(target)

    print(f'\n提示：应用商店上传的是 zip 里的内容，不是 zip 本身。')
    print(f'      manifest.json 必须位于压缩包根目录 —— 已按此组织。')


if __name__ == '__main__':
    main()
