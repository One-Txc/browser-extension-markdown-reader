/**
 * MD Reader —— content script 主流程（M1）
 *
 * 依据 M0 实测结论实现：
 *   1. file:// 下的 .md 会被 Chrome 渲染成 text/markdown 纯文本页面
 *   2. 原文位于 <body><pre>…</pre></body>（body 唯一子元素）
 *   3. 页面 URL 全程不变 → 相对图片、md 互链、锚点全部天然可用，无需重写
 *   4. Service Worker 可以 fetch(file://)，作为编码兜底与异常回退
 *
 * 设计红线：
 *   - 绝不用 document.write（会清空文档、丢 URL 语义、时序上容易白屏）
 *   - 隐藏页面必须与恢复成对出现（try/finally），任何异常都不能把页面留成白纸
 *   - 不依赖 chrome.extension.isAllowedFileSchemeAccess —— M0 实测该 API 在
 *     content script 中不存在，改用「注入成功即上报」的方式证明权限
 */

import { renderMarkdown } from './render/markdown';
import { applyTheme, injectKatexCss } from './render/styles';
import { mountToc, type TocHandle, type TocHandlers } from './render/toc';
import { setupImageZoom } from './render/lightbox';
import { setupSourceView, type SourceViewHandle } from './render/source-view';
import {
  DEFAULT_SETTINGS,
  clampTocWidth,
  loadSettings,
  saveSettings,
  type ReaderSettings,
} from './shared/settings';
import { markPerf, publishPerf } from './shared/perf';
import {
  DONE_ATTR,
  ROOT_CLASS,
  effectiveExtensions,
  ensureDocumentElement,
  hasExtension,
  isMarkdownMime,
  mayBeMarkdownPage,
  titleFromUrl,
} from './shared/const';
import { mountFolderPane, type FolderPaneHandle } from './render/folder';
import { mountSettingsButton } from './render/settings-button';
import { setLocale, t } from './shared/i18n';

/** 超过此长度不做渲染，避免超大文件卡死标签页 */
const MAX_RENDER_LENGTH = 3 * 1024 * 1024;

async function main(): Promise<void> {
  /*
   * 同步初判。必须是同步的 —— 后面要据此决定是否先隐藏页面防闪烁，
   * 而设置是异步读的，此刻还拿不到用户自定义的扩展名。
   * 所以这一步只排除明显无关的页面（普通网页、无扩展名的纯文本接口）。
   */
  if (!mayBeMarkdownPage()) return;

  const html = await ensureDocumentElement();
  markPerf('dom-ready');

  // 幂等：刷新或与其它 Markdown 扩展共存时不重复处理
  if (html.hasAttribute(DONE_ATTR)) return;
  html.setAttribute(DONE_ATTR, '1');

  registerSettingsListeners();

  /*
   * 右上角的设置按钮。它不依赖文档内容，所以尽早挂上 ——
   * 万一渲染失败（页面停在纯文本），用户至少还能从这里改设置。
   *
   * 不 await：它内部会等 <body> 出现，而此刻 body 可能还不存在，
   * 等在这里会把首屏渲染也一起拖住。
   */
  void mountSettingsButton();

  // content script 能跑起来 = 文件访问权限已开。上报给 SW 供 popup 显示状态。
  // M0 证实 chrome.extension.isAllowedFileSchemeAccess 在 content script 中不可用。
  try {
    chrome.runtime.sendMessage({ type: 'file-access-proven' })?.catch(() => {});
  } catch {
    /* 忽略：上报失败不影响渲染 */
  }

  /*
   * 无条件先隐藏，防纯文本闪烁。
   *
   * ★ 隐藏之后、进入 try 之前**不能有任何可能抛异常的代码** ——
   * 否则 finally 不会执行，页面会永久停在 hidden（白屏）。
   * 曾经把 `await settingsPromise` 放在这个位置，就是这样翻车的。
   * 所有需要 await 与判断的逻辑都放进下面的 try 里。
   */
  const prevVisibility = html.style.visibility;
  html.style.visibility = 'hidden';
  markPerf('hidden');

  const settingsPromise = loadSettings().then((value) => {
    markPerf('settings-loaded');
    return value;
  });

  try {
    /*
     * 扩展名判定。自定义后缀只能等设置读完才知道，所以这里必然有一次 await；
     * 不匹配就 return —— 它落在 try 内，finally 会把可见性还原回去。
     */
    const settingsNow = await settingsPromise;
    const extensions = effectiveExtensions(settingsNow.extraExtensions);
    if (!isMarkdownMime() && !hasExtension(location.pathname, extensions)) return;

    const raw = await readSource(currentDocUrl);
    markPerf('source-read');
    if (!raw || !raw.trim()) return; // 读不到就原样保留，什么都不做

    if (raw.length > MAX_RENDER_LENGTH) {
      renderTooLargeNotice(raw.length);
      return;
    }

    // 语言要在渲染之前定好：渲染过程中就会通过 t() 取文案
    setLocale(settingsNow.locale);
    renderDocument(raw, currentDocUrl, settingsNow);
    // hash 只在首次加载时处理；原地切换文档后地址栏已不代表正文，跳了反而错
    applyInitialHash();
  } catch (err) {
    // 渲染失败时保留 Chrome 原始纯文本视图，绝不留下白屏
    console.error('[MD Reader] 渲染失败，已保留原始文本视图：', err);
  } finally {
    html.style.visibility = prevVisibility;
    // 恢复可见即用户看到内容，这一刻就是白屏的结束点
    markPerf('visible');
    publishPerf();
  }
}

