"""校验语言包。

以 zh_CN 为基准（它是文案的原始出处，按项目约定只需维护这一份）：

  失败项 —— 基准文件自身的问题，必须修：
    · JSON 语法错误
    · 条目的 message 为空
    · 条目缺少 message 字段（会让 Chrome 拒绝加载整个扩展）

  警告项 —— 其他语言的问题，不阻塞开发：
    · 缺 key / 多 key
    · 占位符数量与基准不一致

这样「只加中文、其他语言按需同步」的约定不会卡住构建；
但真要发布某语言时，警告会明确列出还差哪些。
"""

import json
import re
import sys
from pathlib import Path

LOCALES_DIR = Path('_locales')
BASE = 'zh_CN'

# Chrome 只认这些字段，多出来的会被忽略（但不报错）
ALLOWED_FIELDS = {'message', 'description', 'placeholders'}

PLACEHOLDER = re.compile(r'\$\d+')


def load(path: Path) -> dict | None:
    try:
        data = json.loads(path.read_text(encoding='utf-8'))
    except json.JSONDecodeError as e:
        print(f'✗ {path.parent.name}: JSON 语法错误 —— {e}')
        return None
    if not isinstance(data, dict):
        print(f'✗ {path.parent.name}: 顶层不是对象')
        return None
    return data


def check_entries(name: str, data: dict) -> list[str]:
    """检查条目结构，返回问题列表（这些属于失败项）。"""
    problems = []
    for key, entry in data.items():
        if not isinstance(entry, dict):
            problems.append(f'{key}: 不是对象（Chrome 会拒绝加载）')
            continue
        if 'message' not in entry:
            problems.append(f'{key}: 缺少 message 字段')
        elif not str(entry['message']).strip():
            problems.append(f'{key}: message 为空')
        extra = set(entry) - ALLOWED_FIELDS
        if extra:
            problems.append(f'{key}: 含非标准字段 {sorted(extra)}')
    return problems


def main() -> int:
    tables: dict[str, dict] = {}
    failed = False

    for d in sorted(LOCALES_DIR.iterdir()):
        f = d / 'messages.json'
        if not d.is_dir() or not f.exists():
            continue
        data = load(f)
        if data is None:
            failed = True
            continue

        problems = check_entries(d.name, data)
        if problems:
            failed = True
            print(f'✗ {d.name}: {len(problems)} 个结构问题')
            for p in problems:
                print(f'    {p}')
        else:
            print(f'✓ {d.name}: {len(data)} 条，结构正常')
        tables[d.name] = data

    if BASE not in tables:
        print(f'\n✗ 找不到基准语言包 {BASE}')
        return 1

    base = tables[BASE]
    others = [n for n in tables if n != BASE]

    print(f'\n--- 与基准（{BASE}，{len(base)} 条）对比 ---')
    warned = 0
    for name in others:
        data = tables[name]
        missing = sorted(set(base) - set(data))
        extra = sorted(set(data) - set(base))

        mismatched = []
        for key in sorted(set(base) & set(data)):
            b = len(PLACEHOLDER.findall(base[key].get('message', '')))
            o = len(PLACEHOLDER.findall(data[key].get('message', '')))
            if b != o:
                mismatched.append(f'{key}（基准 {b} 个占位符，本语言 {o} 个）')

        if not missing and not extra and not mismatched:
            print(f'  ✓ {name}: 与基准一致')
            continue

        warned += 1
        parts = []
        if missing:
            parts.append(f'缺 {len(missing)} 条')
        if extra:
            parts.append(f'多 {len(extra)} 条')
        if mismatched:
            parts.append(f'{len(mismatched)} 条占位符不符')
        print(f'  ! {name}: ' + '，'.join(parts))
        if missing:
            print(f'      缺: {", ".join(missing[:6])}' + (' …' if len(missing) > 6 else ''))
        if extra:
            print(f'      多: {", ".join(extra[:6])}' + (' …' if len(extra) > 6 else ''))
        for m in mismatched[:4]:
            print(f'      占位符: {m}')

    print()
    if warned:
        print(f'提示：{warned} 个语言与基准有差异。按项目约定，新增文案只维护 '
              f'{BASE}，其他语言在需要时同步，因此这里不视为错误。')
    if failed:
        print('结果：基准文件或结构存在问题，需要修复。')
        return 1
    print('结果：通过。')
    return 0


if __name__ == '__main__':
    sys.exit(main())
