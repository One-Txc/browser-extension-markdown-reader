# Markdown Read

在 Chrome / Edge / Firefox 里直接阅读 Markdown。打开 `file:///.../foo.md` 或一个返回 Markdown 的网址，看到的是渲染后的文档，而不是一屏纯文本。

无需本地服务、无需 Node 后端，全部在浏览器内完成。

> 面向用户的功能与用法见 [使用说明.md](./使用说明.md)，本文是开发文档。

---

## 安装（开发版）

```bash
npm install
npm run build          # Chrome / Edge（MV3）
npm run build:firefox  # Firefox（MV2）
npm run build:all      # 两个都构建
```

产物按清单版本分开，各自是一个独立的扩展根：

```
output/
├─ MV3/              ← Chrome / Edge 加载这个目录
│  ├─ manifest.json
│  └─ build/…
└─ MV2/              ← Firefox 加载这里的 manifest.json
   ├─ manifest.json
   └─ build/…
```

### Chrome / Edge

1. 地址栏打开 `chrome://extensions`
2. 右上角开启 **开发者模式**
3. 点 **加载已解压的扩展程序**，选择 **`output/MV3`** 目录
4. **关键一步**：找到「Markdown Read」→ 点「详情」→ 打开 **「允许访问文件网址」**
5. 打开任意 `.md` 文件（若已打开，按 `F5` 刷新）

### Firefox

1. 地址栏打开 `about:debugging#/runtime/this-firefox`
2. 点 **临时载入附加组件**，选择 **`output/MV2/manifest.json`**
3. **关键一步**：`about:addons` → 本扩展 → 权限 → 打开 **「访问文件 URL」**

> Firefox 目标最低要求 **128 版**。更早的版本拿不到 `scripting.executeScript`，
> Mermaid 那份按需注入的 bundle 就没有下发途径（Mozilla 把这个 MV3 API 一并回移到了 MV2）。
> 「临时载入」的扩展在 Firefox 重启后会消失，需要重新载入——开发阶段属正常。

> ⚠️ Chrome 侧第 4 步不做，扩展**完全不会生效**，而且页面上不会有任何提示——因为它根本不会被注入。
> 忘了开的话，点工具栏上的扩展图标，popup 会告诉你。

> 📦 从仓库克隆时 `testMd/10-超大文件测试.md`（3.4 MB）不入库，需要执行 `npm run testdata` 生成；
> `preview/` 与 `output/` 同样不入库，分别由 `npm run preview`、`npm run build` 生成。

---

## 为什么必须开「允许访问文件网址」

Chrome 要求扩展显式获得用户授权才能读写 `file://` 路径，manifest 里声明 `host_permissions` 不够，这是浏览器的安全设计，无法用代码绕过。

授权状态由 popup 展示。实现上没有用 `chrome.extension.isAllowedFileSchemeAccess`——**实测该 API 在 content script 中不存在**，只暴露给扩展页面。这里改用更可靠的判据：**content script 能注入进来，本身就是权限已开的证明**，注入成功后向 Service Worker 上报并落盘。

---

## 工作原理

```
打开 file:///D:/docs/a.md 或 https://example.com/a.md
   │
   ▼ 浏览器把内容当纯文本渲染：<body><pre>原文</pre></body>
   │
   ▼ content script（run_at: document_start，matches: file:// + http(s)）
      1. 判定是否接管（见下方「页面判定」）
      2. 先隐藏页面（防纯文本闪烁）
      3. 取原文：首选读 body > pre 的 textContent，失败回退 Service Worker fetch
      4. markdown-it 解析 → DOMPurify 消毒
      5. 替换 body，注入内联样式
      6. finally 恢复可见（任何异常都不会留下白屏）
   │
   ▼ 页面 URL 不变
      → 相对路径图片、md 互链、锚点、Ctrl+F、打印 全部天然可用
```

**为什么 URL 不变是关键**：页面始终是原来的地址，所以 Markdown 里的
`![](./img/a.png)` 由浏览器按原目录解析，不需要任何路径重写；点 `[其他文档](./b.md)`
会正常导航，然后 content script 再次接管。

### 页面判定