/**
 * 把一份 Markdown 渲染进页面。
 *
 * ★ 首次加载与「原地切换文档」都走这里。后者要求**不改变 URL**，
 * 所以整个渲染必须由参数驱动，不能再去读 location。
 */
function renderDocument(raw: string, url: string, settings: ReaderSettings): void {
  const main = document.createElement('main');
  main.className = `markdown-body ${ROOT_CLASS}`;
  // base 用目标文档的 URL：相对图片路径必须按它的位置解析，而不是页面地址
  main.innerHTML = renderMarkdown(raw, url);
  markPerf('rendered');

  /*
   * ★ 只替换正文，绝不动 body 的其它子节点。
   *
   * 侧边栏（nav）、拖拽手柄、目录开关按钮都挂在 body 上 ——
   * 早先这里用 replaceChildren(main) 清空整个 body，首次加载没问题
   * （那时侧边栏还没建），但切换文档时会把侧边栏一起删掉。
   */
  if (mainEl?.parentNode) {
    mainEl.replaceWith(main);
  } else {
    /*
     * 首次加载：只移除 Chrome 原始的 <pre> 文本视图。
     *
     * ★ 不要用 document.body.replaceChildren(main) —— 那会清空 body 上
     * 所有其它元素，包括右上角的设置按钮。而挂按钮是异步的
     * （要等 ensureBody、要等模块加载），与这里存在竞态：
     * 按钮先挂上就被删掉、后挂上才留下，表现为「刷新后按钮有时消失」。
     */
    document.querySelectorAll('body > pre').forEach((el) => el.remove());
    document.body.append(main);
  }
  document.body.classList.add('md-reader-body');
  markPerf('dom-swapped');

  // 先记录容器，目录与主题都依赖它
  mainEl = main;
  currentSettings = settings;
  // 留一份原文：切换语言时要靠它把整份内容重建一遍
  currentRaw = raw;
  applyTheme(document, settings);
  markPerf('themed');

  /*
   * 目录树依据正文标题建立，换文档必须重建 —— 但**只重建它的内容**，
   * nav（含 tab 条与文件夹面板）保持不动。
   *
   * 早先是销毁整个侧边栏再重建，后果有三个：文件夹 tab 会闪一下、
   * 它的展开状态与设置面板全部丢失、根目录还会跟着新文档跑到子目录去。
   */
  if (tocHandle) {
    tocHandle.setRoot(main);
    // 标题数量变了，折叠策略要重新判断（策略串置空以强制应用一次）
    lastFoldPolicy = '';
    applyFoldPolicy(settings);
    // 原地切换后文件夹面板里的高亮要跟着走（根目录刻意保持不变）
    folderHandle?.setCurrent(url);
  } else {
    syncToc(settings);
  }
  markPerf('toc');

  // 只在文档真的含公式时才付出 KaTeX 样式的注入成本
  if (main.querySelector('.katex')) void injectKatexCss(document);

  // Mermaid 体积很大，只在真的出现 ```mermaid 时才请求注入
  if (main.querySelector('.md-reader-mermaid')) void requestMermaid();

  document.title = titleFromUrl(url);
  enhanceCodeBlocks(main);
  setupImageZoom(main);

  /*
   * 原文 / 渲染视图切换。
   * 它会把面板与按钮 append 到 body 上，切换文档时必须先销毁旧的，
   * 否则每换一次文档就多留一份在页面里。
   */
  sourceViewHandle?.destroy();
  sourceViewHandle = setupSourceView(main, raw);
  applyFavicon();
}

