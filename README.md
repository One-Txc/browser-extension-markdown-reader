# MD Reader

在 Chrome 里直接阅读本地 Markdown 文件。打开 `file:///.../foo.md`，看到的是渲染后的文档，而不是一屏纯文本。

无需本地服务、无需 Node 后端，全部在浏览器内完成。

---

## 安装（开发版）

```bash
npm install
npm run build
```

然后：

1. 地址栏打开 `chrome://extensions`
2. 右上角开启 **开发者模式**
3. 点 **加载已解压的扩展程序**，选择本目录（`markdown_reader`）
4. **关键一步**：找到「MD Reader」→ 点「详情」→ 打开 **「允许访问文件网址」**
5. 打开任意 `.md` 文件（若已打开，按 `F5` 刷新）

> ⚠️ 第 4 步不做，扩展**完全不会生效**，而且页面上不会有任何提示——因为它根本不会被注入。
> 忘了开的话，点工具栏上的扩展图标，popup 会告诉你。

> 📦 从仓库克隆时 `testMd/10-超大文件测试.md`（3.4 MB）不入库，需要执行 `npm run testdata` 生成；
> `preview/` 与 `build/` 同样不入库，分别由 `npm run preview`、`npm run build` 生成。

---

## 为什么必须开「允许访问文件网址」

Chrome 要求扩展显式获得用户授权才能读写 `file://` 路径，manifest 里声明 `host_permissions` 不够，这是浏览器的安全设计，无法用代码绕过。

授权状态由 popup 展示。实现上没有用 `chrome.extension.isAllowedFileSchemeAccess`——**实测该 API 在 content script 中不存在**，只暴露给扩展页面。这里改用更可靠的判据：**content script 能注入进来，本身就是权限已开的证明**，注入成功后向 Service Worker 上报并落盘。

---

## 工作原理

```
打开 file:///D:/docs/a.md
   │
   ▼ Chrome 内置文本查看器渲染成纯文本：<body><pre>原文</pre></body>
   │
   ▼ content script（run_at: document_start，matches: file:///*）
      1. 判定：protocol=file: + 扩展名 .md + contentType 是 text/markdown 或 text/plain
      2. 先隐藏页面（防纯文本闪烁）
      3. 取原文：直接读 body > pre 的 textContent
      4. markdown-it 解析 → DOMPurify 消毒
      5. 替换 body，注入内联样式
      6. finally 恢复可见（任何异常都不会留下白屏）
   │
   ▼ 页面 URL 不变
      → 相对路径图片、md 互链、锚点、Ctrl+F、打印 全部天然可用
```

**为什么 URL 不变是关键**：页面始终是原来的 `file:///D:/docs/a.md`，所以 Markdown 里的 `![](./img/a.png)` 由浏览器按原目录解析，不需要任何路径重写；点 `[其他文档](./b.md)` 会正常导航，然后 content script 再次接管。

---

## 开发

```bash
npm run watch      # esbuild 监听重建
npm run typecheck  # tsc 类型检查
npm test           # 渲染管线 + 目录测试（jsdom，30 项断言）
npm run preview    # 生成代码高亮主题对比页（输出到 preview/）
npm run testdata   # 重新生成 testMd/ 的图片、GBK 文件与超大文件
```

改完代码后，除了重新构建，还要到 `chrome://extensions` 点一下本扩展的**刷新**按钮，然后刷新 `.md` 页面。

`npm test` 不需要浏览器：它用 esbuild 打包渲染模块和目录模块，再用 jsdom 提供 DOM，验证标题锚点、表格、代码高亮、任务列表、XSS 清除，以及目录的层级 class 与挂载销毁。

> 注意 jsdom 的 `getBoundingClientRect` 恒为 0，**目录的滚动高亮测不了**，那部分需要人眼验证。

---

## 项目结构

