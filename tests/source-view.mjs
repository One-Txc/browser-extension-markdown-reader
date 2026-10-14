/**
 * 原文 / 渲染视图切换的本地测试。
 *
 * jsdom 不计算 CSS，所以这里验证的是 JS 逻辑（hidden 标志、按钮文案、body class），
 * 视觉层面的显示与否需要人眼确认。
 */
import { JSDOM } from 'jsdom';
import * as esbuild from 'esbuild';
import { mkdir, rm } from 'node:fs/promises';

const TMP = '.tmp/source-view';
await rm(TMP, { recursive: true, force: true });
await mkdir(TMP, { recursive: true });

await esbuild.build({
  entryPoints: ['src/render/source-view.ts'],
  outfile: `${TMP}/source-view.mjs`,
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
dom.window.scrollTo = () => {};

// 产物落在仓库根的 .tmp/ 下，本文件在 tests/ 里 —— 往上只有一层
const { setupSourceView } = await import(
  new URL(`../${TMP}/source-view.mjs`, import.meta.url).href
);

const cases = [];
const check = (name, ok) => cases.push({ name, ok: !!ok });

const root = document.createElement('main');
root.className = 'markdown-body md-reader-root';
root.textContent = '渲染后的内容';
document.body.appendChild(root);

setupSourceView(root, '# 标题\n\n正文内容。');

const panel = document.querySelector('.md-reader-source');
const button = document.querySelector('.md-reader-btn-source');
// 显隐走 class 而不是 hidden 属性，见 source-view.ts 的说明
const isHidden = (el) => el.classList.contains('md-reader-hidden');

check('生成了原文面板', !!panel);
check('生成了切换按钮', !!button);
check('初始：渲染内容可见', !isHidden(root));
check('初始：原文面板隐藏', isHidden(panel));
// 按钮现在用内联 SVG 表示「点击后会看到的视图」，不再是 </> / Aa 字形
const iconBefore = button.innerHTML;
check('初始：按钮含图标', !!button.querySelector('svg'));
check('原文已写入面板', panel.textContent.includes('正文内容。'));
// 用 textContent 写入，因此面板内不应该有任何子元素
check('原文以纯文本写入（无子元素）', panel.children.length === 0);

button.click();

check('切到原文：渲染内容隐藏', isHidden(root));
check('切到原文：面板可见', !isHidden(panel));
check('切到原文：按钮图标换成另一个', button.innerHTML !== iconBefore);
check('切到原文：仍含图标', !!button.querySelector('svg'));
check('切到原文：body 标记 source-mode', document.body.classList.contains('md-reader-source-mode'));

button.click();

check('切回渲染：渲染内容可见', !isHidden(root));
check('切回渲染：面板隐藏', isHidden(panel));
check('切回渲染：source-mode 已移除', !document.body.classList.contains('md-reader-source-mode'));

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