/**
 * 把标签页图标换成本扩展的图标。
 *
 * 渲染之前，Chrome 给 file:// 页面用的是通用文件图标，在线页面则是站点自己的
 * favicon；既然这份内容已经被我们渲染成 Markdown 了，标签页上挂本扩展的图标更合适。
 *
 * 两个要点：
 *   - 先清掉页面原有的 icon 链接，否则浏览器可能仍沿用旧的那个；
 *   - 读取 chrome-extension:// 资源需要 icons/* 出现在清单的
 *     web_accessible_resources 里，没声明会被拒绝。
 *
 * 用 rel~="icon" 而不是精确匹配：它同时覆盖 rel="icon" 与 rel="shortcut icon"。
 */
function applyFavicon(): void {
  const head = document.head;
  if (!head) return;

  for (const el of head.querySelectorAll('link[rel~="icon"]')) el.remove();

  const link = document.createElement('link');
  link.rel = 'icon';
  link.type = 'image/png';
  link.href = chrome.runtime.getURL('icons/icon48.png');
  head.append(link);
}

/**
 * 原地打开另一个文档：读内容 → 重新渲染，**不改变 URL**。
 *
 * 这样做的好处是切换文档时侧边栏状态、展开的目录、滚动习惯都不会丢，
 * 也不产生历史记录。
 *
 * 代价是地址栏不再代表正在显示的内容 —— 所以文件夹面板给每一项都配了
 * 「跳转」图标，需要真实 URL（分享、收藏、刷新）时走那个出口。
 */
async function openInPlace(url: string): Promise<void> {
  if (url === currentDocUrl) return;

  const raw = await readSource(url);
  if (!raw || !raw.trim()) return;

  currentDocUrl = url;
  renderDocument(raw, url, currentSettings);
  folderHandle?.setCurrent(url);
  window.scrollTo({ top: 0 });
}

/* -------------------------------------------------------------- 主题与目录 */

/** 已渲染的正文容器，目录重建时复用 */
let mainEl: HTMLElement | null = null;
/**
 * 用户**最初打开**的那个文档（去掉 hash/query）。
 *
 * 文件夹面板的根目录永远以它为准：原地切换文档后不该跟着跑 ——
 * 点了子目录里的文档，用户期望的仍然是「我打开文档时所在的那个目录」。
 */
const baseDocUrl = location.href.split('#')[0].split('?')[0];

/**
 * 当前**正在显示**的文档 URL。
 *
 * 原地切换文档时它会被更新，而 location.href 保持不变 ——
 * 所有与「内容」相关的判断都要用这个，而不是读地址栏。
 */
