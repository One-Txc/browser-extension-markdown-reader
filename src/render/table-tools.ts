/**
 * 表格操作条：内容对齐 + 宽度策略，按张调整。
 *
 * 为什么在渲染后用 JS 再包一层，而不是让 markdown-it 直接输出：
 *   1. 横向滚动需要一个块级容器。`display: table` 的元素自己滚不了 ——
 *      除非退化成 `display: block`，而那会丢掉列宽分配（见 app.css 表格段的说明）；
 *   2. 操作条是交互控件，不该出现在原文视图里，也不该被写进 Markdown。
 *
 * 三档宽度见 TableWidth。capped 之所以要 JS，是因为 `table-layout: auto` 下
 * 给单元格设 max-width 无效（规范里是 undefined），想「短列按内容、长列压上限」
 * 只能逐列算宽度再写进 <colgroup>。
 *
 * ★ 性能结构（用户很在意打开时卡不卡）
 *
 * enhanceTables 刻意拆成「写 → 读 → 写」三步，而不是对每张表边建边判：
 *   1. 写：给所有表建外壳与操作条；
 *   2. 读：先一次性读所有容器的 clientWidth（只触发 1 次强制布局），
 *      再测量字宽 —— 此时样式与布局都已 clean，测量不会再触发 reflow；
 *   3. 写：决定档位、写 colgroup。
 * 旧实现是「每张表：写 DOM → 读 clientWidth」，N 张表就是 N 次强制 reflow。
 *
 * 测量结果在同一轮里缓存并复用：一次 autoWidthFor + 一次 applyWidth
 * 不再各测一遍；只有 fonts.ready 与容器宽度变化后的 recheck 需要重新测量。
 *
 * 行数超过 MAX_SAMPLE_ROWS 的表按行均匀采样。80 分位本来就是统计量，
 * 1000 行取 200 个样本结果几乎一样，但测量量从 O(行数) 降到 O(200)。
 *
 * 状态不持久化：它是「这一张表怎么摆」，不是文档属性。
 * 切换主题只替换 <style>、不重建 DOM，所以调整不会丢；只有切换语言 / 换文档
 * 才会随正文一起重建。要跨会话记住的话，得按「文档 URL + 表格序号」存 storage，
 * 属于另一个决定，先不做。
 */

import { t } from '../shared/i18n';
import {
  ICON_ALIGN_CENTER,
  ICON_ALIGN_LEFT,
  ICON_ALIGN_RIGHT,
  ICON_FIT_WIDTH,
} from './icons';

export type TableAlign = 'left' | 'center' | 'right';
/**
 * auto = 不接管，跟随文档自身的列对齐（Markdown 的 `:-:` 语法）。
 * 其余三种会覆盖所有单元格的内容对齐；再点同一按钮取消，回到 auto。
 */
export type TableAlignState = TableAlign | 'auto';

/**
 * 宽度策略：
 *   - wrap   折行压回正文宽度（默认）
 *   - capped 限幅展开：逐列算宽度、长列压到上限、整表可横向滚动
 *   - full   完全按内容展开，不折行（用户点按钮）
 *
 * wrap / capped 由 decideAutoWidth 自动选：列数 ≥ 7 **且**估算列宽总和超过正文宽度
 * 才进入 capped。列多但都短的表照样走折行，不会平白多出滚动条。
 */
export type TableWidth = 'wrap' | 'capped' | 'full';

/** 列数达到这个值才考虑 capped —— 少于它不可能溢出（短列已由 CSS 保底） */
const CAPPED_MIN_COLUMNS = 7;
/** 长列的宽度上限（em）。约 12 个汉字，再长就打折 */
const COL_MAX_EM = 20;
/** 单元格左右 padding 13px × 2 + 边框 1px × 2 */
const CELL_CHROME_PX = 26;
/** 列宽变化的重判防抖（毫秒） */
const RECHECK_DELAY_MS = 150;
/**
 * 每列最多采样多少行。
 *
 * 80 分位是统计量，行数再多也只取这么多个样本 —— 这是把「上千行的表」
 * 从 O(行数) 压到 O(200) 的唯一手段。表头不算在样本里（它单独作为下限）。
 */
const MAX_SAMPLE_ROWS = 200;

const BOX_CLASS = 'md-reader-table-box';
const SCROLL_CLASS = 'md-reader-table-scroll';
const TOOLBAR_CLASS = 'md-reader-table-toolbar';
const BTN_CLASS = 'md-reader-table-btn';

