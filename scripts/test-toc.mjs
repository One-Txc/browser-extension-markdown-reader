/**
 * 侧边目录构建逻辑的本地测试。
 *
 * 能测的：目录项生成、层级 class、permalink 符号剔除、无 id 标题跳过、挂载与销毁。
 * 测不了的：滚动高亮 —— 它依赖真实布局与视口，jsdom 里 getBoundingClientRect 恒为 0。
 *           那部分需要人眼验证。
 */
import { JSDOM } from 'jsdom';
import * as esbuild from 'esbuild';
import { mkdir, rm } from 'node:fs/promises';

// 独立子目录，与其它脚本隔离
const TMP = '.tmp/toc';
await rm(TMP, { recursive: true, force: true });
await mkdir(TMP, { recursive: true });

await esbuild.build({
  entryPoints: ['src/render/toc.ts'],
  outfile: `${TMP}/toc.mjs`,
  bundle: true,
  format: 'esm',
  platform: 'browser',
  target: 'es2022',
  logLevel: 'silent',
});

const dom = new JSDOM('<!doctype html><html><body></body></html>', {
  url: 'file:///D:/docs/a.md',
});
globalThis.window = dom.window;
globalThis.document = dom.window.document;
// toc.ts 里直接引用裸标识符 history，Node 环境下需要显式挂到 global
globalThis.history = dom.window.history;
// toc.ts 用 MutationObserver 盯 body 的 class 变化来决定高亮是否清空
globalThis.MutationObserver = dom.window.MutationObserver;
globalThis.requestAnimationFrame = (cb) => setTimeout(cb, 0);
// jsdom 没有 scrollIntoView，目录高亮会用到
dom.window.Element.prototype.scrollIntoView = function scrollIntoView() {};
// jsdom 也没有 matchMedia，而目录按钮靠它区分宽屏 / 窄屏
dom.window.matchMedia = (query) => ({
  matches: false,
  media: query,
  addEventListener() {},
  removeEventListener() {},
});

const { buildToc, mountToc } = await import(new URL(`../${TMP}/toc.mjs`, import.meta.url).href);

const cases = [];
const check = (name, ok) => cases.push({ name, ok: !!ok });

/* ------------------------------------------------ 1. 极短文档的行为 */
const empty = document.createElement('div');
empty.innerHTML = '<p>这一段里没有任何标题</p>';
check('没有标题时不生成目录', buildToc(empty) === null);

const single = document.createElement('div');
single.innerHTML = '<h1 id="only">唯一标题</h1>';
check('只有一个标题也生成目录', buildToc(single) !== null);

/* ------------------------------------------------------ 2. 正常构建 */
const root = document.createElement('div');
root.innerHTML = [
  '<h1 id="ch1"><a class="header-anchor" href="#ch1">#</a>第一章</h1>',
  '<h2 id="s11">1.1 背景</h2>',
  '<h3 id="s111">1.1.1 细节</h3>',
  '<h2 id="s12">1.2 目标</h2>',
].join('');

const handle = buildToc(root);
check('标题足够时生成目录', !!handle);
check('目录项数量与标题一致', handle.nav.querySelectorAll('a').length === 4);
check('permalink 的 # 符号被剔除', handle.nav.querySelector('a').textContent.trim() === '第一章');
check(
  '层级 class 正确',
  !!handle.nav.querySelector('.toc-level-h1') &&
    !!handle.nav.querySelector('.toc-level-h2') &&
    !!handle.nav.querySelector('.toc-level-h3')
);
check('链接指向标题 id', handle.nav.querySelector('a').getAttribute('href') === '#ch1');
check('目录标题为「目录」', handle.nav.querySelector('.md-reader-toc-title').textContent === '目录');

/* --------------------------------------------- 3. 无 id 的标题应被跳过 */
const partial = document.createElement('div');
partial.innerHTML =
  '<h1>没有 id 的标题</h1><h2 id="b">有 id</h2><h2 id="c">也有</h2><h2 id="d">还有</h2>';
const mixed = buildToc(partial);
check('无 id 的标题被跳过', mixed.nav.querySelectorAll('a').length === 3);

/* ------------------------------------------------ 4. 树形折叠 */

check('有子标题的节点生成折叠按钮', handle.nav.querySelectorAll('button.toc-caret').length === 2);
check('无子标题的节点用占位符对齐', handle.nav.querySelectorAll('.toc-caret-empty').length === 2);

const bulkButtons = [...handle.nav.querySelectorAll('.toc-bulk-btn')];
check(
  '批量按钮取文档中实际出现的前三个层级（H3 无子标题故只有两个）',
  bulkButtons.map((b) => b.textContent).join(',') === 'H1,H2'
);

