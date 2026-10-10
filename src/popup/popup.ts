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
 */
versionEl.textContent = `v${chrome.runtime.getManifest().version} · 构建于 ${__BUILD_TIME__}`;

const SETTINGS_URL = 'chrome://extensions/?id=' + chrome.runtime.id;

/* -------------------------------------------------------------- 设置读写 */

function fillOptions(select: HTMLSelectElement, appearance: Appearance): void {
  select.replaceChildren(
    ...themesFor(appearance).map((theme) => {
      const option = document.createElement('option');
      option.value = theme.id;
      option.textContent = theme.name;
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
  resetEl.textContent = '恢复默认设置';
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
    resetEl.textContent = '再点一次确认恢复';
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

  resetEl.textContent = '已恢复默认';
  window.setTimeout(() => {
    resetEl.textContent = '恢复默认设置';
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
    statusEl.innerHTML = '<b>✓ 已在本地 Markdown 页面上生效</b>';
    detailEl.innerHTML = '<div class="hint">改动设置后，当前页面会立即更新，无需刷新。</div>';
  } else {
    statusEl.className = 'status bad';
    statusEl.innerHTML = '<b>尚未在本地 Markdown 页面生效</b><br>常见原因是缺少文件访问权限。';
    detailEl.innerHTML = [
      '<ol>',
      `<li>在地址栏打开：<br><code>${SETTINGS_URL}</code></li>`,
      '<li>找到「MD Reader」，打开「<b>允许访问文件网址</b>」</li>',
      '<li>回到 <code>.md</code> 页面按 <b>F5</b> 刷新</li>',
      '</ol>',
    ].join('');
  }

  const last = data.fileAccessLastSeen
    ? new Date(data.fileAccessLastSeen as number).toLocaleString()
    : '从未';
  metaEl.textContent = '最近一次生效：' + last;
}

/* ------------------------------------------------------------------ 启动 */

async function init(): Promise<void> {
  fillOptions(lightEl, 'light');
  fillOptions(darkEl, 'dark');

  applySettingsToForm(await loadSettings());

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
  localeEl.addEventListener('change', () => void save({ locale: localeEl.value as Locale }));

  await renderPermission();
}

void init();