清单里的 `matches` 只能写成 `file:///*` + `http(s)://*/*` —— 在线这一档无法限定只匹配
`.md`（服务器给的 Content-Type 不一定对，URL 也未必带后缀）。所以脚本会注入到每个
http(s) 页面，**真正的筛选在运行时做**，由 `isMarkdownPage()` 分两级判断：

1. `document.contentType` 明确是 Markdown（`text/markdown` / `text/x-markdown` /
   `text/md` / `text/mkd` / `text/mdx`）→ 直接接管
2. 是 `text/plain` → **必须再看路径后缀是不是 `.md` / `.markdown` / `.mkd`**

第二级是必需的：`text/plain` 太宽泛，任何 `.txt`、任何无后缀的纯文本接口都是它。
不匹配时立刻 return，**不做任何 DOM 改动**（尤其不会隐藏页面）。

代价是安装时会出现「读取您在所有网站上的数据」这类权限提示。

---

## 开发

```bash
npm run watch           # esbuild 监听重建（Chrome 目标）
npm run build:firefox   # 构建 Firefox 目标
npm run build:all       # 两个目标都构建
npm run check           # 类型检查 + 测试 + 构建，提交前跑这个
npm run typecheck       # 仅 tsc 类型检查
npm test                # 渲染 / 目录 / 原文视图三组测试（jsdom，共 97 项断言）
npm run preview         # 生成代码高亮主题对比页（输出到 preview/）
npm run testdata        # 重新生成 testMd/ 的图片、GBK 文件与超大文件
```

改完代码后，除了重新构建，还要到 `chrome://extensions` 点一下本扩展的**刷新**按钮，然后刷新页面。

`npm test` 不需要浏览器：它用 esbuild 打包待测模块，再用 jsdom 提供 DOM，覆盖渲染管线
（标题锚点、表格、代码高亮、任务列表、XSS 清除、公式占位符回填）、目录树
（层级 class、折叠、批量档位互斥、挂载销毁）与原文视图。

> 注意 jsdom 的 `getBoundingClientRect` 恒为 0，**目录的滚动高亮测不了**，那部分需要人眼验证。
> 同理，所有视觉与布局相关的东西（配色、间距、图标）都只能在实际浏览器里确认。

### 出包

```bash
npm run release         # 构建两个目标 + 打包成 zip（默认，快）
npm run release:full    # 先跑类型检查 / 测试 / 语言包校验，再执行上面那步
```

产物落在 `output/dist/`，文件名带版本号与目标平台：

```
output/
├─ MV3/                            ← Chrome / Edge：加载这个目录
├─ MV2/                            ← Firefox：加载这里的 manifest.json
└─ dist/
   ├─ markdown-read-1.0.0-chrome.zip     ← 上传这个
   └─ markdown-read-1.0.0-firefox.zip
```

**校验默认不做**是有意的：改点文案、调个样式再出一版，不必每次都等一遍完整测试。
**上架前跑一次 `release:full`**，平时出包用 `release` 即可。

> ⚠️ 两条命令都走 `build:all`，不要图快改成只跑 `npm run build` ——
> 那样 `output/MV2` 会停在旧产物，**而它照样会被打进 zip**，
> 上传后 Firefox 用户拿到的是过时代码。这类问题在构建日志里看不出来。

版本号的唯一来源是 `scripts/build/manifest.mjs` 的 `VERSION`，`package.json` 里那份只是给 npm 看的。
**Chrome 与 Firefox 都拒绝版本号回退**，改小会被商店直接退件。

### 辅助脚本

```bash
npm run locales                       # 校验语言包：key 是否齐全、占位符是否对齐
npm run icons                         # 重新生成 icons/ 下的扩展图标
npm run screenshots                   # 把 截图/<语言>/ 里的原图裁到 16:10 并缩成商店尺寸
python scripts/tools/locales.py       # 同 npm run locales
python scripts/tools/testdata.py       # 同 npm run testdata
```

`npm run screenshots` 的输入输出约定见 [scripts/tools/screenshots.py](scripts/tools/screenshots.py) 的文件头注释。

---

## 项目结构

