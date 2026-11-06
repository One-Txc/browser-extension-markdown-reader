/**
 * 表格操作条的本地测试。
 *
 * 能测的：包裹结构、按钮数量、默认状态、对齐互斥与取消、三档宽度的切换、
 *        「列数够 + 估算宽度超正文」才进 capped、capped 的列宽是否写进 <colgroup>、幂等。
 * 测不了的：真正的左右位置、滚动条、列宽是否真的不折行 —— jsdom 里没有布局。
 *           那部分要人眼在浏览器里看（本项目约定如此）。
 */
import { JSDOM } from 'jsdom';
import * as esbuild from 'esbuild';
import { mkdir, rm } from 'node:fs/promises';

const TMP = '.tmp/table-tools';
await rm(TMP, { recursive: true, force: true });
await mkdir(TMP, { recursive: true });

await esbuild.build({
  entryPoints: ['src/render/table-tools.ts'],
  outfile: `${TMP}/table-tools.mjs`,
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

/*
 * jsdom 没有 canvas，getContext 会返回 null —— 那会让 capped 降级成折行，
 * 测不到列宽。这里替换成按「每字符 8px」估算的假实现。
 */
const realCreateElement = document.createElement.bind(document);
document.createElement = (tag, options) => {
  if (String(tag).toLowerCase() === 'canvas') {
    return { getContext: () => ({ font: '', measureText: (s) => ({ width: [...s].length * 8 }) }) };
  }
  return realCreateElement(tag, options);
};

/*
 * jsdom 没有布局，clientWidth 恒为 0；而 autoWidthFor 靠它判断「估算总宽是否超正文」。
 * 固定成 900（正文宽 medium 档）就能覆盖两条分支。
 */
Object.defineProperty(dom.window.Element.prototype, 'clientWidth', {
  configurable: true,
  get: () => 900,
});

const { enhanceTables } = await import(new URL(`../${TMP}/table-tools.mjs`, import.meta.url).href);

const cases = [];
const check = (name, ok) => cases.push({ name, ok: !!ok });

/* ------------------------------------------------------ 1. 包裹结构 */
const root = document.createElement('div');
root.innerHTML = [
  '<table><thead><tr><th>字段</th><th>说明</th></tr></thead>',
  '<tbody><tr><td>a</td><td>b</td></tr></tbody></table>',
  // 引用块里的表格也要被处理：它们同样是正文的一部分
  '<blockquote><table><tbody><tr><td>引用里的表</td></tr></tbody></table></blockquote>',
].join('');

check('返回处理的表格数量', enhanceTables(root) === 2);
check('每张表都有一层外壳', root.querySelectorAll('.md-reader-table-box').length === 2);
check(
  '表格被移进滚动容器',
  [...root.querySelectorAll('table')].every((t) => !!t.closest('.md-reader-table-scroll'))
);
check(
  '每张表都有四个按钮',
  [...root.querySelectorAll('.md-reader-table-box')].every(
    (box) => box.querySelectorAll('button').length === 4
  )
);
check(
  '按钮都是 type=button（避免在扩展页面里触发提交）',
  [...root.querySelectorAll('.md-reader-table-btn')].every((b) => b.type === 'button')
);
check('表格内容没有丢', root.textContent.includes('引用里的表'));

/* -------------------------------------------------------- 2. 默认状态 */
const [box] = root.querySelectorAll('.md-reader-table-box');
check('默认对齐交给文档自身（auto）', box.dataset.align === 'auto');
check('列数少时默认折行（wrap）', box.dataset.width === 'wrap');
check('wrap 表格不写 colgroup', !box.querySelector('colgroup'));
check(
  '默认三个对齐按钮都不按下',
  [...box.querySelectorAll('[data-table-align]')].every(
    (b) => b.getAttribute('aria-pressed') === 'false'
  )
);
check('完全展开默认未激活', box.querySelector('[data-table-fit]').getAttribute('aria-pressed') === 'false');

/* ---------------------------------------------------- 3. 对齐切换（互斥 + 可取消） */
const [leftBtn, centerBtn, rightBtn] = box.querySelectorAll('[data-table-align]');
const leftTitleBefore = leftBtn.title;

centerBtn.click();
check('点居中后对齐变成 center', box.dataset.align === 'center');
check('点居中后只有居中按下', centerBtn.getAttribute('aria-pressed') === 'true');
check('按下时提示换成「文档对齐」', centerBtn.title !== leftTitleBefore);

centerBtn.click();
check('再点一次居中取消，回到 auto', box.dataset.align === 'auto');
check('取消后按钮不再按下', centerBtn.getAttribute('aria-pressed') === 'false');
check('取消后提示不再是「文档对齐」', centerBtn.title !== '文档对齐');

rightBtn.click();
check('点靠右后对齐变成 right', box.dataset.align === 'right');
check(
  '点靠右后居中自动取消',
  centerBtn.getAttribute('aria-pressed') === 'false' && rightBtn.getAttribute('aria-pressed') === 'true'
);

leftBtn.click();
check('点靠左后对齐变成 left', box.dataset.align === 'left');
check('点靠左后靠右取消', rightBtn.getAttribute('aria-pressed') === 'false');

/* ------------------------------------------------- 4. 宽度：wrap ↔ full */
const fitBtn = box.querySelector('[data-table-fit]');
const fitTitleBefore = fitBtn.title;
fitBtn.click();
check('点「完全按内容展开」后进入 full', box.dataset.width === 'full');
check('full 按下状态为 true', fitBtn.getAttribute('aria-pressed') === 'true');
check('提示文字跟着状态变化', fitBtn.title !== fitTitleBefore);
check('手动切换后打上 data-manual', box.dataset.manual === '1');

fitBtn.click();
check('再点一次回到自动宽度（wrap）', box.dataset.width === 'wrap');
check('回到 wrap 后按下状态为 false', fitBtn.getAttribute('aria-pressed') === 'false');
check('提示文字回到初始文案', fitBtn.title === fitTitleBefore);
check('回到自动后清除 data-manual', box.dataset.manual === undefined);

/* -------------- 5. 宽表：列数 ≥ 7 且估算总宽超正文，才自动进入 capped -------------- */
const head = (n) => `<th>列${n}</th>`;
const shortRow = (n) => `<td>数据${n}</td>`;
// 20 个汉字：假 canvas 下宽 160px + 26 的 chrome = 186px/列，7 列共 1302px，超过 900
const longRow = (n) => `<td>${'数据'.repeat(10)}${n}</td>`;
const table = (cols, rowFn) =>
  [
    '<table><thead><tr>',
    ...Array.from({ length: cols }, (_, i) => head(i + 1)),
    '</tr></thead><tbody><tr>',
    ...Array.from({ length: cols }, (_, i) => rowFn(i + 1)),
    '</tr></tbody></table>',
  ].join('');

const wide = document.createElement('div');
wide.innerHTML = [
  table(7, longRow), // 7 列 + 超宽 → capped
  table(7, shortRow), // 7 列 + 放得下 → wrap（新条件的关键用例）
  table(6, longRow), // 6 列 + 超宽 → 一律 wrap
].join('');

check('三张表都处理了', enhanceTables(wide) === 3);
const [cappedBox, shortBox, sixBox] = wide.querySelectorAll('.md-reader-table-box');

check('7 列 + 超宽 → capped', cappedBox.dataset.width === 'capped');
check('7 列 + 放得下 → wrap', shortBox.dataset.width === 'wrap');
check('6 列 + 超宽仍是 wrap', sixBox.dataset.width === 'wrap');

const cols = cappedBox.querySelectorAll('colgroup > col');
check('capped 写入了 7 个 col', cols.length === 7);
check(
  '每个 col 都有 em 宽度',
  [...cols].every((c) => /^\d+(\.\d+)?em$/.test(c.style.width))
);
check('放得下的宽表不写 colgroup', !shortBox.querySelector('colgroup'));

const cappedFit = cappedBox.querySelector('[data-table-fit]');
cappedFit.click();
check('从 capped 切到 full', cappedBox.dataset.width === 'full');
check('切到 full 后移除 colgroup', !cappedBox.querySelector('colgroup'));

cappedFit.click();
check('从 full 切回 capped', cappedBox.dataset.width === 'capped');
check('切回 capped 后重新写入 colgroup', cappedBox.querySelectorAll('colgroup > col').length === 7);

/* --------------------------------- 6. 大表：超过采样上限后仍能正确出列宽 */
const big = document.createElement('div');
big.innerHTML = [
  '<table><thead><tr>',
  ...Array.from({ length: 7 }, (_, i) => head(i + 1)),
  '</tr></thead><tbody>',
  ...Array.from(
    { length: 260 },
    () => `<tr>${Array.from({ length: 7 }, (_, c) => longRow(c + 1)).join('')}</tr>`
  ),
  '</tbody></table>',
].join('');

check('260 行的表能处理', enhanceTables(big) === 1);
const bigBox = big.querySelector('.md-reader-table-box');
check('大表仍按宽度进入 capped', bigBox.dataset.width === 'capped');
check('大表的 col 数量正确', bigBox.querySelectorAll('colgroup > col').length === 7);

/* --------------------------------------------------------- 7. 互不干扰 */
const rootBoxes = root.querySelectorAll('.md-reader-table-box');
check(
  '调整第一张表不影响第二张',
  rootBoxes[1].dataset.align === 'auto' && rootBoxes[1].dataset.width === 'wrap'
);

/* ------------------------------------------------------------ 8. 幂等 */
check('重复调用不再包裹', enhanceTables(wide) === 0);
check('重复调用后外壳数量不变', wide.querySelectorAll('.md-reader-table-box').length === 3);

/* --------------------------------------------------------- 9. 无表格 */
const empty = document.createElement('div');
empty.innerHTML = '<p>没有表格的文档</p>';
check('没有表格时返回 0', enhanceTables(empty) === 0);

/* ------------------------------------------------------------ 汇总 */
let failed = 0;
for (const { name, ok } of cases) {
  if (!ok) failed++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}`);
}

if (failed > 0) {
  console.log(`\n${failed} 项失败`);
  process.exit(1);
}
console.log(`\n全部 ${cases.length} 项通过`);