/** 对齐是互斥的三选一，宽度是独立开关，所以两组分开建 */
const ALIGN_BUTTONS: ReadonlyArray<{ align: TableAlign; icon: string; labelKey: string }> = [
  { align: 'left', icon: ICON_ALIGN_LEFT, labelKey: 'tableAlignLeft' },
  { align: 'center', icon: ICON_ALIGN_CENTER, labelKey: 'tableAlignCenter' },
  { align: 'right', icon: ICON_ALIGN_RIGHT, labelKey: 'tableAlignRight' },
];

const ALIGN_LABEL_KEYS: Record<TableAlign, string> = {
  left: 'tableAlignLeft',
  center: 'tableAlignCenter',
  right: 'tableAlignRight',
};

interface TableUnit {
  box: HTMLElement;
  table: HTMLTableElement;
  toolbar: HTMLElement;
}

interface MeasuredColumns {
  /** 形如 ["8.50em", "20.00em", …]，直接写进 <colgroup> */
  widths: string[];
  /** 列宽总和（px，含 padding 与边框），用来判断会不会溢出 */
  totalPx: number;
}

function makeButton(html: string, label: string): HTMLButtonElement {
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = BTN_CLASS;
  // 图标是写死的常量 SVG，不来自文档内容
  btn.innerHTML = html;
  btn.title = label;
  btn.setAttribute('aria-label', label);
  return btn;
}

/**
 * 内容对齐。
 *
 * 三个按钮是互斥的「接管」状态，auto 表示交还给文档自身（不产出任何覆盖规则）。
 * 按下时 title 换成「文档对齐」—— 否则用户点过一次之后，
 * 不知道再点一次会取消。
 */
function applyAlign(box: HTMLElement, align: TableAlignState): void {
  box.dataset.align = align;
  for (const btn of box.querySelectorAll<HTMLButtonElement>('[data-table-align]')) {
    const self = btn.dataset.tableAlign as TableAlign;
    const on = self === align;
    const label = on ? t('tableAlignReset') : t(ALIGN_LABEL_KEYS[self]);
    btn.setAttribute('aria-pressed', String(on));
    btn.title = label;
    btn.setAttribute('aria-label', label);
  }
}

/** 表格有几列：优先看表头行，没有 thead 时退回第一行 */
function countColumns(table: HTMLTableElement): number {
  const first = table.tHead?.rows[0] ?? table.rows[0];
  return first?.cells.length ?? 0;
}

/** 按固定步长均匀抽样，避免尾部的少数长值被整段丢掉 */
function sampleRows(rows: HTMLTableRowElement[]): HTMLTableRowElement[] {
  if (rows.length <= MAX_SAMPLE_ROWS) return rows;
  const step = rows.length / MAX_SAMPLE_ROWS;
  const sampled: HTMLTableRowElement[] = [];
  for (let i = 0; i < MAX_SAMPLE_ROWS; i++) {
    sampled.push(rows[Math.floor(i * step)]);
  }
  return sampled;
}

/**
 * 逐列算宽度；算不出来（没有 canvas 上下文）返回 null。
 *
 * 规则：clamp(表头宽度, 内容宽度 80 分位, 20em)
 *   - 下限取表头宽度，保证「编号」「级别」这类短列的表头不被压到折行；
 *   - 期望值取 80 分位而不是最长单元格，避免一个超长 URL 绑架整列；
 *   - 上限 20em，让长说明列折几行，而不是撑成一行 800px。
 *
 * 用 em 而不是 px：字号从「小」切到「大」时列宽自动等比缩放，无需重测。
 */
