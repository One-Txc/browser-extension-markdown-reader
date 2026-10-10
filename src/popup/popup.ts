/**
 * MD Reader —— popup
 *
 * 三块内容：
 *   1. 配色：颜色模式 + 浅色/深色代码配色
 *   2. 排版：字号、正文宽度、侧边目录开关
 *   3. 权限状态：告诉用户「允许访问文件网址」这个开关开没开
 *
 * 所有设置改完都会立即通知当前标签页重新套用，无需刷新页面。
 *
 * 关于权限检测：不用 chrome.extension.isAllowedFileSchemeAccess ——
 * M0 实测该 API 在 content script 中不存在。改用「content script 注入成功后上报」
 * 的 storage 标志，逻辑上更干净：脚本能注入进来，本身就是权限已开的证明。
 *
 * 注意：扩展不允许导航到 chrome:// 协议，所以设置页地址只能作为文本让用户复制。
 */

import {
  DEFAULT_SETTINGS,
  clampExpandLevel,
  clampFoldThreshold,
  loadSettings,
  saveSettings,
  type ContentWidth,
  type FontSize,
  type ReaderSettings,
  type ThemeMode,
} from '../shared/settings';
import { themesFor, type Appearance } from '../render/theme-catalog';
import type { Locale } from '../shared/i18n';
import { setLocale, t } from '../shared/i18n';

function pick<T extends HTMLElement>(id: string): T {
  return document.getElementById(id) as T;
}

const modeEl = pick<HTMLSelectElement>('mode');
const lightEl = pick<HTMLSelectElement>('lightTheme');
const darkEl = pick<HTMLSelectElement>('darkTheme');
const fontSizeEl = pick<HTMLSelectElement>('fontSize');
const contentWidthEl = pick<HTMLSelectElement>('contentWidth');
const showTocEl = pick<HTMLInputElement>('showToc');
const foldThresholdEl = pick<HTMLInputElement>('foldThreshold');
const defaultExpandLevelEl = pick<HTMLSelectElement>('defaultExpandLevel');
const resetEl = pick<HTMLButtonElement>('reset');
const localeEl = pick<HTMLSelectElement>('locale');
const statusEl = pick<HTMLElement>('status');
const detailEl = pick<HTMLElement>('detail');
const metaEl = pick<HTMLElement>('meta');
const versionEl = pick<HTMLElement>('version');

/**
 * 版本与构建时间。
 *
 * 版本号在开发期几乎不变，光看它无法判断「浏览器里跑的是不是刚构建的那份」；
 * 构建时间每次构建都不同，刷新 popup 即可确认。
 * 这里不用 t()：它依赖语言设置，而语言要等 init 读出来才知道，见下面的 renderVersion。
 */
function renderVersion(): void {
  versionEl.textContent = t('popupVersion', [
    chrome.runtime.getManifest().version,
    __BUILD_TIME__,
  ]);
}

const SETTINGS_URL = 'chrome://extensions/?id=' + chrome.runtime.id;

/* ---------------------------------------------------------- 静态文案填充 */

/**
 * 填充 HTML 里所有带 data-i18n 标记的元素。
 *
 * HTML 的文本节点没法调用 JS 函数，所以给元素打标记、启动时统一填一遍。
 * 之后新增文案只要在 HTML 上挂属性，这个函数不用改。
 */
function applyI18n(root: ParentNode = document): void {
  root.querySelectorAll<HTMLElement>('[data-i18n]').forEach((el) => {
    const key = el.dataset.i18n;
    if (key) el.textContent = t(key);
  });
  root.querySelectorAll<HTMLElement>('[data-i18n-title]').forEach((el) => {
    const key = el.dataset.i18nTitle;
    if (key) el.title = t(key);
  });
}

/* -------------------------------------------------------------- 设置读写 */

function fillOptions(select: HTMLSelectElement, appearance: Appearance): void {
  select.replaceChildren(
    ...themesFor(appearance).map((theme) => {
      const option = document.createElement('option');
      option.value = theme.id;
      // 主题名是品牌名不翻译；需要本地化的补充说明走 noteKey
      option.textContent = theme.noteKey ? `${theme.name} · ${t(theme.noteKey)}` : theme.name;
      return option;
    })
  );
}

async function save(partial: Partial<ReaderSettings>): Promise<void> {
  const current = await loadSettings();
  await saveSettings({ ...current, ...partial });
  await notifyActiveTab();
}

/** 通知当前标签页立即套用新设置；非 Markdown 页面会静默失败 */
async function notifyActiveTab(): Promise<void> {
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (tab?.id != null) {
      await chrome.tabs.sendMessage(tab.id, { type: 'settings-changed' });
    }
  } catch {
    /* 当前标签页没有 content script（不是 Markdown 页面），忽略 */
  }
}

/* ------------------------------------------------------------ 恢复默认 */

/** 把设置回填到各控件（初始化与重置后共用，避免两处赋值逻辑漂移） */
function applySettingsToForm(settings: ReaderSettings): void {
  modeEl.value = settings.mode;
  lightEl.value = settings.lightTheme;
  darkEl.value = settings.darkTheme;
  fontSizeEl.value = settings.fontSize;
  contentWidthEl.value = settings.contentWidth;
  showTocEl.checked = settings.showToc;
  foldThresholdEl.value = String(settings.foldThreshold);
  defaultExpandLevelEl.value = String(settings.defaultExpandLevel);
  localeEl.value = settings.locale;
}