```
markdown_reader/
├─ output/                  # 【生成物】构建产物与打包结果都在这
│  ├─ MV3/                  # Chrome / Edge：加载这个目录
│  ├─ MV2/                  # Firefox：加载这里的 manifest.json
│  └─ dist/                 # npm run release 产出的商店上传包
├─ icons/                   # 扩展图标（由 scripts/tools/icons.py 生成）
├─ _locales/                # 语言包：zh_CN（基准）/ en / ja / ko
├─ scripts/                  # 按用途分三类，每类都有对应的 npm 入口
│  ├─ build/                 # 构建与发布
│  │  ├─ build.mjs           #   esbuild 构建（content + background + popup + mermaid）
│  │  ├─ manifest.mjs        #   清单生成：两个平台的字段差异集中在这一个文件
│  │  └─ package.py          #   把扩展根打成可上传商店的 zip
│  ├─ test/                  # 自动化测试（jsdom，无需浏览器）
│  │  ├─ render.mjs          #   渲染管线
│  │  ├─ toc.mjs             #   目录树
│  │  └─ source-view.mjs     #   原文视图
│  └─ tools/                 # 辅助脚本
│     ├─ locales.py          #   语言包校验（以 zh_CN 为基准）
│     ├─ icons.py            #   生成扩展图标
│     ├─ screenshots.py      #   商店截图：裁到 16:10 再缩放成要求尺寸
│     ├─ theme-preview.mjs   #   生成代码高亮主题对比页
│     ├─ testdata.py         #   生成测试图片 / GBK 文件 / 超大文件
│     └─ weird-filenames.py  #   生成 testMd/16-特殊文件名/ 那批特殊文件名
├─ src/
│  ├─ content.ts            # 主流程：判定 → 取原文 → 渲染 → 替换
│  ├─ background.ts         # 消息分发 + 读文件/列目录（含编码嗅探、失败重试）
│  ├─ render/
│  │  ├─ markdown.ts        # markdown-it + DOMPurify + highlight.js
│  │  ├─ math.ts            # KaTeX 数学公式（占位符方式绕开 DOMPurify）
│  │  ├─ lightbox.ts        # 图片点击放大
│  │  ├─ mermaid-entry.ts   # Mermaid 独立 bundle（按需注入）
│  │  ├─ toc.ts             # 大纲：树形构建 + 折叠 + 批量档位 + 滚动高亮
│  │  ├─ folder.ts          # 「文件夹」面板：目录列表 + 排序 + 原地切换文档
│  │  ├─ source-view.ts     # 原文 / 渲染视图切换
│  │  ├─ settings-button.ts # 右上角设置按钮
│  │  ├─ theme-catalog.ts   # 主题元数据（无 CSS，供 popup 轻量引用）
│  │  ├─ themes.ts          # 主题 id → CSS 字符串
│  │  ├─ styles.ts          # 组装并注入 <style>
│  │  └─ app.css            # 补充样式
│  ├─ popup/                # 设置面板（基本 / 高级分组）+ 权限引导
│  ├─ shared/
│  │  ├─ const.ts           # 常量、页面判定、DOM 就绪等待
│  │  ├─ directory.ts       # 目录索引解析与排序
│  │  ├─ i18n.ts            # 国际化：语言包加载与 t()
│  │  ├─ settings.ts        # 设置模型与 storage 读写
│  │  └─ perf.ts            # 首屏性能打点
│  └─ types/                # 手工补的模块类型声明
├─ testMd/                  # 手工测试文档（见 testMd/00-索引.md）
├─ preview/                 # 主题对比页、UI 预览页
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

popup 底部有 **「恢复默认设置」**，一键回到出厂配置。它是**二次确认**的：点一次进入待确认状态（按钮变黄），
再点一次才执行，3 秒无操作自动撤销——避免手滑把调好的配置清掉。

**配色**

- **颜色模式**：跟随系统 / 始终浅色 / 始终深色，另有五套护眼配色（见下）
- **浅色代码配色**：Atom One Light（默认）、Stack Overflow Light、Xcode、GitHub Light
- **深色代码配色**：Atom One Dark（默认）、GitHub Dark、Tokyo Night、Nord、Monokai

**护眼配色**在同一处下拉里，与原三项互斥（它们本质上都是浅色 / 深色的变体，
做成独立开关会出现「深色 + 羊皮纸」这种自相矛盾的组合）：

| 名称 | 页面底色 | 适用 |
|---|---|---|
| 护眼模式 | `#c7edcc` 豆沙绿 | 国内用户最熟悉 |
| 羊皮纸 | `#f7f1e1` 米黄 | 最接近纸质书 |
| 暖白 | `#faf6ee` | 只嫌纯白刺眼，变化最轻 |
| 柔灰 | `#ecebe6` | 只降对比，不改变色相 |
| 暗夜暖调 | `#1c1917` | 夜间用，比纯深色柔和 |

