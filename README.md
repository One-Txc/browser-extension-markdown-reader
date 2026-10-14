# Markdown Read

浏览器扩展：打开本地 `.md` 文件或访问返回 Markdown 的网址时，看到的是**渲染后的文档**，而不是一屏纯文本。

纯前端实现 —— 没有本地服务、没有命令行工具、没有后端。

| 目标 | 清单版本 | 最低浏览器 |
|---|---|---|
| Chrome / Edge | MV3 | 111+ |
| Firefox | MV2 | 128+ |

> 本文同时承担**开发文档**与**使用说明**：前四节讲清楚它做什么、怎么跑起来，后面是架构与改代码前必读的约定。

---

## 目录

- [功能一览](#功能一览)
- [快速开始](#快速开始)
- [核心行为](#核心行为)
- [运行结构与消息协议](#运行结构与消息协议)
- [主流程](#主流程)
- [目录结构](#目录结构)
- [关键设计决策](#关键设计决策)
- [开发命令](#开发命令)
- [测试](#测试)
- [出包与发布](#出包与发布)
- [国际化](#国际化)
- [已知限制](#已知限制)
- [协作约定](#协作约定)
- [进一步阅读](#进一步阅读)

---

## 功能一览

**渲染**

- 完整的 Markdown：标题、列表、表格、引用、任务列表、脚注、删除线、内联 HTML
- 代码块**语法高亮**（16 种语言，见[已知限制](#已知限制)），悬停出现**一键复制**按钮
- **数学公式**（KaTeX）：`$行内$` 与 `$$块级$$`，`$5`、`$10` 不会被误判
- **Mermaid 图表**：flowchart / sequence / class / ER / state / gantt / pie / mindmap 等
- **图片放大**：点击进入全屏，滚轮缩放（0.5x–8x）、拖动平移、左右切换、`Esc` 关闭
- **原文视图**：一键在渲染结果与 Markdown 源码之间切换

**导航与外观**

- 左侧**大纲**：按标题层级生成目录树，滚动自动高亮当前章节，支持逐级折叠与「全部 / 第一层 / 前两层 / 前三层」批量档位
- 左侧**文件夹**：列出当前文档所在目录（仅本地文档），点文档**原地换正文**、不改 URL
- 侧边栏可拖拽调宽（160–560 px）、可整体隐藏；宽屏固定、窄屏收成抽屉
- **9 套代码配色** + **5 套护眼配色**（护眼 / 羊皮纸 / 暖白 / 柔灰 / 暗夜暖调），深浅色可跟随系统
- 字号、正文宽度、大纲折叠阈值与默认层数均可调

**其他**

- 全部在浏览器内完成，**只读**：不修改任何文件，任务列表复选框不可勾选
- 支持**本地文件**与**在线文档**（`file://` 与 `http(s)`，判据见[关键设计决策 4](#4-页面判定分两级matches-只能写宽)）
- 设置**改完立即生效**，不需要刷新页面；界面语言可切简体中文 / English / 日本語 / 한국어
- 渲染后**页面地址不变**，所以相对路径图片、文档互链、`Ctrl+F`、打印都正常

---

## 快速开始

**环境要求**

- **Node.js ≥ 22.12**（`mermaid@12` 的 engines 要求 `>=22.12`，`jsdom@29` 是 `^20.19 || ^22.13 || >=24`；开发环境实测 v22.22.1，更低版本未验证）
- **Python ≥ 3.10 + Pillow** —— 只有辅助脚本用得到（生成图标、测试数据、商店截图），**不参与构建**
- 一个能加载扩展的浏览器（见上表）

```bash
npm install
npm run build:all      # 同时构建 Chrome(MV3) 与 Firefox(MV2)
```

产物是两个各自独立的**扩展根**：

```
output/
├─ MV3/                ← Chrome / Edge 加载这个目录
│  ├─ manifest.json
│  ├─ build/           content.js · background.js · popup.js · popup.html · mermaid.js · fonts/
│  ├─ icons/
│  └─ _locales/
└─ MV2/                ← Firefox 加载这里的 manifest.json
   └─ …（结构同上）
```

**Chrome / Edge**

1. 打开 `chrome://extensions`，右上角开启 **开发者模式**
2. **加载已解压的扩展程序** → 选 **`output/MV3`**
3. ⚠️ **详情 → 打开「允许访问文件网址」** —— 不做这一步，扩展对本地文件**完全不会生效**，页面上也不会有任何提示（脚本根本没被注入）
4. 打开任意 `.md` 文件（已开着的按 `F5`）

**Firefox**

1. 打开 `about:debugging#/runtime/this-firefox` → **临时载入附加组件** → 选 **`output/MV2/manifest.json`**
2. ⚠️ `about:addons` → 本扩展 → 权限 → 打开 **「访问文件 URL」**

**改完代码之后**

```bash
npm run watch          # esbuild 监听重建（Chrome 目标，带 sourcemap、不压缩）
```

然后到扩展管理页点一下本扩展的**刷新**，再刷新文档页面。

> `watch` 只重建脚本产物。改了 `scripts/build/manifest.mjs`（清单字段、版本号）或 `popup.html` 之后要重启 `watch` —— 清单只在构建启动时生成一次。

> 为什么不直接用 `chrome.extension.isAllowedFileSchemeAccess` 检测权限？**实测它在 content script 里不存在**，只暴露给扩展页面。
> 这里改用「content script 能注入进来 = 权限已开」的判据：注入成功后向 Service Worker 上报一次并落盘，由 popup 读取展示。

---

## 核心行为

**页面 URL 全程不变** —— 这是整个设计的支点，值得先理解：

```
用户打开 file:///D:/docs/a.md（或 https://example.com/a.md）
  → 浏览器把内容当纯文本渲染成 <body><pre>原文</pre></body>
  → content script 就地替换 DOM 为渲染结果
  → location.href 仍然是 file:///D:/docs/a.md
```

由此**不需要任何路径重写**：

- Markdown 里的 `![](./img/a.png)` 由浏览器按原目录解析，相对路径天然可用
- `[其他文档](./b.md)` 正常导航，落地后 content script 再接管一次
- 锚点、`Ctrl+F`、`Ctrl+P` 打印，全部照常工作

代价是：**地址栏不再代表「侧边栏里正在显示哪份文档」**。因此代码里维护两个 URL：

| 变量 | 含义 | 何时变 |
|---|---|---|
| `baseDocUrl` | 用户**最初打开**的文档 | 永不 |
| `currentDocUrl` | **正在显示**的文档 | 原地切换文档时更新 |

所有与内容相关的判断用后者；「文件夹」面板的根目录用前者（点了子目录里的文档后，根目录不该跟着跑）。需要真实 URL（分享、收藏、刷新）时，走文件夹面板每行右侧的跳转图标。

---

## 运行结构与消息协议

四个入口，各自一个 esbuild 产物：

| 产物 | 运行位置 | 职责 |
|---|---|---|
| `content.js` | 每个 http(s) / file 页面，`document_start`，ISOLATED world | 判定 → 取原文 → 渲染 → 替换 DOM；挂侧边栏、按钮、图片放大 |
| `background.js` | Service Worker（MV2 下是后台脚本） | 读文件（含编码嗅探）、列目录、按需注入 Mermaid、打开 popup |
| `popup.js` | 扩展弹窗 | 设置界面、权限状态提示 |
| `mermaid.js` | 按需注入被接管的页面 | 渲染 `mermaid` 代码块（5.1 MB，绝不进主包） |

页面侧读不到文件、也列不了目录（CORS 约束），这两件事必须由 Service Worker 代劳，因此有一层消息协议：

| 消息 `type` | 方向 | 作用 |
|---|---|---|
| `file-access-proven` | content → bg | 上报「注入成功」，落盘为权限已开的证据（供 popup 展示） |
| `read-file` | content → bg | 兜底读取原文，顺带处理 GBK 等非 UTF-8 编码 |
| `list-directory` | content → bg | 解析 `file://` 目录索引页，返回目录条目 |
| `render-mermaid` | content → bg | 请求 `chrome.scripting.executeScript` 注入 Mermaid bundle |
| `open-settings` | content → bg | 调 `chrome.action.openPopup()` 打开设置弹窗（可能失败，见下） |
| `settings-changed` | popup → content | 广播设置变更，页面即时套用，无需刷新 |

> **两个已知的平台限制**，改这块代码前先看：
> 1. **popup 无法由页面直接打开**，只能靠 `chrome.action.openPopup()`：Chrome 127+ 才有，Firefox 没有，且要求用户手势 —— 手势能否跨进程传到 background 并不确定。所以失败是**正常路径**，`settings-button.ts` 会退化成页面内提示（静默无反应是最糟的结果）。
> 2. Service Worker 空闲约 30 秒被回收，冷启动后第一次 `fetch` 偶发 `Failed to fetch`，表现为「偶尔读取失败」。`background.ts` 的 `fetchWithRetry` 用 120/240ms 退避重试兜住（只读幂等请求，重试几乎总能成功）。

---

## 主流程

```
content.ts  main()
  │
  ├─ mayBeMarkdownPage()          ← 同步初判，只排除明显无关的页面
  │     file: / http: / https: 才继续；text/html 直接 return
  │
  ├─ 幂等标记 data-md-reader-done ← 刷新、与其它 Markdown 扩展共存时不重复处理
  ├─ 挂右上角设置按钮（不 await，先让用户有个出口）
  ├─ 上报 file-access-proven
  │
  ├─ documentElement.style.visibility = 'hidden'     ← 防纯文本闪烁
  │     ★ 从这行到 try 之间不能有任何可能抛异常的代码，否则 finally 不执行 → 永久白屏
  │
  ├─ try
  │    ├─ 读设置（唯一一次 await；自定义扩展名此刻才知道）
  │    ├─ 二次判定：MIME 是 Markdown 或路径后缀命中 → 否则 return（finally 会恢复可见）
  │    ├─ 取原文 readSource()：优先 DOM 里的 body > pre，失败/乱码才走 SW
  │    ├─ 超 3 MB → 降级提示条，不渲染
  │    └─ renderDocument()：markdown-it → DOMPurify → 替换 DOM → 主题 → 目录 → 图片放大
  │
  └─ finally  visibility 还原 → 用户看到内容，白屏结束
```

`renderDocument()` 由**参数驱动**（`raw` + `url` + `settings`），不读 `location` —— 这样「原地切换文档」可以直接复用它。

**取原文的两条路径**：先读 `body > pre`（零延迟、零权限依赖）；若其中出现大量 U+FFFD（占比 > 0.1%），说明浏览器用错了编码（典型是 GBK 的 `.md` 被按 UTF-8 解码），改由 SW 按原始字节重新嗅探。DOM 也读不到时同样回退 SW。最坏情况是显示乱码，而不是白屏。

---

## 目录结构

```
markdown_reader/
├─ src/
│  ├─ content.ts              # 主流程：判定 → 取原文 → 渲染 → 替换（含「原地切换」）
│  ├─ background.ts           # 消息分发 + 读文件 + 列目录 + 注入 Mermaid + 编码嗅探
│  ├─ render/
│  │  ├─ markdown.ts          # markdown-it 管线 + DOMPurify 配置 + highlight.js 语言注册
│  │  ├─ math.ts              # KaTeX：占位符方式绕开 DOMPurify（见下）
│  │  ├─ mermaid-entry.ts     # Mermaid 独立 bundle 的入口，被注入后自己扫容器
│  │  ├─ toc.ts               # 大纲：树形构建 + 折叠 + 批量档位 + 滚动高亮
│  │  ├─ folder.ts            # 「文件夹」面板：目录列表 + 排序 + 原地切换文档
│  │  ├─ lightbox.ts          # 图片全屏放大（缩放 / 平移 / 切换）
│  │  ├─ source-view.ts       # 原文 ⇄ 渲染视图切换
│  │  ├─ settings-button.ts   # 右上角齿轮 + 打开失败时的提示气泡
│  │  ├─ styles.ts            # 组装并注入 <style>（含 KaTeX 字体路径重写）
│  │  ├─ themes.ts            # 主题 id → CSS 字符串（9 套代码配色 + 2 套正文）
│  │  ├─ theme-catalog.ts     # 主题元数据，**不含 CSS**（让 popup 能轻量引用）
│  │  └─ app.css              # 侧边栏、按钮、面板等补充样式
│  ├─ popup/                  # 设置面板（popup.html / popup.ts）
│  ├─ shared/
│  │  ├─ const.ts             # 常量、两级页面判定、DOM 就绪等待、URL 解码兜底
│  │  ├─ settings.ts          # 设置模型 + storage.sync 读写 + 取值夹取
│  │  ├─ directory.ts         # 目录索引解析、过滤、排序
│  │  ├─ i18n.ts              # 语言包静态 import + t() 回退链
│  │  └─ perf.ts              # 首屏性能打点
│  ├─ types/                  # 手工补的模块类型声明（*.css、注入常量）
│  ├─ _locales/               # 语言包源码：zh_CN（基准）/ en / ja / ko，各 102 条
│  └─ icons/                  # 图标：16/32/48/128 PNG，白底黑字，形状取自 folder.ts 的 ICON_MD
├─ scripts/
│  ├─ build/                  # build.mjs（esbuild）· manifest.mjs（清单生成）· package.py（打 zip）
│  └─ tools/                  # locales.py · testdata.py · screenshots.py
├─ tests/                      # 自动化测试：render / toc / source-view（jsdom，不需要浏览器）
├─ testMd/                     # 手工测试文档，索引见 testMd/00-索引.md
├─ docs/                       # 商店上架资料等，不参与构建
└─ output/                     # 构建产物与 zip（不入库）
```

**源码注释很重**，且大量注释记录的是「为什么不是另一种写法」（踩过的坑）。
改任何模块前，先读该文件的头部注释 —— 那里通常写着这次改动会不会把某个已修好的 bug 带回来。

---

## 关键设计决策

### 1. 不用框架（Vite / WXT / Plasmo），esbuild 直出

content script 必须是**自包含的 IIFE**（不能有 ESM import，也不能依赖 web_accessible_resources）。esbuild 的 `format: 'iife'` + `loader: { '.css': 'text' }` 正好覆盖，零配置。

框架解决不了本项目真正费劲的部分：产物 ASCII 兜底、字体复制、CSS 作为字符串、Mermaid 独立产物 —— 用了框架仍要自己写插件，反而多一层要绕开的抽象。跨浏览器那点清单差异，`scripts/build/manifest.mjs` 一个文件就够了。

### 2. 产物必须是纯 ASCII（硬约束）

Chrome 加载扩展时对脚本编码的校验**比「是否合法 UTF-8」更严**，残留非 ASCII 字节会被判成「该文件采用的不是 UTF-8 编码」而**拒绝加载 content script**，且报错只说是编码问题。

因此：

- esbuild 保持 `charset: 'ascii'`（默认值），**不要改成 `'utf8'`**
- `charset: 'ascii'` 转义不了**正则字面量**里的非 ASCII（markdown-it typographer、mermaid 内部都有），所以构建后另做一次 `\uXXXX` 兜底转换，并断言产物里不存在 `> 0x7F` 的字节

中文在产物里表现为 `\uXXXX`，运行时由 JS 引擎还原，功能不受影响。

### 3. 清单由代码生成，服务端差异集中在一处

`scripts/build/manifest.mjs` 用「一份公共配置 + 目标覆盖」表达两个平台的差异（background 写法、web_accessible_resources 结构、host_permissions 有无、`gecko.id`）。维护两份静态 JSON 迟早漂移。

**版本号的唯一来源是这个文件里的 `VERSION`**，改这里即可（`package.json` 里那份只是给 npm 看的）。

### 4. 页面判定分两级，`matches` 只能写宽

清单里的 `matches` 是 `file:///*` + `http(s)://*/*` —— 在线这一档**无法**限定只匹配 `.md`（服务器给的 Content-Type 未必对，URL 也未必带后缀）。所以脚本会注入到每个 http(s) 页面，真正的筛选在运行时做：

1. `document.contentType` 明确是 Markdown（`text/markdown` 等）→ 直接接管
2. 是 `text/plain` → **必须再看路径后缀**是否命中支持列表（默认 10 种 + 用户自定义）

第二级是必需的：`text/plain` 太宽泛，任何 `.txt`、任何无后缀的纯文本接口都是它。不匹配时立即 `return`，**不做任何 DOM 改动**（尤其不隐藏页面）。

代价是安装时会出现「读取您在所有网站上的数据」这类权限提示。

> 所以初判 `mayBeMarkdownPage()` **不能读用户设置** —— 它必须同步返回（调用方要据此决定是否先隐藏页面），而设置是异步读的。自定义扩展名只能等 `main()` 读完设置后做最终确认。

### 5. 隐藏页面必须与恢复成对出现

`document_start` 就隐藏、渲染完再恢复，这段就是用户感知的白屏。规矩：

- 隐藏之后、进入 `try` 之前**不能有任何可能抛异常的代码**（曾经把 `await settings` 放在这个位置，一旦抛异常 `finally` 不执行，页面永久停在 hidden）
- 渲染失败时保留浏览器原始纯文本视图，**绝不留白屏**
- 不用 `document.write`（会清空文档、丢 URL 语义）

首屏耗时可以直接量：打开任意文档，控制台会输出 `[Markdown Read 性能] {…}`，也可以读全局变量 `__mdReaderPerf`（`visibleMs` 是最关键的指标），或在 Performance 面板里按 `md-reader:` 前缀找原生标记。

### 6. 数学公式的 HTML 不走 DOMPurify

KaTeX 的排版完全依赖内联 `style`（`vertical-align`、`height`…），而 DOMPurify 默认会把 `style` 整体剥掉，公式会彻底错位；放开 `style` 又等于允许任意 CSS 注入（例如 `position:fixed` 覆盖整页做点击劫持）。

做法是分两步：渲染阶段把公式换成唯一占位符、KaTeX 的真实输出先存进数组；**消毒完成后**再把占位符回填。回填内容由 KaTeX 自己生成、`trust` 保持关闭，不构成新的 XSS 面。

另有两处配套细节：

- **KaTeX 字体路径必须重写**。它的 CSS 里写的是 `url(fonts/…)`，而这份 CSS 被内联进 `file://` 页面，相对路径会按**用户文档所在目录**解析，必然 404。运行时改写成 `chrome-extension://<id>/build/fonts/`，字体同时在清单的 `web_accessible_resources` 里声明（只复制 woff2，20 个文件 / 254 KB）
- **只在文档真的含公式时**才注入 KaTeX 样式（判断 `main.querySelector('.katex')`）

### 7. Mermaid 拆包 + 按需注入 + ISOLATED world

Mermaid 打包后有 **5.1 MB**（`content.js` 是 690 KB，对比一下就知道为什么不能混在一起）：`mermaid.core.mjs` 内部有几十处动态 `import()`，而 content script 必须是自包含 IIFE，esbuild 无法代码分割。

所以它独立成 `build/mermaid.js`，只在页面**真的出现** `mermaid` 代码块时才由 Service Worker 注入：

```
content 发现 .md-reader-mermaid
  → sendMessage('render-mermaid')
  → background: chrome.scripting.executeScript({ files: ['build/mermaid.js'] })
  → mermaid-entry.ts 扫描容器 → 填 SVG（靠 data-processed 幂等）
```

**注入到默认的 ISOLATED world，不要改成 `world: 'MAIN'`。** 曾经改成 MAIN，理由是 MV3 扩展 CSP 为 `script-src 'self'`、不允许 `eval`，而 `file://` 页面自身没有 CSP，注入页面 world 就能绕开 —— **那个理由只在本地成立**：在线页面有自己的 CSP，注入 MAIN 就得服从它，GitHub raw 这类站点 script-src 很严，Mermaid 会整体失败（表现为代码块原样留在页面上）。ISOLATED 对本地和在线一视同仁；代价是少数依赖 `eval` 的图表类型渲染失败，已有降级：保留原始代码并标注。

### 8. 「文件夹」面板靠 Chrome 的目录索引页

原理：Chrome 会为 `file://` 的目录 URL 生成一份索引 HTML，里面是一串 `addRow(name, url, isdir, size, size_string, date_modified, date_modified_string)` 调用。**直接 fetch 那个目录地址、正则解析即可，不需要任何用户授权** —— 比 File System Access API 简单得多（不用选目录、不用持久化 handle）。

三个实测踩过的坑（详见 `src/shared/directory.ts` 头部）：

1. `fetch(file://目录)` 的 `Response` 是 `ok:false` / `status:0`，但 body 完整 —— **判断成败只能看文本长度，不能看 `res.ok`**
2. **不能截断返回的 HTML** —— 目录数据在 11000+ 字符之后，只取前 6000 字符会解析出 0 项
3. `isdir` 是 `1/0` 数字不是布尔值

另外，**过滤不在 background 做**：过滤依赖「用户配置了哪些扩展名」，而那份设置只有 content 侧手上有。早前 background 顺手过滤，导致用户把 `txt` 加进支持列表后，`.txt` 在到达 content 之前就被丢掉了，看起来就像设置没生效。

### 9. 设置只替换 `<style>` 与目录节点，不重新渲染 Markdown

配色、字号、宽度这类改动是**即时生效**的：popup 写完 `storage.sync` 后广播 `settings-changed`，content 侧重新组装 `<style>` 即可，Markdown 不需要重新解析。

唯一的例外是**界面语言**：文案是在创建 DOM 的那一刻 `t()` 出来的，已有文本节点不会重新求值（样式能「活」是因为走 CSS 变量与 class）。所以切语言时用保存的原文重建整份内容。

主题 CSS 分两层：`github-markdown-css` 给正文观感，highlight.js 主题给代码配色。**`github-markdown-css` 把正文颜色硬编码在 `.markdown-body` 上、不读 CSS 变量**，所以五套护眼配色除了改变量，还需要 `app.css` 里一段只对护眼配色生效的覆盖规则（选择器带 `[data-md-reader-eye-care]`）。代码块背景统一走 `--md-code-bg`：highlight.js 的浅色主题背景普遍是 `#fff`/`#fafafa`，落在白色文档上几乎看不出代码块边界。

---

## 开发命令

```bash
npm run watch           # esbuild 监听重建（Chrome 目标，不压缩、带 sourcemap）
npm run build           # 只构建 Chrome  → output/MV3
npm run build:firefox   # 只构建 Firefox → output/MV2
npm run build:all       # 两个目标都构建
npm run typecheck       # tsc --noEmit
npm test                # 三组 jsdom 测试（无需浏览器）
npm run check           # typecheck + test + build(chrome)，提交前跑这个

npm run testdata        # 重新生成 testMd/ 的测试图片、GBK 文件、3.4MB 超大文件
npm run locales         # 校验语言包
npm run screenshots     # 把 截图/<语言>/ 里的原图裁成 16:10 并缩成商店尺寸
```

**注意构建清理范围**：`build.mjs` 只删当前目标的扩展根（`output/MV3` 或 `output/MV2`），**不能改成清空整个 `output/`** —— `build:all` 会连续构建两次，第二次会把第一次的产物一起删掉。

`npm run locales` 这类 Python 脚本会打印 `✓`，在 **GBK 控制台（`chcp 936`）** 下会抛 `UnicodeEncodeError`。临时绕开：

```powershell
$env:PYTHONIOENCODING='utf-8'; npm run locales     # PowerShell
set PYTHONIOENCODING=utf-8 && npm run locales      # cmd
```

---

## 测试

```bash
npm test        # 97 项断言，全部跑在 jsdom 里，不需要浏览器
```

| 脚本 | 断言 | 覆盖 |
|---|---|---|
| `tests/render.mjs` | 31 | 渲染管线：标题锚点（含中文锚点）、表格、代码高亮、任务列表只读、脚注、XSS 清除、公式占位符回填、`$5` 不被误判为公式、mermaid 占位容器 |
| `tests/toc.mjs` | 51 | 目录树：层级 class、折叠、批量档位互斥、permalink 符号剔除、挂载与销毁 |
| `tests/source-view.mjs` | 15 | 原文 ⇄ 渲染切换：hidden 标志、按钮文案、body class |

做法是先用 esbuild 把待测模块打成 ESM，再用 jsdom 提供 `window`/`document`（每组的临时产物放在 `.tmp/<脚本名>/`，互不干扰）。

**jsdom 测不了什么**（`getBoundingClientRect` 恒为 0、不算 CSS）：

- 目录的**滚动高亮**
- 一切视觉与布局：配色、间距、图标、抽屉式侧边栏的断点（当前断点是 **824px**）
- 交互手感：拖拽调宽、图片缩放平移、毛玻璃与透明度过渡

**这些必须由人在真实浏览器里确认。** 手工清单见 [testMd/00-索引.md](./testMd/00-索引.md)：按顺序打开每个文件、对照「关键验证点」。里面也列了几条**不支持**的写法（YAML front matter、MDX/JSX、依赖 `eval` 的 Mermaid 图表）。

大文件与特殊编码的测试数据由 `npm run testdata` 生成（`testMd/10-超大文件测试.md` 有 3.4 MB，不入库）。

---

## 出包与发布

```bash
npm run release         # 构建两个目标 + 打包成 zip（默认，快）
npm run release:full    # 先跑 typecheck / test / locales，再执行上面那步
```

产物在 `output/dist/`（各约 1.9 MB）：

```
output/dist/
├─ markdown-read-1.0.0-chrome.zip      ← 上传 Chrome Web Store
└─ markdown-read-1.0.0-firefox.zip     ← 上传 Firefox Add-ons
```

`scripts/build/package.py` 会**直接压缩扩展根**，并拦截不该出现在包里的东西（`node_modules`、`src`、`scripts`、`testMd`、`docs`、`.ts`/`.mjs`/`.py`/`.map`），出现即构建失败。

**默认不跑校验是有意的**：改点文案、调个样式再出一版，不必每次都等一遍完整测试。上架前跑 `release:full`，平时出包用 `release`。

> ⚠️ 两条命令都走 `build:all`。**不要图快改成只跑 `npm run build`** —— 那样 `output/MV2` 会停在旧产物，**而它照样会被打进 zip**，上传后 Firefox 用户拿到的是过时代码。这类问题在构建日志里完全看不出来。

版本号回退会被两个商店直接退件（版本号唯一来源见[关键设计决策 3](#3-清单由代码生成服务端差异集中在一处)）。

商店上架用的描述文案见 `docs/商店文案.md`。

---

## 国际化

支持简体中文、English、日本語、한국어，也可跟随浏览器语言（`auto`）。

**约定：加功能时只维护 `src/_locales/zh_CN/messages.json`**，其他语言在明确需要时才同步。配套机制保证这不会让其他语言出问题：

- `t()` 逐级回退：手动选定语言 → `chrome.i18n` → `zh_CN` → key 本身。只加中文时，其他语言界面显示中文，而不是露出 `folder_collapseAll` 这样的裸 key
- `scripts/tools/locales.py` **以 `zh_CN` 为基准**：基准文件自身的结构问题（JSON 语法、`message` 缺失或为空、非标准字段）报错；其他语言缺 key / 多 key / 占位符数量不符只列为**警告**，不阻塞开发
- 语言包以**静态 `import`** 引入而非运行时 fetch —— `t()` 必须同步返回，且 content script 读扩展资源要经过 `web_accessible_resources`，`_locales` 能否这样暴露并不确定
- 语言包数据源与清单的 `__MSG_key__` 共用同一份文件，不存在两套文案

代码里一律用 `t('key')`，**不写中文字面量**；HTML 里的静态文案用 `data-i18n` / `data-i18n-title` / `data-i18n-label` / `data-i18n-placeholder` 标记，由 popup 启动时统一填充。

**加一种新语言**只需改三处：`src/_locales/<code>/messages.json`（复制 `zh_CN`，它带 `description`）、`src/shared/i18n.ts` 的 `Locale`/`LOCALES`/`TABLES`、`popup.html` 的下拉项。`settings.ts` 用 `LOCALES.includes()` 校验，无需改动。

语言包与图标的**源码在 `src/` 下**（与代码同一棵树），构建时由 `build.mjs` 复制到各目标的扩展根，产物里的目录名仍是浏览器约定的 `_locales/` 与 `icons/`。

给翻译贡献者的详细说明见 [TRANSLATING.md](./TRANSLATING.md)。

---

## 已知限制

- **只读**：不修改任何文件。任务列表复选框是 `disabled` 的，勾选不会写回
- **超过 3 MB 的文件不渲染**，显示原始文本并给出提示条
- **在线文档没有「文件夹」标签页** —— 目录列表依赖 `file://` 目录索引页，这个机制在 http(s) 上不存在
- **代码高亮覆盖 16 种语言**（见 `src/render/markdown.ts` 的 `LANGS`，另有常见别名），其他语言按纯文本显示
- **不支持 YAML front matter** —— 本扩展定位是阅读**已完成**的文档；渲染不符预期时应该改源文件，而不是让阅读器去猜
- **与其他 Markdown 扩展共存可能互相干扰**：对方注入的样式会压掉 `[hidden]`（UA 样式表里 `display:none` 的对手是所有作者样式），已改用 `.md-reader-hidden` + `display:none!important` 规避；若对方抢先渲染完，本扩展会因找不到 `body > pre` 而走 SW 兜底读取原文，仍能工作
- **Mermaid 首次渲染约 1 秒延迟**（注入并解析 5.1 MB），之后浏览器缓存
- 少数依赖 `eval` 的 Mermaid 图表类型无法渲染（ISOLATED world 的取舍，见[第 7 条](#7-mermaid-拆包--按需注入--isolated-world)）
- **目录滚动高亮与所有视觉表现无法自动化测试**，见[测试](#测试)

---

## 协作约定

- **注释、提交信息、文档一律用中文**
- **不要自作主张 `git push`** —— 完成一个改动就本地提交，推送时机由用户掌握（这个仓库的用途是私人备份，不是对外协作）
- **类型检查 / 测试 / 构建由助手负责；视觉、布局、交互手感的验证必须由用户在实际浏览器里完成**（测试跑在 jsdom 里，看不到样式与布局）
- 提交前跑 `npm run check`；改了 `src/_locales/` 再跑一次 `npm run locales`
- 换行统一 LF（`.gitattributes` 里 `* text=auto eol=lf`）
- 更细的项目约定见 [AGENTS.md](./AGENTS.md)

---

## 进一步阅读

| 想看什么 | 去哪 |
|---|---|
| 某个模块为什么这么写 | 该源文件的**头部注释**，本项目注释以「记录踩过的坑」为主 |
| 手工测试清单 | [testMd/00-索引.md](./testMd/00-索引.md) |
| 翻译指南 | [TRANSLATING.md](./TRANSLATING.md) |
| 商店上架文案 | `docs/商店文案.md` |
| 首屏性能 | 控制台 `__mdReaderPerf`、Performance 面板的 `md-reader:` 标记 |