let resetArmed = false;
let resetTimer: number | undefined;

function disarmReset(): void {
  resetArmed = false;
  window.clearTimeout(resetTimer);
  resetEl.textContent = t('popupReset');
  resetEl.classList.remove('is-confirming');
}

/**
 * 重置用「点一次进入待确认，再点一次执行，3 秒无操作自动撤销」，
 * 而不是 window.confirm()：
 * 原生对话框在扩展 popup 里的表现各浏览器不一致，还会打断操作流。
 */
async function handleResetClick(): Promise<void> {
  if (!resetArmed) {
    resetArmed = true;
    resetEl.textContent = t('popupResetConfirm');
    resetEl.classList.add('is-confirming');
    resetTimer = window.setTimeout(disarmReset, 3000);
    return;
  }

  disarmReset();

  // 直接写默认值，不走 save()：save 的语义是「读旧值再合并」，
  // 而重置要的是整体覆盖 —— 用合并写会把用户没改过的项也带过来，反而留下旧值。
  await saveSettings(DEFAULT_SETTINGS);
  applySettingsToForm(DEFAULT_SETTINGS);
  await notifyActiveTab();

  resetEl.textContent = t('popupResetDone');
  window.setTimeout(() => {
    resetEl.textContent = t('popupReset');
  }, 1500);
}

/* -------------------------------------------------------------- 权限状态 */

async function renderPermission(): Promise<void> {
  const data = await chrome.storage.local.get({
    fileAccessProven: false,
    fileAccessLastSeen: 0,
  });

  if (data.fileAccessProven) {
    statusEl.className = 'status ok';
    statusEl.innerHTML = `<b>✓ ${t('popupActive')}</b>`;
    detailEl.innerHTML = `<div class="hint">${t('popupActiveHint')}</div>`;
  } else {
    statusEl.className = 'status bad';
    statusEl.innerHTML = `<b>${t('popupInactive')}</b><br>${t('popupInactiveReason')}`;
    detailEl.innerHTML = [
      '<ol>',
      `<li>${t('popupStep1')}<br><code>${SETTINGS_URL}</code></li>`,
      `<li>${t('popupStep2')}</li>`,
      `<li>${t('popupStep3')}</li>`,
      '</ol>',
    ].join('');
  }

  const last = data.fileAccessLastSeen
    ? new Date(data.fileAccessLastSeen as number).toLocaleString()
    : t('popupNever');
  metaEl.textContent = t('popupLastActive') + last;
}

/* ------------------------------------------------------------------ 启动 */

/**
 * 把「当前语言 + 当前设置」渲染到界面上。
 *
 * 单独抽出来是因为**切换语言后要再跑一次**：文案是在创建 DOM 时一次性
 * t() 出来的，不重跑的话 popup 得关掉重开才会换语言。
 */
async function render(settings: ReaderSettings): Promise<void> {
  /*
   * 语言要在最前面定好：下面的 applyI18n、fillOptions 都依赖 t()，
   * 而 t() 读的就是这里设进去的语言。
   */
  setLocale(settings.locale);
  applyI18n();
  renderVersion();

  // 主题下拉的选项名里带 noteKey，也要跟着语言走；
  // 它会重建 <option>，所以必须排在 applySettingsToForm 之前，否则选中值会丢
  fillOptions(lightEl, 'light');
  fillOptions(darkEl, 'dark');

  applySettingsToForm(settings);
  await renderPermission();
}

async function init(): Promise<void> {
  await render(await loadSettings());

  // 事件只绑一次，与 render 分开
  modeEl.addEventListener('change', () => void save({ mode: modeEl.value as ThemeMode }));
  lightEl.addEventListener('change', () => void save({ lightTheme: lightEl.value }));
  darkEl.addEventListener('change', () => void save({ darkTheme: darkEl.value }));
  fontSizeEl.addEventListener('change', () => void save({ fontSize: fontSizeEl.value as FontSize }));
  contentWidthEl.addEventListener('change', () =>
    void save({ contentWidth: contentWidthEl.value as ContentWidth })
  );
  showTocEl.addEventListener('change', () => void save({ showToc: showTocEl.checked }));
  foldThresholdEl.addEventListener('change', () => {
    // 钳制后回显，让用户看到实际生效的值（输入 0 或负数时的反馈）
    const value = clampFoldThreshold(Number(foldThresholdEl.value));
    foldThresholdEl.value = String(value);
    void save({ foldThreshold: value });
  });
  defaultExpandLevelEl.addEventListener('change', () =>
    void save({ defaultExpandLevel: clampExpandLevel(Number(defaultExpandLevelEl.value)) })
  );
  resetEl.addEventListener('click', () => void handleResetClick());
  localeEl.addEventListener('change', async () => {
    await save({ locale: localeEl.value as Locale });
    // 语言变了，popup 自己这一屏的文案也要立刻换过来
    await render(await loadSettings());
  });
}

void init();
