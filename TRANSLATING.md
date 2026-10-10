# 翻译指南 / Translating MD Reader

MD Reader 是一个在浏览器里直接阅读本地 `.md` 文件的扩展。它除了英文与简体中文，
还提供日语、韩语。**欢迎补充其他语言，或修正现有翻译。**

- [语言包在哪里](#语言包在哪里)
- [每个字段的含义](#每个字段的含义)
- [占位符](#占位符)
- [怎么加一种新语言](#怎么加一种新语言)
- [几条注意事项](#几条注意事项)

---

## 语言包在哪里

```
_locales/
├── en/messages.json      英语
├── ja/messages.json      日语
├── ko/messages.json      韩语
└── zh_CN/messages.json   简体中文（default_locale，也是文案的原始出处）
```

每个文件 86 条，当前四份的 key 完全一致。

> **按项目约定，新增文案只加 `zh_CN` 一份**，其他语言按需同步。
> 所以某个时间点上，其他语言可能暂时少几条 —— 不必担心：
> `t()` 找不到时会回退到中文，`scripts/check-locales.py` 也只把它列为警告而非错误。

## 每个字段的含义

以一条真实的文案为例：

```json
"folder_collapseAll": {
  "message": "折叠全部",
  "description": "「文件夹」标签页面板顶栏的图标按钮（悬停提示）。点击后收起所有已展开的子文件夹。"
}
```

| 字段 | 作用 |
|---|---|
| key（`folder_collapseAll`） | 代码里的引用名，**不要改** |
| `message` | **要翻译的文案** |
| `description` | **给你的上下文说明**，说明这条文案出现在哪里、什么情况下显示。<br>这是 Chrome 为翻译者预留的标准字段，**不需要翻译**，但一定要读 |

`zh_CN/messages.json` 里的 `description` 写得最详细（它是原始出处），
翻译时**以它为背景参考**最可靠。

## 占位符

形如 `$1` `$2` 的位置会被运行时替换成实际值：

```json
"folder_count": { "message": "$1 项" }
```

英文写成 `$1 items`、日文写成 `$1 件`。

**规则**：

- `$1` `$2` **必须原样保留**，位置可以按本语言的语序调整
- **不要**改成 `{1}`、`%s` 或别的写法
- 同一条文案在各语言里的占位符**数量必须相同**（仓库里有个脚本会校验这点）

```json
// 中文
"tocCollapseLevel": { "message": "收起所有 H$1 标题" }
// 英文：语序不同，但 $1 仍在
"tocCollapseLevel": { "message": "Collapse all H$1 headings" }
```

## 怎么加一种新语言

**1. 确认语言代码**

用 Chrome 的写法，例如 `de`（德语）、`fr`（法语）、`pt_BR`（巴西葡语）、`zh_TW`（繁体中文）。
完整列表见 [Chrome 官方文档](https://developer.chrome.com/docs/extensions/reference/api/i18n#supported-locales)。

**2. 复制 `_locales/zh_CN/messages.json`，改名为你的语言代码**

```
_locales/de/messages.json
```

复制 `zh_CN` 而不是 `en`，是因为**它带 `description`**（每条文案的位置与作用说明），
你可以在了解上下文的前提下逐条改写 `message`。

**3. 只翻译 `message`，`description` 保留原样**（它只是给你的说明）

**4. 在 `src/shared/i18n.ts` 里注册**

```ts
export type Locale = 'auto' | 'zh_CN' | 'en' | 'ja' | 'ko' | 'de';
//                                                            ^^^^ 加这里

export const LOCALES: Locale[] = ['auto', 'zh_CN', 'en', 'ja', 'ko', 'de'];
//                                                                 ^^^^

import deMessages from '../../_locales/de/messages.json';
//    ^^^^^^^^^^ 加这行

const TABLES: Record<string, MessageTable> = {
  // ...
  de: deMessages as MessageTable,
  // ^^ 加这行
};
```

**5. 在 `src/popup/popup.html` 的语言下拉里加一项**

```html
<!-- 语言名用该语言自己的写法 -->
<option value="de">Deutsch</option>
```

**6. 跑一下校验**

```bash
python scripts/check-locales.py
```

它会检查：JSON 语法、**各语言 key 是否一致**、**占位符数量是否一致**，
并报告空值。这一步能挡掉绝大多数低级错误。

## 几条注意事项

**1. 有些东西不要翻译**

- `Monokai`、`Nord`、`Tokyo Night`、`Xcode`、`GitHub Light` 等**主题名是品牌名**  —— 译了反而难找
- `.md`、`F5`、`chrome://extensions`、`file://` 等**技术标识**
- `H1` `H2`（标题层级）、`Esc`
- `MD Reader`（产品名）

**2. 注意长度**

不少文案出现在**很窄的位置**：

| 位置 | 约束 |
|---|---|
| 侧边栏标签页（`tabOutline` / `tabFolder`） | 两个字中文的宽度，英文约 8 个字符 |
| 代码块复制按钮（`copy` / `copied`） | 按钮很窄，尽量一个词 |
| 文件夹面板的排序按钮（`folder_sortAsc`） | 要带箭头符号 `↑` |
| 面板顶栏计数（`folder_count`） | 例如 `9 项`，请保持同样简短 |

**3. 语气与风格**

- 界面文案，不是文档 —— **用短语，不要写成句子**
- 中文原文用得比较克制（"排序"而不是"请选择排序方式"），请保持同样的简洁
- 各语言按自己的 UI 惯例来：日文可用名词短语，英文用小写开头（除专有名词）

**4. 数字与标点**

- 用本语言的标点习惯：中文和日文可用全角 `：`，英文用半角 `:`
- 引号也按本语言习惯，例如英文用 `"`、日文用 `「」`

---

有任何不确定的地方，欢迎在 Issue 里问 —— 附上 key 名即可，
我会补充 `description` 里的上下文说明。
