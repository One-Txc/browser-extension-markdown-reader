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
import { setupSourceView } from './render/source-view';
import {
  DEFAULT_SETTINGS,
  clampTocWidth,
  loadSettings,
  saveSettings,
  type ReaderSettings,
} from './shared/settings';
import {
  DONE_ATTR,
  ROOT_CLASS,
  ensureDocumentElement,
  isMarkdownPage,
  titleFromPath,
} from './shared/const';

/** 超过此长度不做渲染，避免超大文件卡死标签页 */
const MAX_RENDER_LENGTH = 3 * 1024 * 1024;

async function main(): Promise<void> {
  if (!isMarkdownPage()) return;

  const html = await ensureDocumentElement();

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

  try {
    const raw = await readSource();
    if (!raw || !raw.trim()) return; // 读不到就原样保留，什么都不做

    if (raw.length > MAX_RENDER_LENGTH) {
      renderTooLargeNotice(raw.length);
      return;
    }

    const main = document.createElement('main');
    main.className = `markdown-body ${ROOT_CLASS}`;
    main.innerHTML = renderMarkdown(raw, location.href);

    document.body.replaceChildren(main);
    document.body.classList.add('md-reader-body');

    // 先记录容器，目录与主题都依赖它
    mainEl = main;

    currentSettings = await loadSettings();
    applyTheme(document, currentSettings);
    syncToc(currentSettings);

    // 只在文档真的含公式时才付出 KaTeX 样式的注入成本
    if (main.querySelector('.katex')) injectKatexCss(document);

    // Mermaid 体积很大，只在真的出现 ```mermaid 时才请求注入
    if (main.querySelector('.md-reader-mermaid')) void requestMermaid();

    document.title = titleFromPath();
    enhanceCodeBlocks(main);
    setupImageZoom(main);
    // 原文 / 渲染视图切换。句柄只在页面卸载时才有意义，这里不需要保留
    setupSourceView(main, raw);
    applyInitialHash();
  } catch (err) {
    // 渲染失败时保留 Chrome 原始纯文本视图，绝不留下白屏
    console.error('[MD Reader] 渲染失败，已保留原始文本视图：', err);
  } finally {
    html.style.visibility = prevVisibility;
  }
}

/* -------------------------------------------------------------- 主题与目录 */

/** 已渲染的正文容器，目录重建时复用 */
let mainEl: HTMLElement | null = null;
let tocHandle: TocHandle | null = null;
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
};

/**
 * 同步目录的挂载与可见性。
 *
 * 目录只挂载一次，显示/隐藏走 body class ——
 * 反复销毁重建会让滚动高亮状态和目录滚动位置丢失。
 */
function syncToc(settings: ReaderSettings): void {
  if (!mainEl) return;

  if (!tocHandle) {
    tocHandle = mountToc(mainEl, tocHandlers);
  }

  document.body.classList.toggle('md-reader-has-toc', settings.showToc);
  applyTocWidth(settings.tocWidth);
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
async function readSource(): Promise<string | null> {
  const fromDom = await waitForSourceText();

  // DOM 文本干净就直接用；若出现大量替换字符，说明 Chrome 用错了编码
  // （典型场景：GBK 编码的 .md 被按 UTF-8 解码），改由 SW 按原始字节重新嗅探。
  // 见 testMd/09-GBK编码测试.md
  if (fromDom && !looksMisdecoded(fromDom)) return fromDom;

  try {
    const res = (await chrome.runtime.sendMessage({
      type: 'read-file',
      url: location.href,
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