> ★ `github-markdown-css` 把正文颜色**硬编码**在 `.markdown-body` 上，不读任何 CSS 变量，
> 所以这几套配色不能只改变量 —— 那样只有侧边栏会变色。app.css 末尾另有一段正文覆盖规则，
> 选择器带 `[data-md-reader-eye-care]`，只对护眼配色生效（基础明暗下变量值本就与 DOC_CSS 一致，
> 多覆盖一层没有收益、反而多一份出错风险）。

想先横向对比再决定，可以打开 `preview/代码主题预览.html`——19 套主题用同一段代码并排渲染（`npm run preview` 重新生成）。

**排版**

- **字号**：小（14px）/ 中（16px）/ 大（18px）
- **正文宽度**：窄（720px）/ 中（900px）/ 宽（1120px）/ 全宽
- **侧边栏**：可开关（持久化的入口只有这里；页面上那个左上角按钮是临时开关）
- **大纲折叠阈值**：默认 25，填 0 表示始终显示折叠 UI
- **大纲显示层数**：默认显示前两层，可选显示全部 / 第一层 / 前 2–5 层

设置面板分「基本」与「高级」两组，高级默认收起。
分组状态记在设置里（`advancedOpen`），刷新后保留。

**目录行为**

- 只要有标题就生成（哪怕只有 1 个）；完全没有标题时不生成
- 滚动时高亮当前章节，点击平滑跳转并同步地址栏 `#hash`
- 宽屏（≥1280px）固定显示在**左侧**，正文自动让出空间；窄屏收成抽屉
- **拖动目录右边缘的竖线可调整宽度**（160–560 px），双击恢复默认，宽度记入设置
- 打印时自动隐藏

**目录折叠**

- 有子标题的条目左侧有 `▾` 三角，点击单独折叠 / 展开
- 目录顶部有批量按钮（`全部` `第一层` `前两层` `前三层`），点哪个就显示到哪一层
- **这几个按钮是互斥的**：点击即把大纲整体设成那一档，当前生效的那个高亮。
  早前是「各自切换」的语义，结果写着「显示前两层」却在已展开时点成了收起 ——
  文案与行为对不上，容易点错
- **档位取相对层数而非标题的绝对级别**：文档若从 H2 起头，第一个层级按钮仍是
  「第一层」。按绝对级别写成「H2」就与「第一层」对不上了
- **档位只覆盖文档中实际出现且有子标题的层级**：某层一个子标题都没有时，
  为它生成的档位与上一档效果完全相同，白白多占一格
- 缩进来自**嵌套深度**而非标题的绝对层级，所以文档直接从 H2 起头时不会多出一级缩进
- **折叠功能有启用阈值**：目录项数量超过阈值时，才显示折叠箭头与批量按钮。
  默认 25，可在 popup 里调整，填 0 表示始终显示——短文档一屏就能看完，多一排按钮反而是噪音
- **显示层数可配置**：默认显示前两层，可选显示全部 / 第一层 / 前 2–5 层。
  它只决定**初始**状态——改字号、换配色等无关设置不会覆盖你手动折叠的结果
- 按钮放不下时**整排折行**，而不是把按钮压窄、把文字挤成两行（`flex-wrap` +
  `min-width: max-content`）

> 目录在原文视图下仍然显示，但只用于了解结构：链接被设为不可点击，点击不跳转。
> 折叠功能在该视图下依然可用——了解结构恰恰是最需要折叠的场景。

**浮动按钮**

| 位置 | 作用 |
|---|---|
| 左上角「面板轮廓」 | 显示 / 隐藏侧边栏。**只对当前页面生效，不落盘**——左上角那个是临时开关，持久化入口在设置里 |
| 右上角 `</>` | 切换原始 Markdown 与渲染视图 |
| 右上角「齿轮」 | 打开设置面板 |

三个按钮默认半透明，hover 才完全显现，避免遮挡正文。

