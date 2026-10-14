/**
 * 渲染管线本地验证（不依赖浏览器）。
 *
 * 目的：在交给用户在 Chrome 里试之前，先确认
 *   - markdown-it 的插件链输出正确的 HTML
 *   - DOMPurify 的配置没有误伤（任务列表的 checkbox / 图片 / 锚点 id）
 *   - XSS 载荷确实被清除
 *
 * 做法：用 esbuild 把 render 模块打成 ESM，再用 jsdom 提供 window 让 DOMPurify 初始化。
 */
import { JSDOM } from 'jsdom';
import * as esbuild from 'esbuild';
import { mkdir, rm } from 'node:fs/promises';

/* ---------------------------------------------------- 1. 打包 render 模块 */
// ★ 用独立子目录，不要 rm 整个 .tmp ——
// .tmp 是多个脚本共用的临时区，清空它会误删别人的东西（实际踩过）。
const TMP = '.tmp/render';
await rm(TMP, { recursive: true, force: true });
await mkdir(TMP, { recursive: true });

await esbuild.build({
  entryPoints: ['src/render/markdown.ts'],
  outfile: `${TMP}/markdown.mjs`,
  bundle: true,
  format: 'esm',
  platform: 'browser', // 让 dompurify 走浏览器入口
  target: 'es2022',
  logLevel: 'silent',
});

/* ------------------------------------------- 2. 提供 DOMPurify 需要的 DOM */
const dom = new JSDOM('<!doctype html><html><body></body></html>', {
  url: 'file:///D:/docs/a.md',
});
globalThis.window = dom.window;
globalThis.document = dom.window.document;

// 产物落在仓库根的 .tmp/ 下，本文件在 tests/ 里 —— 往上只有一层
const { renderMarkdown } = await import(new URL(`../${TMP}/markdown.mjs`, import.meta.url).href);

/* ------------------------------------------------------------ 3. 测试用例 */
const source = [
  '# 标题一',
  '',
  '段落 **粗体** 与 `inline code` 和中文标点：·—。',
  '',
  '## 二级标题',
  '',
  '- [ ] 未完成',
  '- [x] 已完成',
  '',
  '```python',
  'def hello():',
  '    return 1',
  '```',
  '',
  '| 列A | 列B |',
  '| --- | --- |',
  '| 1 | 2 |',
  '',
  '![本地图](./img/a.png)',
  '',
  '[外链](https://example.com) 和 [内链](./other.md) 与 [手写中文锚点](#标题一)',
  '',
  '<script>alert(1)</script>',
  '<img src="x" onerror="alert(2)">',
  '<a href="javascript:alert(3)">点我</a>',
  '',
  '行内公式 $E = mc^2$ 与块级公式：',
  '',
  '$$',
  '\\int_0^\\infty e^{-x^2}\\,dx = \\frac{\\sqrt{\\pi}}{2}',
  '$$',
  '',
  '价格 $5 与 $10 不应被当作公式。',
  '',
  '```mermaid',
  'graph TD;',
  '  A[开始]-->B[结束];',
  '```',
  '',
  '带脚注的句子[^first]，还有另一个[^second]。',
  '',
  '[^first]: 第一个脚注的内容。',
  '',
  '[^second]: 第二个脚注，稍长一些。',
].join('\n');

const html = renderMarkdown(source, 'file:///D:/docs/a.md');

const cases = [
  ['标题渲染', /<h1[^>]*>/.test(html)],
  ['标题带锚点 id', /<h1[^>]*id="/.test(html)],
  ['中文锚点 id 保留原字符', html.includes('id="标题一"')],
  ['手写中文锚点可匹配', html.includes('href="#标题一"')],
  ['checkbox 只读（disabled）', (html.match(/disabled/g) ?? []).length === 2],
  ['粗体', html.includes('<strong>粗体</strong>')],
  ['行内代码', html.includes('<code>inline code</code>')],
  ['中文与特殊符号保留', html.includes('·—')],
  ['任务列表 checkbox', (html.match(/type="checkbox"/g) ?? []).length === 2],
  ['已完成项 checked', /checked/.test(html)],
  ['python 高亮', /class="[^"]*language-python/.test(html)],
  ['表格', html.includes('<table>')],
  ['本地图片路径保留（不重写）', html.includes('src="./img/a.png"')],
  ['外链加 target=_blank', /<a[^>]+href="https:\/\/example\.com"[^>]*target="_blank"/.test(html)],
  ['内链不加 target', !/<a[^>]+href="\.\/other\.md"[^>]*target=/.test(html)],
  ['XSS: script 被移除', !html.includes('<script')],
  ['XSS: onerror 被移除', !html.includes('onerror')],
  ['XSS: javascript: 协议被移除', !html.includes('javascript:')],
  ['行内公式渲染为 KaTeX', html.includes('class="katex"')],
  ['块级公式使用 display 模式', html.includes('katex-display')],
  ['公式占位符已全部回填', !/MDMATH[a-z0-9]+M\d+END/.test(html)],
  // 这条是本轮的关键：DOMPurify 会剥掉 style，公式必须绕开它才能保持排版。
  // 断言不绑定具体类名（KaTeX 0.19 已把 strut 改名为 katex-strut），
  // 只要求 katex-html 内部确实存在内联 style。
  ['公式保留了 KaTeX 的内联 style', /katex-html[\s\S]{0,400}?style="/.test(html)],
  ['货币符号 $5 / $10 不被误判为公式', html.includes('$5') && html.includes('$10')],
  ['mermaid 块生成占位容器', html.includes('class="md-reader-mermaid"')],
  ['mermaid 块没有被高亮成代码块', !/language-mermaid/.test(html)],
  ['mermaid 原始代码保留在容器内', /md-reader-mermaid">[\s\S]*graph TD/.test(html)],
  ['脚注引用渲染为 sup', /class="footnote-ref"/.test(html)],
  ['脚注区域生成', /class="footnotes"/.test(html)],
  ['脚注内容保留', html.includes('第一个脚注的内容')],
  ['脚注回跳链接存在', /class="footnote-backref"/.test(html)],
  ['脚注定义没有被当成普通段落', !html.includes('[^first]:')],
];

/* ---------------------------------------------------------------- 4. 输出 */
let failed = 0;
for (const [name, ok] of cases) {
  if (!ok) failed++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}`);
}

console.log('\n--- 渲染结果预览（前 700 字符）---');
console.log(html.slice(0, 700));

if (failed > 0) {
  console.log(`\n${failed} 项失败`);
  process.exit(1);
}
console.log(`\n全部 ${cases.length} 项通过`);