let currentDocUrl = baseDocUrl;
let tocHandle: TocHandle | null = null;
/** 「文件夹」面板；随 toc 的 nav 一起挂载，销毁时由 nav 一并移除 */
let folderHandle: FolderPaneHandle | null = null;
/**
 * 原文视图的句柄。
 * 它持有的面板与按钮挂在 body 上，切换文档时要先销毁旧的再建新的。
 */
let sourceViewHandle: SourceViewHandle | null = null;
/** 设置的内存副本，避免每次交互都读一次 storage */
let currentSettings: ReaderSettings = DEFAULT_SETTINGS;

/**
 * 当前正文的 Markdown 原文。
 *
 * 切换语言时要重建整份内容才能让文案换过来（原因见 refreshFromSettings），
 * 而重建需要原文，所以留一份。
 */
let currentRaw = '';

/** 合并写入设置并同步内存副本 */
async function persistSettings(partial: Partial<ReaderSettings>): Promise<void> {
  currentSettings = { ...currentSettings, ...partial };
  await saveSettings(currentSettings);
}

/**
 * 应用目录宽度。
 * 写在 documentElement 的内联样式上，优先级高于注入样式表里的默认值，
 * 因此拖拽时可以实时生效，且不会被后续的主题重注入覆盖。
 */
function applyTocWidth(width: number): void {
  document.documentElement.style.setProperty('--md-toc-width', `${clampTocWidth(width)}px`);
}

/** 目录的交互回调，交给 toc.ts 使用 */
const tocHandlers: TocHandlers = {
  getWidth: () => currentSettings.tocWidth,
  setWidth: (width, commit) => {
    applyTocWidth(width);
    // 拖拽过程中只改样式，松手才落盘，避免高频写 storage
    if (commit) void persistSettings({ tocWidth: clampTocWidth(width) });
  },
  setVisible: (visible) => {
    /*
     * ★ 只切换当前页面的显示状态，**不写入设置**。
     *
     * 左上角那个按钮是「临时让开视线」用的开关；持久化的入口在设置弹窗里。
     * 早先这里会落盘，结果是用户随手点一下隐藏，下次打开所有文档都不见了侧边栏，
     * 而他又不知道是哪里改的 —— 临时操作不该产生永久副作用。
     */
    document.body.classList.toggle('md-reader-has-toc', visible);
  },
  /*
   * 「文件夹」面板。懒创建 —— 只有真正渲染侧边栏时才会调到这里，
   * 而且面板内部的数据请求本身也是懒的（展开子目录才取）。
   *
   * onOpen 走「原地打开」：点文档不跳 URL，只换正文。
   * 需要真实跳转时用每行右侧的跳转图标（默认新标签页打开）。
   */
  createFolderPane: () => {
    /*
     * 在线文档不提供「文件夹」面板。
     *
     * 目录列表靠的是 Chrome 为 file:// 目录 URL 生成的索引页（见 shared/directory.ts），
     * 这个机制在 http(s) 上不存在；硬做只能靠网页抓取猜目录结构，不可靠。
     * 返回 null，toc.ts 就只渲染「大纲」一个标签页 —— 按钮条不会出现第二个空标签。
     */
    if (!baseDocUrl.startsWith('file:')) return null;

    folderHandle = mountFolderPane({
      // 用最初打开的文档，而不是 currentDocUrl —— 根目录不该随切换而变
      documentUrl: baseDocUrl,
      getPrefs: () => ({
        sortField: currentSettings.folderSortField,
        sortAsc: currentSettings.folderSortAsc,
        foldersFirst: currentSettings.folderFoldersFirst,
        showHidden: currentSettings.folderShowHidden,
        settingsOpen: currentSettings.folderSettingsOpen,
        // 用户在设置里追加的后缀，要在文件夹列表里一并生效
        extensions: effectiveExtensions(currentSettings.extraExtensions),
      }),
      /*
       * 面板偏好的键名与设置里的键名不同（前者面向面板，后者面向存储），
       * 这里做一次显式映射，避免两处命名被迫耦合。
       */
      setPrefs: (patch) => {
        const next: Partial<ReaderSettings> = {};
        if (patch.sortField !== undefined) next.folderSortField = patch.sortField;
        if (patch.sortAsc !== undefined) next.folderSortAsc = patch.sortAsc;
        if (patch.foldersFirst !== undefined) next.folderFoldersFirst = patch.foldersFirst;
        if (patch.showHidden !== undefined) next.folderShowHidden = patch.showHidden;
        if (patch.settingsOpen !== undefined) next.folderSettingsOpen = patch.settingsOpen;

        currentSettings = { ...currentSettings, ...next };
        void persistSettings(next);
      },
      onOpen: (url) => void openInPlace(url),
    });
    return folderHandle.element;
  },
};

