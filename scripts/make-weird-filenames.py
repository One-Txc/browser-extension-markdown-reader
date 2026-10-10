"""生成一批文件名带特殊字符 / 超长的测试文档。

Windows 文件名不允许 \\ / : * ? " < > |，所以那几类无法真实构造；
其余常见「问题字符」都覆盖到了。
"""

from pathlib import Path

d = Path('testMd/16-特殊文件名')
d.mkdir(parents=True, exist_ok=True)

# 文件名 -> 内容说明
cases = {
    '含 空格.md': '文件名里有普通空格。',
    '含  连续空格.md': '文件名里有两个连续空格。',
    '含%百分号.md': '关键用例：% 在 URL 里是转义引导符，看它会不会把解码搞崩。',
    '100%完成.md': '关键用例：百分号紧跟在数字后面。',
    '含#井号.md': '关键用例：# 在 URL 里是 fragment 分隔符。',
    '含&与=.md': '关键用例：& 和 = 在查询串里有特殊含义。',
    "含'单引号.md": '单引号，用于验证拼接时不会破坏字符串。',
    '含`反引号.md': '反引号在 JS 模板串里有含义。',
    '含+加号.md': '+ 在 URL 查询串里代表空格。',
    '含[,]方括号.md': '方括号。',
    '含(圆)括号.md': '圆括号。',
    '含@美元!叹号.md': '符号组合。',
    '含~波浪^.脱字符.md': '波浪号与脱字符。',
    '含·间隔号—破折号….md': '中文标点。',
    '含 emoji 🎉🚀 的表情.md': 'emoji（补充平面字符，会被拆成代理对）。',
    'ｆｕｌｌｗｉｄｔｈ全角.md': '全角字符。',
    'CamelCase与snake_case混合.MD': '大写扩展名 .MD。',
}

# 超长文件名：Windows 单段上限 255 字符，这里控制在 200 左右
long_name = '超长文件名' + 'ABCDEFGHIJ' * 18 + '.md'
cases[long_name] = '关键用例：约 190 字符的文件名，看列表里怎么截断、顶栏会不会被撑破。'

for name, body in cases.items():
    (d / name).write_text(f'# {name}\n\n{body}\n', encoding='utf-8')

print(f'已在 {d} 下生成 {len(cases)} 个文件：')
for name in cases:
    print(f'  {len(name):>3} 字符  {name}')
