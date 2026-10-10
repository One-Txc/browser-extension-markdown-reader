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
  ensureDocumentElement,
  isMarkdownPage,
  titleFromUrl,
} from './shared/const';
import { mountFolderPane, type FolderPaneHandle } from './render/folder';

/** 超过此长度不做渲染，避免超大文件卡死标签页 */
const MAX_RENDER_LENGTH = 3 * 1024 * 1024;

async function main(): Promise<void> {
  if (!isMarkdownPage()) return;

  const html = await ensureDocumentElement();
  markPerf('dom-ready');

  // 幂等：刷新或与其它 Markdown 扩展共存时不重复处理
  if (html.hasAttribute(DONE_ATTR)) return;
  html.setAttribute(DONE_ATTR, '1');

  registerSettingsListeners();

  // content script 能跑起来 = 文件访问权限已开。上报给 SW 供 popup 显示状态。
  // M0 证实 chrome.extension.isAllowedFileSchemeAccess 在 content script 中不可用。
  try {
    chrome.runtime.sendMessage({ type: 'file-access-proven' })?.catch(() => {});
  } catch {
    /* 忽略：上报失败不影响渲染 */
  }

  const prevVisibility = html.style.visibility;
  html.style.visibility = 'hidden';
  markPerf('hidden');

  /*
   * 设置读取与内容读取互不依赖，一开始就并行发起。
   * chrome.storage.sync 的冷读实测可达上百毫秒（表现为 themed 阶段的剧烈波动），
   * 串行等待等于把这笔开销直接加在首屏上。
   */
  const settingsPromise = loadSettings().then((value) => {
    markPerf('settings-loaded');
    return value;
  });

  try {
    const raw = await readSource(currentDocUrl);
    markPerf('source-read');
    if (!raw || !raw.trim()) return; // 读不到就原样保留，什么都不做

    if (raw.length > MAX_RENDER_LENGTH) {
      renderTooLargeNotice(raw.length);
      return;
    }

    const settings = await settingsPromise;
    renderDocument(raw, currentDocUrl, settings);
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
    // 首次：清掉 Chrome 原始的 <pre> 文本视图
    document.body.replaceChildren(main);
  }
  document.body.classList.add('md-reader-body');
  markPerf('dom-swapped');

  // 先记录容器，目录与主题都依赖它
  mainEl = main;
  currentSettings = settings;
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
    document.body.classList.toggle('md-reader-has-toc', visible);
    void persistSettings({ showToc: visible });
  },
  /*
   * 「文件夹」面板。懒创建 —— 只有真正渲染侧边栏时才会调到这里，
   * 而且面板内部的数据请求本身也是懒的（展开子目录才取）。
   *
   * onOpen 走「原地打开」：点文档不跳 URL，只换正文。
   * 需要真实跳转时用每行右侧的跳转图标（默认新标签页打开）。
   */
  createFolderPane: () => {
    folderHandle = mountFolderPane({
      // 用最初打开的文档，而不是 currentDocUrl —— 根目录不该随切换而变
      documentUrl: baseDocUrl,
      getPrefs: () => ({
        sortField: currentSettings.folderSortField,
        sortAsc: currentSettings.folderSortAsc,
        foldersFirst: currentSettings.folderFoldersFirst,
        showHidden: currentSettings.folderShowHidden,
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
  currentSettings = settings;
  applyTheme(document, settings);
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
   * 只有当页面地址确实就是这份文档时才从 DOM 读 ——
   * 原地切换文档后地址栏没变、DOM 里已经是另一份内容，此时必须走 SW。
   */
  const isCurrentPage = url === location.href.split('#')[0].split('?')[0];
  const fromDom = isCurrentPage ? await waitForSourceText() : null;

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
    btn.textContent = '复制';

    btn.addEventListener('click', async () => {
      const code = pre.querySelector('code')?.textContent ?? '';
      try {
        await navigator.clipboard.writeText(code);
        btn.textContent = '已复制';
      } catch {
        btn.textContent = '复制失败';
      }
      btn.classList.add('done');
      setTimeout(() => {
        btn.textContent = '复制';
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
  bar.textContent = `MD Reader：文件过大（${mb} MB），已跳过渲染，显示原始文本。`;
  document.documentElement.appendChild(bar);
}

main();