/**
 * 同步目录的挂载与可见性。
 *
 * 目录只挂载一次，显示/隐藏走 body class ——
 * 反复销毁重建会让滚动高亮状态和目录滚动位置丢失。
 */
/**
 * 上一次生效的折叠策略（是否启用 + 默认展开层数）。
 *
 * 存在的原因：syncToc 会在任何设置变化时被调用，包括改字号、换配色这些
 * 与目录无关的改动。若每次都按默认层级重置展开状态，用户手动折叠好的目录
 * 会被反复冲掉。只有策略本身变了才重新套用。
 */
let lastFoldPolicy = '';

function syncToc(settings: ReaderSettings): void {
  if (!mainEl) return;

  if (!tocHandle) {
    tocHandle = mountToc(mainEl, tocHandlers);
  }

  document.body.classList.toggle('md-reader-has-toc', settings.showToc);
  applyTocWidth(settings.tocWidth);
  applyFoldPolicy(settings);
}

/**
 * 按阈值与层数应用折叠策略。
 *
 * 策略没变就不动展开状态 —— 否则改字号、换配色这些无关设置
 * 也会把用户手动折叠好的目录冲掉。
 */
function applyFoldPolicy(settings: ReaderSettings): void {
  if (!tocHandle) return;

  const enabled = settings.foldThreshold <= 0 || tocHandle.count > settings.foldThreshold;
  const policy = `${enabled}|${settings.defaultExpandLevel}`;
  if (policy === lastFoldPolicy) return;
  lastFoldPolicy = policy;

  tocHandle.setFoldEnabled(enabled);
  if (enabled) tocHandle.expandToLevel(settings.defaultExpandLevel);
}

async function refreshFromSettings(): Promise<void> {
  const settings = await loadSettings();
  const localeChanged = settings.locale !== currentSettings.locale;
  /*
   * 扩展名列表变了要重取目录内容。
   *
   * 文件夹面板里的条目是上次 pull 回来的，列表本身不会自己更新 ——
   * 用户在设置里把 txt 加进支持列表后，若不重新拉取，那些 .txt 依旧不显示，
   * 看起来就像设置没生效。
   */
  const extensionsChanged = settings.extraExtensions !== currentSettings.extraExtensions;
  currentSettings = settings;
  setLocale(settings.locale);
  applyTheme(document, settings);

  if (localeChanged && mainEl && currentRaw) {
    /*
     * 语言变了 → 重建整份内容。
     *
     * 文案是在**创建 DOM 的那一刻**一次性 t() 出来的，已有的文本节点不会
     * 重新求值（样式能「活」是因为它走 CSS 变量与 class，文本不行）。
     * 所以要覆盖新文案就只能重建：侧边栏 tab 名、文件夹面板、各处 tooltip、
     * 以及代码块上那排复制按钮。
     *
     * 顺序要紧：先销毁侧边栏句柄 —— renderDocument 对已存在的 tocHandle
     * 只调 setRoot（不重建 nav），不先销毁的话 tab 名之类的文案留在原处。
     * tab 选择由 toc.ts 的模块级 lastActivePane 自动恢复，
     * 但文件夹面板的展开状态与目录折叠状态会重置，语言切换是低频操作，可以接受。
     */
    tocHandle?.destroy();
    tocHandle = null;
    folderHandle = null;
    lastFoldPolicy = '';
    renderDocument(currentRaw, currentDocUrl, settings);
    return;
  }

  if (extensionsChanged) folderHandle?.reload();

  syncToc(settings);
}