function measureColumns(table: HTMLTableElement): MeasuredColumns | null {
  const rows = Array.from(table.rows);
  if (rows.length === 0) return null;
  const header = table.tHead?.rows[0] ?? rows[0];
  const count = header.cells.length;
  if (count === 0) return null;

  // 用 ownerDocument.defaultView 取计算样式：测试环境（jsdom）里全局 getComputedStyle
  // 不一定存在，而 defaultView 总是有的
  const view = table.ownerDocument.defaultView;
  const style = view ? view.getComputedStyle(table) : getComputedStyle(table);
  const fontSize = parseFloat(style.fontSize) || 16;
  const font = `${style.fontWeight || '400'} ${style.fontSize || '16px'} ${
    style.fontFamily || 'sans-serif'
  }`;

  // 没有 canvas 就没有可靠的文本宽度 —— 宁可退回折行，也不给一列错得离谱的宽度
  const ctx = document.createElement('canvas').getContext('2d');
  if (!ctx) return null;
  ctx.font = font;

  const bodyRows = sampleRows(rows.filter((row) => row !== header));
  const maxPx = fontSize * COL_MAX_EM;
  const widths: string[] = [];
  let totalPx = 0;

  for (let i = 0; i < count; i++) {
    const headText = header.cells[i]?.textContent?.trim() ?? '';
    const minPx = ctx.measureText(headText).width + CELL_CHROME_PX;

    const samples: number[] = [];
    for (const row of bodyRows) {
      const text = row.cells[i]?.textContent?.trim() ?? '';
      if (!text) continue;
      samples.push(ctx.measureText(text).width + CELL_CHROME_PX);
    }
    samples.sort((a, b) => a - b);

    // 80 分位：取样本里偏大的那个，避免个别超长单元格绑架整列
    const index = Math.min(samples.length - 1, Math.floor(samples.length * 0.8));
    const preferred = samples.length > 0 ? samples[Math.max(0, index)] : minPx;

    // 先压上限，再抬回下限：表头本身超过 20em 时允许破格，表头不折优先
    const px = Math.max(minPx, Math.min(preferred, maxPx));
    widths.push(`${(px / fontSize).toFixed(2)}em`);
    totalPx += px;
  }

  return { widths, totalPx };
}

function clearColumns(table: HTMLTableElement): void {
  table.querySelector(':scope > colgroup')?.remove();
}

function layoutColumns(table: HTMLTableElement, measured: MeasuredColumns): void {
  clearColumns(table);
  const group = document.createElement('colgroup');
  for (const width of measured.widths) {
    const col = document.createElement('col');
    col.style.width = width;
    group.append(col);
  }
  table.prepend(group);
}

/**
 * 自动档位：列数够多 **且** 估算列宽总和超过正文宽度，才进 capped。
 *
 * 后半个条件很重要：7 列全是「编号 / 状态 / 是」这种短表时，总和可能只有 400px，
 * 折行就能放下，没有理由给它加滚动条。只看列数会让这类表白白多出滚动条。
 *
 * 量不到容器宽度（还没布局，比如 jsdom）时按放不下处理，退折行。
 */
function decideAutoWidth(
  columns: number,
  measured: MeasuredColumns | null,
  available: number
): TableWidth {
  if (columns < CAPPED_MIN_COLUMNS) return 'wrap';
  if (!measured) return 'wrap';
  return available > 0 && measured.totalPx > available ? 'capped' : 'wrap';
}

/**
 * 落宽度状态。
 *
 * measured 由调用方传入而不是这里现测：同一轮里「决定档位」与「应用档位」
 * 共享同一份测量结果，省掉一次完整的列扫描。
 */
function applyWidth(
  box: HTMLElement,
  table: HTMLTableElement,
  width: TableWidth,
  measured: MeasuredColumns | null
): void {
  let actual = width;
  if (actual === 'capped') {
    // capped 依赖列宽测量，测不出来就老实退回折行
    if (measured) layoutColumns(table, measured);
    else actual = 'wrap';
  }
  if (actual !== 'capped') clearColumns(table);
  box.dataset.width = actual;

  const btn = box.querySelector<HTMLButtonElement>('[data-table-fit]');
  if (!btn) return;
  const expanded = actual === 'full';
  const label = t(expanded ? 'tableShrink' : 'tableFitWidth');
  btn.setAttribute('aria-pressed', String(expanded));
  btn.title = label;
  btn.setAttribute('aria-label', label);
}

/** 建外壳与操作条。纯写操作，不读布局 —— 读取统一放到 enhanceTables 的第二步 */
function createTableUnit(table: HTMLTableElement): TableUnit {
  const doc = table.ownerDocument;

  const box = doc.createElement('div');
  box.className = BOX_CLASS;

  const toolbar = doc.createElement('div');
  toolbar.className = TOOLBAR_CLASS;
  toolbar.setAttribute('role', 'toolbar');
  toolbar.setAttribute('aria-label', t('tableTools'));

  for (const { align, icon, labelKey } of ALIGN_BUTTONS) {
    const btn = makeButton(icon, t(labelKey));
    btn.dataset.tableAlign = align;
    toolbar.append(btn);
  }

  const fitBtn = makeButton(ICON_FIT_WIDTH, t('tableFitWidth'));
  fitBtn.dataset.tableFit = '';
  toolbar.append(fitBtn);

  const scroll = doc.createElement('div');
  scroll.className = SCROLL_CLASS;

  /*
   * 顺序要紧：先把 box 插到表格原来的位置，再把表格移进 scroll。
   * 反过来做的话，table 已经离开文档，insertBefore 会找不到参考节点。
   */
  table.parentNode?.insertBefore(box, table);
  scroll.append(table);
  box.append(toolbar, scroll);

  // 对齐与文档无关，建好就能定；宽度要等所有表都建完再统一量
  applyAlign(box, 'auto');

  return { box, table, toolbar };
}