原文视图里用 `textContent` 写入内容，不经过 `innerHTML` —— 展示源码不能成为新的 XSS 入口。进入该视图时目录与拖拽手柄会自动收起：那时页面里没有渲染后的标题元素，目录跳转与滚动高亮都会失效，留着只会误导。

### 代码块背景为什么要单独控制

highlight.js 的浅色主题背景普遍是 `#fff` / `#fafafa`，落在白色文档上几乎看不出代码块边界（实测 GitHub 的 `#F6F8FA` 对 `#FFFFFF` 对比度约 1.02:1）。

而如果反过来让 `github-markdown-css` 给 `pre` 的灰底生效，深色主题的背景又会被压掉——浅色文字配浅灰底，直接看不见。

所以背景统一走 CSS 变量 `--md-code-bg`，由所选主题注入：浅色统一给 `#f1f3f5`，深色沿用主题自己的深色背景。

## 侧边栏

侧边栏是两个标签页，共用一条顶部 tab 条：

| 标签页 | 内容 | 在线文档 |
|---|---|---|
| **大纲** | 文档的标题层级树 | ✅ |
| **文件夹** | 当前文档所在目录的内容 | ❌ 仅本地 |

### 文件夹面板

目录数据来自 **Chrome 为 `file://` 目录 URL 生成的索引页**：直接 `fetch` 那个目录地址，
解析响应里的 `addRow(name, url, isdir, size, size_string, date_modified, date_modified_str)` 调用。
这个机制不需要任何额外授权，细节与踩过的坑见 `src/shared/directory.ts` 的文件头。

| 行为 | 实现要点 |
|---|---|
| 懒加载 | 展开子目录时才 fetch，不预读整棵树 |
| 只显示目录与 Markdown | 其他文件过滤掉 |
| 空目录降级为叶子 | 加载后发现无可显示项，隐藏箭头且不可点 |
| 排序 | 名称 / 大小 / 修改日期，升降序；文件夹置顶的判断放在比较字段**之前**，所以升降序都能保持目录在前 |
| 原地切换文档 | 点文档只换正文、**不改 URL**（见下一节） |
| 行尾跳转图标 | `window.open` 新标签页打开真实 URL —— 原地打开后地址栏不再代表正文，需要真实链接时走这个出口 |

面板偏好（排序、置顶、显示隐藏项、设置面板展开）存进设置，刷新后保留。

### 「原地切换」的取舍

点文件夹里的文档时，正文换掉但 **URL 不变**。好处是侧边栏状态、滚动习惯都不丢，
也不产生历史记录；代价是地址栏不再代表正在显示的内容 —— 所以每行配了跳转图标。

实现上维护两个 URL：

| | 含义 |
|---|---|
| `baseDocUrl` | 用户**最初打开**的文档，文件夹面板的根目录永远以它为准，全程不变 |
| `currentDocUrl` | **正在显示**的文档，切换时更新 |

所有与「内容」相关的判断都必须用后者，不能读地址栏。

> 切换文档时**只重建大纲树的内容**（`tocHandle.setRoot()`），nav 与文件夹面板原地不动。
> 早前是销毁整个 nav 再重建，后果有三个：文件夹 tab 会闪一下、展开状态丢失、
> 根目录还会跟着新文档跑到子目录去。

---

## 国际化

支持简体中文、英语、日语、韩语，也可跟随浏览器语言。

```bash
npm run locales    # 校验语言包（等价于 python scripts/tools/locales.py）
```

**约定：加功能时只维护 `_locales/zh_CN/messages.json`**，其他语言在明确需要时才同步。
配套机制保证这不会让其他语言出问题：

- `t()` 逐级回退：手动选定语言 → `chrome.i18n` → `zh_CN` → key 本身。
  只加中文时，其他语言界面显示中文，而不是露出 `folder_collapseAll` 这样的裸 key
- 校验脚本以 `zh_CN` 为基准：基准文件自身的结构问题（JSON 语法、`message` 缺失或为空）
  仍然报错；其他语言缺 key / 多 key / 占位符不符只列为警告，不阻塞开发
- 语言包以**静态 `import`** 引入而非运行时 fetch —— `t()` 必须同步返回，
  且 content script 读扩展资源要经过 `web_accessible_resources`，`_locales` 能否这样暴露并不确定
