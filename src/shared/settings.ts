/**
 * 阅读器设置：配色 + 排版。
 *
 * 存放在 chrome.storage.sync，跨设备同步。
 */

import { DEFAULT_DARK_THEME, DEFAULT_LIGHT_THEME } from '../render/theme-catalog';

export type ThemeMode = 'auto' | 'light' | 'dark';
export type FontSize = 'small' | 'medium' | 'large';
export type ContentWidth = 'narrow' | 'medium' | 'wide' | 'full';

export interface ReaderSettings {
  /** 配色模式 */
  mode: ThemeMode;
  lightTheme: string;
  darkTheme: string;

  /** 正文字号 */
  fontSize: FontSize;
  /** 正文最大宽度 */
  contentWidth: ContentWidth;
  /** 是否显示侧边目录 */
  showToc: boolean;
  /** 侧边目录宽度（px），可拖拽调整 */
  tocWidth: number;
  /**
   * 折叠功能的启用阈值：目录项数量**超过**该值时才显示折叠箭头与批量按钮。
   * 0 表示始终启用。短文档不需要折叠，多一排按钮反而是噪音。
   */
  foldThreshold: number;
}

/** 目录宽度的取值范围 */
export const TOC_WIDTH = {
  default: 268,
  min: 160,
  max: 560,
} as const;

/** 把任意输入夹到合法区间，顺便处理 NaN（storage 里可能是脏数据） */
export function clampTocWidth(width: number): number {
  if (!Number.isFinite(width)) return TOC_WIDTH.default;
  return Math.min(TOC_WIDTH.max, Math.max(TOC_WIDTH.min, Math.round(width)));
}

/** 折叠阈值的取值范围。0 = 始终启用；上限留得足够大，便于用户实质上关掉折叠 */
export const FOLD_THRESHOLD = {
  default: 10,
  min: 0,
  max: 9999,
} as const;

export function clampFoldThreshold(value: number): number {
  if (!Number.isFinite(value)) return FOLD_THRESHOLD.default;
  return Math.min(FOLD_THRESHOLD.max, Math.max(FOLD_THRESHOLD.min, Math.round(value)));
}

export const DEFAULT_SETTINGS: ReaderSettings = {
  mode: 'auto',
  lightTheme: DEFAULT_LIGHT_THEME,
  darkTheme: DEFAULT_DARK_THEME,
  fontSize: 'medium',
  contentWidth: 'medium',
  showToc: true,
  tocWidth: TOC_WIDTH.default,
  foldThreshold: FOLD_THRESHOLD.default,
};

/** 实际像素值，供 buildThemeCss 注入 CSS 变量 */
export const FONT_SIZE_PX: Record<FontSize, string> = {
  small: '14px',
  medium: '16px',
  large: '18px',
};

export const CONTENT_WIDTH_PX: Record<ContentWidth, string> = {
  narrow: '720px',
  medium: '900px',
  wide: '1120px',
  full: '100%',
};

/*
 * storage 读写的类型断言说明：
 * @types/chrome 把 get/set 的 keys 参数声明成带索引签名的对象，
 * 而 ReaderSettings 是普通 interface（无索引签名），直接传会重载匹配失败。
 * 这里统一封装，避免调用方到处写断言。
 */

export async function loadSettings(): Promise<ReaderSettings> {
  try {
    const stored = await chrome.storage.sync.get(
      DEFAULT_SETTINGS as unknown as Record<string, unknown>
    );
    const s = stored as Partial<ReaderSettings>;
    return {
      mode: s.mode ?? DEFAULT_SETTINGS.mode,
      lightTheme: s.lightTheme ?? DEFAULT_SETTINGS.lightTheme,
      darkTheme: s.darkTheme ?? DEFAULT_SETTINGS.darkTheme,
      fontSize: s.fontSize ?? DEFAULT_SETTINGS.fontSize,
      contentWidth: s.contentWidth ?? DEFAULT_SETTINGS.contentWidth,
      showToc: s.showToc ?? DEFAULT_SETTINGS.showToc,
      tocWidth: clampTocWidth(s.tocWidth ?? DEFAULT_SETTINGS.tocWidth),
      foldThreshold: clampFoldThreshold(s.foldThreshold ?? DEFAULT_SETTINGS.foldThreshold),
    };
  } catch {
    return DEFAULT_SETTINGS;
  }
}

export async function saveSettings(settings: ReaderSettings): Promise<void> {
  await chrome.storage.sync.set(settings as unknown as Record<string, unknown>);
}
