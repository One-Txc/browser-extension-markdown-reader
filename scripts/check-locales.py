"""校验语言包：JSON 语法、两份 key 是否一致、有无空值。"""

import json
from pathlib import Path

LOCALES = Path('_locales')
tables = {}
for d in sorted(LOCALES.iterdir()):
    f = d / 'messages.json'
    if not f.exists():
        print(f'✗ {d.name}: 缺少 messages.json')
        continue
    try:
        data = json.loads(f.read_text(encoding='utf-8'))
    except json.JSONDecodeError as e:
        print(f'✗ {d.name}: JSON 语法错误 —— {e}')
        continue
    tables[d.name] = data
    empty = [k for k, v in data.items() if not v.get('message', '').strip()]
    print(f'✓ {d.name}: {len(data)} 条' + (f'，空值 {empty}' if empty else ''))

if len(tables) < 2:
    raise SystemExit(1)

names = list(tables)
base = set(tables[names[0]])
print()
for n in names[1:]:
    other = set(tables[n])
    missing = base - other
    extra = other - base
    if missing or extra:
        print(f'✗ {n} 与 {names[0]} 不一致：')
        if missing:
            print(f'    缺 {len(missing)} 条：{sorted(missing)[:8]}')
        if extra:
            print(f'    多 {len(extra)} 条：{sorted(extra)[:8]}')
    else:
        print(f'✓ {n} 与 {names[0]} 的 {len(base)} 个 key 完全一致')

# 占位符一致性：同一条在各语言里的 $N 数量应当相同
print()
bad = 0
for k in sorted(base):
    counts = {}
    for n in names:
        counts[n] = tables[n][k]['message'].count('$')
    if len(set(counts.values())) > 1:
        print(f'⚠ {k} 占位符数量不一致：{counts}')
        bad += 1
print(f'占位符不一致 {bad} 条' if bad else f'✓ 全部 {len(base)} 条的占位符数量一致')
