/**
 * 国际化。
 *
 * ★ 语言包用 import 静态引入，而不是运行时 fetch `_locales/<locale>/messages.json`：
 *   1. t() 必须同步返回，fetch 是异步的 —— 否则每个调用点都得 await
 *   2. content script 读取扩展资源要经过 web_accessible_resources，
 *      而 `_locales` 是特殊目录，能否这样暴露并不确定
 * 数据源仍然是 `_locales/` 下的那一份，与 manifest 的 `__MSG_key__` 共用，
 * 不存在两套文案需要同步维护的问题。
 *
 * ★ 为什么不直接用 chrome.i18n.getMessage：
 * 它只能跟随浏览器语言，无法手动切换。本地文档阅读器有个常见场景 ——
 * 系统是英文、但常读中文文档，这时用户会希望界面语言单独可选。
 * 所以这里加了一层：优先读用户设置，没设置才回退到 chrome.i18n。
 */

import enMessages from '../../_locales/en/messages.json';
import jaMessages from '../../_locales/ja/messages.json';
import koMessages from '../../_locales/ko/messages.json';
import zhMessages from '../../_locales/zh_CN/messages.json';

/** auto = 跟随浏览器 */
export type Locale = 'auto' | 'zh_CN' | 'en' | 'ja' | 'ko';

/** 可选语言。'auto' 必须排第一，popup 的下拉按这个顺序生成 */
export const LOCALES: Locale[] = ['auto', 'zh_CN', 'en', 'ja', 'ko'];

interface MessageEntry {
  message: string;
  description?: string;
}

type MessageTable = Record<string, MessageEntry>;

/**
 * 可手动切换的语言包。
 * 新增语言时在这里加一行、并在 _locales/ 下建对应目录即可。
 */
const TABLES: Record<string, MessageTable> = {
  zh_CN: zhMessages as MessageTable,
  en: enMessages as MessageTable,
  ja: jaMessages as MessageTable,
  ko: koMessages as MessageTable,
};

let current: Locale = 'auto';

export function setLocale(locale: Locale): void {
  current = locale;
}

export function getLocale(): Locale {
  return current;
}

/** 把 $1 $2 … 替换成实际值（沿用 Chrome 的占位符语法，不另造一套） */
function applySubs(text: string, subs?: string[]): string {
  if (!subs || subs.length === 0) return text;
  return text.replace(/\$(\d+)/g, (whole, idx: string) => {
    const i = Number(idx) - 1;
    return subs[i] ?? whole;
  });
}

/** 浏览器原生查表；缺失时返回空串而不是抛错 */
function nativeGet(key: string, subs?: string[]): string {
  try {
    return chrome.i18n?.getMessage(key, subs) ?? '';
  } catch {
    return '';
  }
}

/**
 * 取文案。
 *
 * @param key 语言包里的键
 * @param subs `$1` `$2` … 的替换值
 *
 * 查不到时返回 key 本身 —— 界面上会显示成 `folder_sort` 这样的原始键，
 * 便于一眼发现漏翻，而不是静默变成空白。
 */
export function t(key: string, subs?: string[]): string {
  if (current !== 'auto') {
    const entry = TABLES[current]?.[key];
    if (entry) return applySubs(entry.message, subs);
  }
  // 回退：chrome.i18n 已按浏览器语言选好表，也自带占位符替换
  return nativeGet(key, subs) || key;
}

/** 当前实际生效的语言（用于在 UI 上标注「跟随浏览器」到底跟到了哪个） */
export function effectiveLocale(): string {
  if (current !== 'auto') return current;
  try {
    return chrome.i18n?.getUILanguage?.() ?? 'unknown';
  } catch {
    return 'unknown';
  }
}