- 加新语言只需改 `src/shared/i18n.ts` 一处，`settings.ts` 用 `LOCALES.includes()` 校验

HTML 里的静态文案用 `data-i18n` / `data-i18n-title` / `data-i18n-label` 标记，
由 popup 的 `applyI18n()` 在启动时统一填充。给贡献者的说明见 [TRANSLATING.md](./TRANSLATING.md)。

---

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
   → background: chrome.scripting.executeScript({ files: ['build/mermaid.js'] })
   → mermaid-entry.ts 扫描容器并填充 SVG
```

**注入到默认的 ISOLATED world，不要改成 `world: 'MAIN'`。**
曾经改成 MAIN，理由是 MV3 扩展的 CSP 为 `script-src 'self'`、不允许 `eval`，
而 Mermaid 的部分图表类型会用到它；`file://` 页面自身没有 CSP，注入页面 world 就能绕开。
**那个理由只在本地成立** —— 在线页面有自己的 CSP，一旦注入 MAIN world 就得服从它，
GitHub raw 这类站点的 script-src 很严，Mermaid 会整体失败，表现为 ` ```mermaid ` 代码块
原样留在页面上。改用 ISOLATED 后对本地和在线一视同仁；代价是少数依赖 `eval` 的
图表类型渲染失败，这已有降级：保留原始代码并标注错误。

常规文档（没有图表的）完全不会加载这 5MB。

## 图片与脚注

**图片点击放大**：点击文档里的图片进入全屏预览。点击图片在 1x / 2x 间切换，滚轮连续缩放（0.5x–8x），放大后按住拖动平移，`Esc` 或点击空白关闭。

> 链接内的图片**不劫持**点击。`[![图](./a.png)](https://example.com)` 这种写法作者意图是跳转，拦下来放大就没法做图链了。

**脚注**：支持 `[^1]` 引用语法，文末自动生成脚注区，带上标数字与回跳箭头（由 `markdown-it-footnote` 提供）。

不支持 YAML front matter —— 本扩展定位是阅读**已完成**的文档；front matter 渲染不符合预期时，应当去改源文件，而不是让阅读器去猜。

## 已知限制

- **只读**：任务列表的复选框是 `disabled` 的，勾选不会写回文件
- 超过 3 MB 的文件跳过渲染，显示原始文本并给出提示
- **在线文档不提供「文件夹」面板**：目录列表依赖 Chrome 为 `file://` 目录 URL
  生成的索引页，这个机制在 http(s) 上不存在，硬做只能靠抓取网页猜结构，不可靠
- 代码高亮只覆盖 15 种常用语言，其它语言按纯文本显示
- 目录的滚动高亮依赖真实布局，无法在 jsdom 中自动化测试
- **与其它 Markdown 扩展共存时可能互相干扰**：实测对方注入的样式会压掉本扩展依赖的
  `[hidden]`（UA 样式表里 `display:none` 的对手是所有作者样式），导致切换原文视图白屏。
  已改用 `.md-reader-hidden` + `display:none!important` 规避。若对方抢先完成了渲染，
  本扩展会因找不到 `body > pre` 而走 Service Worker 兜底读取文件原文，仍能正常工作
- **Mermaid 首次渲染有约 1 秒延迟**（要注入并解析 5MB bundle），之后浏览器会缓存
- **少数依赖 `eval` 的 Mermaid 图表类型无法渲染**（见上一节，ISOLATED world 的取舍）
- 需要 Chrome 111+；Firefox 128+

---

## 路线图

- ~~**M2 体验**：侧边目录 + 滚动高亮、暗色主题（跟随系统）、字号 / 行宽调节~~ ✅
- ~~**M3 健壮**：GBK 文件端到端实测、其他 Markdown 扩展共存、异常路径加固~~ ✅
- ~~**M4 增强**：数学公式 KaTeX、Mermaid 图表、文件夹面板、护眼配色~~ ✅
- ~~**M4 国际化**：中 / 英 / 日 / 韩四语言，可手动切换~~ ✅
- ~~**M4 在线文档**：`http(s)` 上的 Markdown 也接管~~ ✅
- **M5 发布**：~~图标~~ ✅ · 商店文案 · 隐私政策 · 打包
- **M6 之后**：全文搜索、导出 HTML（PDF 暂不做）