```
markdown_reader/
├─ manifest.json            # MV3 配置，指向 build/ 产物
├─ scripts/
│  ├─ build.mjs             # esbuild 构建（content + background + popup）
│  ├─ test-render.mjs       # 渲染管线测试
│  ├─ test-toc.mjs          # 目录构建测试
│  ├─ make-theme-preview.mjs
│  └─ make-testdata.py      # 生成测试图片 / GBK 文件 / 超大文件
├─ src/
│  ├─ content.ts            # 主流程：判定 → 取原文 → 渲染 → 替换
│  ├─ background.ts         # 权限上报 + 兜底读文件（含 GBK 编码嗅探）
│  ├─ render/
│  │  ├─ markdown.ts        # markdown-it + DOMPurify + highlight.js
│  │  ├─ math.ts            # KaTeX 数学公式（占位符方式绕开 DOMPurify）
│  │  ├─ lightbox.ts        # 图片点击放大
│  │  ├─ mermaid-entry.ts   # Mermaid 独立 bundle（按需注入）
│  │  ├─ toc.ts             # 侧边目录构建 + 滚动高亮
│  │  ├─ theme-catalog.ts   # 主题元数据（无 CSS，供 popup 轻量引用）
│  │  ├─ themes.ts          # 主题 id → CSS 字符串
│  │  ├─ styles.ts          # 组装并注入 <style>
│  │  └─ app.css            # 补充样式
│  ├─ popup/                # 配色 / 排版设置 + 权限引导
│  ├─ shared/
│  │  ├─ const.ts           # 常量与页面判定
│  │  └─ settings.ts        # 设置模型与 storage 读写
│  └─ types/                # 手工补的模块类型声明
├─ testMd/                  # 手工测试文档（见 testMd/00-索引.md）
├─ preview/                 # 主题对比页
├─ build/                   # 构建产物（Chrome 实际加载的内容）
└─ docs/技术方案.md          # 完整技术方案与实测记录
```

---

## 技术选型

| 用途 | 选型 | 说明 |
|---|---|---|
| 打包 | **esbuild** | content script 需要自包含 IIFE + CSS 转字符串，esbuild 两个 loader 就能覆盖，无需插件生态 |
| 解析 | **markdown-it** | CommonMark 兼容、渲染规则可覆写 |
| 消毒 | **DOMPurify** | `html: true` 的必要搭档，缺一不可 |
| 高亮 | **highlight.js** | 只注册 15 种常用语言，避免打入 1MB 全集 |
| 公式 | **KaTeX** | 0.19；字体只保留 woff2（260KB） |
| 图表 | **Mermaid** | 12.x；打包 5MB，独立 bundle 按需注入 |
| 样式 | **github-markdown-css** | 直接得到 GitHub 观感 |

---

## 配色与排版

点扩展图标可以在 popup 里调整，**改完立即生效，不需要刷新页面**（只替换 `<style>` 内容与目录节点，不重新渲染 Markdown）。

**配色**

- **颜色模式**：跟随系统 / 始终浅色 / 始终深色
- **浅色代码配色**：Atom One Light（默认）、Stack Overflow Light、Xcode、GitHub Light
- **深色代码配色**：Atom One Dark（默认）、GitHub Dark、Tokyo Night、Nord、Monokai

想先横向对比再决定，可以打开 `preview/代码主题预览.html`——19 套主题用同一段代码并排渲染（`npm run preview` 重新生成）。

**排版**

- **字号**：小（14px）/ 中（16px）/ 大（18px）
- **正文宽度**：窄（720px）/ 中（900px）/ 宽（1120px）/ 全宽
- **侧边目录**：可开关

**目录行为**

- 只要有标题就生成（哪怕只有 1 个）；完全没有标题时不生成
- 滚动时高亮当前章节，点击平滑跳转并同步地址栏 `#hash`
- 宽屏（≥1280px）固定显示在**左侧**，正文自动让出空间；窄屏收成抽屉
- **拖动目录右边缘的竖线可调整宽度**（160–560 px），双击恢复默认，宽度记入设置
- 打印时自动隐藏

**浮动按钮**

| 位置 | 作用 |
|---|---|
| 左上角 `☰` | 显示 / 隐藏目录。宽屏切换侧栏并记住状态；窄屏开合抽屉 |
| 右上角 `</>` | 切换原始 Markdown 与渲染视图 |

两个按钮默认半透明，hover 才完全显现，避免遮挡正文。

原文视图里用 `textContent` 写入内容，不经过 `innerHTML` —— 展示源码不能成为新的 XSS 入口。进入该视图时目录与拖拽手柄会自动收起：那时页面里没有渲染后的标题元素，目录跳转与滚动高亮都会失效，留着只会误导。

### 代码块背景为什么要单独控制

highlight.js 的浅色主题背景普遍是 `#fff` / `#fafafa`，落在白色文档上几乎看不出代码块边界（实测 GitHub 的 `#F6F8FA` 对 `#FFFFFF` 对比度约 1.02:1）。

而如果反过来让 `github-markdown-css` 给 `pre` 的灰底生效，深色主题的背景又会被压掉——浅色文字配浅灰底，直接看不见。