/**
 * 请求 Service Worker 按需注入 Mermaid bundle。
 * 注入后由 mermaid-entry.ts 自己扫描并渲染 .md-reader-mermaid 容器。
 */
async function requestMermaid(): Promise<void> {
  try {
    const res = (await chrome.runtime.sendMessage({ type: 'render-mermaid' })) as
      | { ok: boolean; error?: string }
      | undefined;
    if (!res?.ok) console.warn('[MD Reader] Mermaid 未渲染：', res?.error);
  } catch (err) {
    console.warn('[MD Reader] 请求 Mermaid 渲染失败：', err);
  }
}

/**
 * 注册设置变更的即时响应。
 * 只替换 <style> 内容与目录节点，不重新渲染 Markdown —— 改配色/字号是瞬时生效的。
 */
function registerSettingsListeners(): void {
  // popup 里改了设置
  chrome.runtime.onMessage.addListener((msg: { type?: string }) => {
    if (msg?.type === 'settings-changed') {
      void refreshFromSettings();
    }
  });

  // 跟随系统模式下，系统在深浅色之间切换
  try {
    window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', async () => {
      const settings = await loadSettings();
      if (settings.mode === 'auto') applyTheme(document, settings);
    });
  } catch {
    /* 老环境不支持 addEventListener 形式，忽略 */
  }
}

/* ------------------------------------------------------------------ 读取 */

/**
 * 取 Markdown 原文。
 * 首选从 DOM 直接读（零延迟、零权限依赖）；失败才回退到 SW fetch
 * （该路径还能顺带处理 GBK 等非 UTF-8 编码）。
 */
async function readSource(url: string): Promise<string | null> {
  /*
   * 只有「页面地址就是这份文档」**并且**「页面还没被我们渲染过」时才从 DOM 读。
   *
   * ★ 两个条件缺一不可。早先只看了 URL，于是出现这个 bug：
   * 打开 A → 点 B（正常）→ 再点回 A 时，A 与地址栏相同，
   * 于是又去等 body > pre；可此时 DOM 里早就是渲染后的 main 了，
   * 那个 <pre> 永远不会出现，只能干等到 3 秒超时才回退到 SW ——
   * 用户看到的就是「点了没反应」。
   *
   * mainEl 非空即表示渲染已完成，此时 DOM 里的内容不再是原文，
   * 直接走 SW 才既正确又快。
   */
  const isCurrentPage = url === location.href.split('#')[0].split('?')[0];
  const fromDom = isCurrentPage && !mainEl ? await waitForSourceText() : null;

  // DOM 文本干净就直接用；若出现大量替换字符，说明 Chrome 用错了编码
  // （典型场景：GBK 编码的 .md 被按 UTF-8 解码），改由 SW 按原始字节重新嗅探。
  // 见 testMd/09-GBK编码测试.md
  if (fromDom && !looksMisdecoded(fromDom)) return fromDom;

  try {
    const res = (await chrome.runtime.sendMessage({
      type: 'read-file',
      url,
    })) as { ok: boolean; text?: string; error?: string } | undefined;

    if (res?.ok && res.text) return res.text;
    console.warn('[MD Reader] SW 兜底读取失败：', res?.error);
  } catch (err) {
    console.warn('[MD Reader] SW 兜底读取异常：', err);
  }

  // SW 也拿不到：退回 DOM 文本。宁可显示乱码，也不要整页空白。
  return fromDom;
}