/**
 * 绑定交互与两个自动重判来源。
 *
 * 三种触发的区别：
 *   - fonts.ready：一次性的，字体到位后字宽才准；
 *   - ResizeObserver：容器宽度变了才重判，且比较宽度而不是高度 ——
 *     切换 capped 会改变表格高度，拿高度判断会自己触发自己；
 *   - 用户手动点过按钮后打上 data-manual，之后一律不再自动改。
 */
function bindInteraction(unit: TableUnit): void {
  const { box, table, toolbar } = unit;
  const doc = table.ownerDocument;

  const recheck = (): void => {
    if (box.dataset.manual === '1') return;
    const measured = measureColumns(table);
    const auto = decideAutoWidth(countColumns(table), measured, box.clientWidth);
    // capped 即使档位没变也要重写：字体变化后列宽需要同步更新
    if (auto === 'capped' || auto !== box.dataset.width) {
      applyWidth(box, table, auto, measured);
    }
  };

  const fonts = doc.fonts;
  if (fonts) {
    fonts.ready.then(recheck).catch(() => {
      /* 字体加载失败就用现有宽度，不值得打扰用户 */
    });
  }

  const view = doc.defaultView;
  if (view && typeof view.ResizeObserver === 'function') {
    let timer: number | undefined;
    let lastWidth = box.clientWidth;
    const observer = new view.ResizeObserver(() => {
      const width = box.clientWidth;
      if (width === lastWidth) return;
      lastWidth = width;
      if (timer !== undefined) view.clearTimeout(timer);
      timer = view.setTimeout(recheck, RECHECK_DELAY_MS);
    });
    observer.observe(box);
  }

  // 单个监听器挂在工具条上，卡片内所有按钮共用，省得每张表挂四个
  toolbar.addEventListener('click', (event) => {
    const target = event.target as Element | null;
    const btn = target?.closest<HTMLButtonElement>('button');
    if (!btn) return;

    const align = btn.dataset.tableAlign as TableAlign | undefined;
    if (align) {
      // 再点一次同一个按钮 = 取消接管，回到文档自身的列对齐
      applyAlign(box, box.dataset.align === align ? 'auto' : align);
      return;
    }
    if (btn.hasAttribute('data-table-fit')) {
      if (box.dataset.width === 'full') {
        // 回到自动档位，并允许继续随宽度环境自动调整。
        // 测量只做一次，决定档位与应用档位共用同一份结果
        delete box.dataset.manual;
        const measured = measureColumns(table);
        const auto = decideAutoWidth(countColumns(table), measured, box.clientWidth);
        applyWidth(box, table, auto, measured);
      } else {
        box.dataset.manual = '1';
        applyWidth(box, table, 'full', null);
      }
    }
  });
}

/**
 * 给 root 里的每张表装上操作条，返回处理的数量。
 *
 * 幂等：已经包过的表格靠 closest 跳过，重复调用不会套娃
 * （renderDocument 每次重建正文，但设置面板刷新等路径可能重复进入）。
 */
export function enhanceTables(root: HTMLElement): number {
  const units: TableUnit[] = [];
  for (const table of root.querySelectorAll('table')) {
    if (table.closest(`.${BOX_CLASS}`)) continue;
    units.push(createTableUnit(table as HTMLTableElement));
  }
  if (units.length === 0) return 0;

  /*
   * 三步走，把「写」与「读」分开，避免每张表都强制一次布局：
   *   1. 结构已经写完（上面循环）；
   *   2. 读：先批量读 clientWidth，只触发一次强制布局；再批量测量字宽 ——
   *      此时样式与布局都干净，measureText 不会再引起 reflow；
   *   3. 写：按测量结果决定档位、写 colgroup。
   */
  const available = units.map((unit) => unit.box.clientWidth);
  // 列数不够的表根本不会进 capped，连测量都省掉 ——
  // 短表在文档里占多数，这一步能砍掉大部分 getComputedStyle + measureText
  const measured = units.map((unit) =>
    countColumns(unit.table) >= CAPPED_MIN_COLUMNS ? measureColumns(unit.table) : null
  );

  units.forEach((unit, index) => {
    const auto = decideAutoWidth(countColumns(unit.table), measured[index], available[index]);
    applyWidth(unit.box, unit.table, auto, measured[index]);
    bindInteraction(unit);
  });

  return units.length;
}