所以背景统一走 CSS 变量 `--md-code-bg`，由所选主题注入：浅色统一给 `#f1f3f5`，深色沿用主题自己的深色背景。

## 公式与图表

### 数学公式（KaTeX）

支持 `$行内$` 与 `$$块级$$`。含 `$5`、`$10` 这类货币写法不会被误判成公式（要求 `$` 后紧跟非空白、闭合 `$` 前非空白）。

**两个必须知道的实现细节：**

1. **字体路径必须重写。** KaTeX 的 CSS 里写的是 `url(fonts/KaTeX_*.woff2)`，这份 CSS 是内联进 `file://` 页面的，相对路径会按**用户文档所在目录**解析，必然 404、公式符号错乱。所以运行时把 URL 改写成 `chrome-extension://<id>/build/fonts/`，并在 manifest 里把字体声明为 `web_accessible_resources`。

2. **公式 HTML 不走 DOMPurify。** KaTeX 的排版完全依赖内联 `style`（`vertical-align`、`height` 等），而 DOMPurify 默认会剥掉 `style`，公式会彻底错位；直接放开 `style` 又等于允许任意 CSS 注入。做法是：markdown-it 阶段先把公式换成唯一占位符，DOMPurify 消毒完成后再把 KaTeX 的输出回填进去。

### Mermaid 图表

```` ```mermaid ```` 代码块会渲染成 SVG，支持 flowchart / sequence / class / ER / state / gantt / pie / mindmap 等。

**为什么它是个大文件。** Mermaid 打包后有 **5.0 MB**：`mermaid.core.mjs` 内部有 37 处动态 `import()`，而 content script 必须是自包含 IIFE，esbuild 无法做代码分割，只能把全部图表类型内联进来（实测即使只引 core 也是 5.01 MB）。

所以它拆成独立 bundle（`build/mermaid.js`），**只在页面真的出现 ` ```mermaid ` 时才由 Service Worker 注入**：

```
content script 发现 .md-reader-mermaid
   → sendMessage('render-mermaid')
   → background: chrome.scripting.executeScript({ files: ['build/mermaid.js'], world: 'MAIN' })
   → mermaid-entry.ts 扫描容器并填充 SVG
```

用 `world: 'MAIN'`（页面 world）而非默认的 ISOLATED，是因为 MV3 扩展 CSP 是 `script-src 'self'`，不允许 `eval` / `new Function`，而 Mermaid 的部分图表类型会用到；`file://` 页面自身没有 CSP，可以避开这个限制。

常规文档（没有图表的）完全不会加载这 5MB。

## 图片与脚注

**图片点击放大**：点击文档里的图片进入全屏预览。点击图片在 1x / 2x 间切换，滚轮连续缩放（0.5x–8x），放大后按住拖动平移，`Esc` 或点击空白关闭。

> 链接内的图片**不劫持**点击。`[![图](./a.png)](https://example.com)` 这种写法作者意图是跳转，拦下来放大就没法做图链了。

**脚注**：支持 `[^1]` 引用语法，文末自动生成脚注区，带上标数字与回跳箭头（由 `markdown-it-footnote` 提供）。

不支持 YAML front matter —— 本扩展定位是阅读**已完成**的文档；front matter 渲染不符合预期时，应当去改源文件，而不是让阅读器去猜。

## 已知限制

- 只处理 `file://` 协议下的 `.md`；`http://` 场景（本地 dev server）暂不支持
- **只读**：任务列表的复选框是 `disabled` 的，勾选不会写回文件
- 超过 3 MB 的文件跳过渲染，显示原始文本并给出提示
- 代码高亮只覆盖 15 种常用语言，其它语言按纯文本显示
- 目录的滚动高亮依赖真实布局，无法在 jsdom 中自动化测试
- **Mermaid 首次渲染有约 1 秒延迟**（要注入并解析 5MB bundle），之后浏览器会缓存
- 需要 Chrome 111+（Mermaid 注入用到了 `world: 'MAIN'`）

---

## 路线图

- ~~**M2 体验**：侧边目录 + 滚动高亮、暗色主题（跟随系统）、字号/行宽调节~~ ✅
- ~~**M4 增强（部分）**：数学公式 KaTeX、Mermaid 图表（懒加载 + 按需注入）~~ ✅
- **M3 健壮**：GBK 文件端到端实测、其他 Markdown 扩展共存、异常路径加固
- **M4 剩余**：全文搜索、导出 HTML（PDF 暂不做）
- **M5 发布**：图标、商店文案、隐私政策、打包