/**
 * 判断文本是否疑似解码错误。
 *
 * UTF-8 解码非 UTF-8 字节序列时会产出 U+FFFD（替换字符），
 * 占比超过千分之一即可判定用错了编码。
 */
function looksMisdecoded(text: string): boolean {
  if (text.length < 20) return false;

  let bad = 0;
  for (let i = 0; i < text.length; i++) {
    if (text.charCodeAt(i) === 0xfffd) bad++;
  }
  return bad / text.length > 0.001;
}

/** 等待 Chrome 文本查看器把 <pre> 写入 DOM */
function waitForSourceText(timeout = 3000): Promise<string | null> {
  const readPre = (): string | null => {
    const pre = document.querySelector('body > pre');
    const text = pre?.textContent;
    return text && text.length > 0 ? text : null;
  };

  const immediate = readPre();
  if (immediate) return Promise.resolve(immediate);

  return new Promise<string | null>((resolve) => {
    let settled = false;

    const finish = (value: string | null): void => {
      if (settled) return;
      settled = true;
      observer.disconnect();
      clearTimeout(timer);
      clearInterval(poller);
      resolve(value);
    };

    const observer = new MutationObserver(() => {
      const text = readPre();
      if (text) finish(text);
    });
    observer.observe(document.documentElement, {
      childList: true,
      subtree: true,
      characterData: true,
    });

    const timer = setTimeout(() => finish(readPre()), timeout);

    // MutationObserver 对文件一次性写入可能来不及，加轮询兜底
    const poller = setInterval(() => {
      const text = readPre();
      if (text) finish(text);
    }, 50);
  });
}

/* ------------------------------------------------------------ DOM 增强 */

/**
 * 处理「从外部直接带锚点打开」的情况。
 *
 * 场景：地址栏打开 `file:///…/doc.md#某章节`，或从别的文档跳过来。
 * 浏览器在解析原始纯文本时就会尝试滚动到这个 id —— 那时元素还不存在，
 * 滚动失败；而 DOM 被替换后浏览器不会再重试。
 * 所以渲染完成后必须自己补一次。
 *
 * 注意：页内点击锚点链接（不重新加载）由浏览器原生处理，与此无关。
 */
function applyInitialHash(): void {
  const raw = location.hash.slice(1);
  if (!raw) return;

  let id = raw;
  try {
    id = decodeURIComponent(raw);
  } catch {
    /* 非法编码，按原样查找 */
  }

  const target = document.getElementById(id);
  if (target) {
    target.scrollIntoView({ block: 'start' });
  }
}

/** 代码块加「复制」按钮 */
function enhanceCodeBlocks(root: HTMLElement): void {
  root.querySelectorAll<HTMLPreElement>('pre:has(> code.hljs)').forEach((pre) => {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'md-reader-copy';
    btn.textContent = t('copy');

    btn.addEventListener('click', async () => {
      const code = pre.querySelector('code')?.textContent ?? '';
      try {
        await navigator.clipboard.writeText(code);
        btn.textContent = t('copied');
      } catch {
        btn.textContent = t('copyFailed');
      }
      btn.classList.add('done');
      setTimeout(() => {
        btn.textContent = t('copy');
        btn.classList.remove('done');
      }, 1500);
    });

    pre.appendChild(btn);
  });
}

/** 超大文件降级提示（不渲染，保留原始文本视图） */
function renderTooLargeNotice(size: number): void {
  const mb = (size / 1024 / 1024).toFixed(1);
  const bar = document.createElement('div');
  bar.style.cssText = [
    'position:fixed', 'left:0', 'right:0', 'top:0', 'z-index:2147483647',
    'padding:8px 14px', 'background:#fff8c5', 'border-bottom:1px solid #d4a72c',
    'font:13px/1.5 system-ui,"Segoe UI","Microsoft YaHei",sans-serif', 'color:#4d2d00',
  ].join(';');
  bar.textContent = `MD Reader: ${t('tooLarge', [mb])}`;
  document.documentElement.appendChild(bar);
}

main();