const h1Li = handle.nav.querySelector('.toc-level-h1');
const h2Li = handle.nav.querySelector('.toc-level-h2');
const firstCaret = handle.nav.querySelector('button.toc-caret');

check('折叠按钮用内联 SVG 箭头（不依赖字体字形）', !!firstCaret.querySelector('svg'));

firstCaret.click();
check('点击折叠按钮收起子树', h1Li.classList.contains('is-collapsed'));
check('折叠后 aria-expanded 变为 false', firstCaret.getAttribute('aria-expanded') === 'false');

firstCaret.click();
check('再次点击展开子树', !h1Li.classList.contains('is-collapsed'));

const h1Button = bulkButtons[0];
const h2Button = bulkButtons[1];

h2Button.click();
check('批量收起 H2', h2Li.classList.contains('is-collapsed'));
check('批量按钮随之变为未展开态', !h2Button.classList.contains('is-expanded'));

h1Button.click();
check('批量收起 H1', h1Li.classList.contains('is-collapsed'));

h2Button.click();
// 目标层级藏在收起的父节点里时，展开必须连带展开祖先，否则点了等于没点
check('展开下层时连带展开祖先', !h1Li.classList.contains('is-collapsed'));
check('H2 已重新展开', !h2Li.classList.contains('is-collapsed'));
check('批量按钮恢复已展开态', h2Button.classList.contains('is-expanded'));

// 手动折叠也要让批量按钮状态同步，否则按钮会显示成过期的状态
firstCaret.click();
check('手动折叠后批量按钮同步为未展开态', !h1Button.classList.contains('is-expanded'));
firstCaret.click();
check('手动展开后批量按钮同步为已展开态', h1Button.classList.contains('is-expanded'));

/* ------------------------------------------------ 5. 挂载与销毁 */
// 记录交互回调，用来验证按钮与手柄确实把意图交给了外部
const visibleCalls = [];
const widthCalls = [];
const handlers = {
  getWidth: () => 268,
  setWidth: (width) => widthCalls.push(width),
  setVisible: (visible) => visibleCalls.push(visible),
};

const root2 = document.createElement('div');
root2.innerHTML = '<h1 id="a">A</h1><h2 id="b">B</h2><h3 id="c">C</h3>';

const mounted = mountToc(root2, handlers);
check('目录挂载到 body', !!document.querySelector('.md-reader-toc'));
check('生成了目录开关按钮', !!document.querySelector('.md-reader-btn-toc'));
check('生成了拖拽手柄', !!document.querySelector('.md-reader-resizer'));
check(
  '手柄带分隔条语义',
  document.querySelector('.md-reader-resizer').getAttribute('role') === 'separator'
);

/* 宽屏（matchMedia 返回 false）下点击按钮应当请求切换目录可见性 */
document.querySelector('.md-reader-btn-toc').click();
check('点击目录按钮请求切换可见性', visibleCalls.length === 1 && visibleCalls[0] === true);

/* 双击手柄应当请求恢复默认宽度（与 settings.ts 的 TOC_WIDTH.default 一致） */
document
  .querySelector('.md-reader-resizer')
  .dispatchEvent(new dom.window.Event('dblclick'));
check('双击手柄请求恢复默认宽度', widthCalls.length === 1 && widthCalls[0] === 268);

/* 目录项点击：渲染视图下同步地址栏，原文视图下不跳转 */
let hashSyncs = 0;
globalThis.history.replaceState = () => {
  hashSyncs += 1;
};
const firstLink = document.querySelector('.md-reader-toc-list a');

firstLink.click();
check('渲染视图下点击目录项跳转', hashSyncs === 1);

// 原文视图里目录只用于了解结构，点击不应产生任何跳转
document.body.classList.add('md-reader-source-mode');
firstLink.click();
check('原文视图下点击目录项不跳转', hashSyncs === 1);
document.body.classList.remove('md-reader-source-mode');

mounted.destroy();
check(
  'destroy 后清理干净',
  !document.querySelector('.md-reader-toc') &&
    !document.querySelector('.md-reader-btn-toc') &&
    !document.querySelector('.md-reader-resizer')
);

/* ------------------------------------------------------------ 输出 */
let failed = 0;
for (const { name, ok } of cases) {
  if (!ok) failed += 1;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}`);
}

if (failed > 0) {
  console.log(`\n${failed} 项失败`);
  process.exit(1);
}
console.log(`\n全部 ${cases.length} 项通过`);
