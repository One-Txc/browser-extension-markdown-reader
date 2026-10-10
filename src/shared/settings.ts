/**
 * 阅读器设置：配色 + 排版。
 *
 * 存放在 chrome.storage.sync，跨设备同步。
 */

import { DEFAULT_DARK_THEME, DEFAULT_LIGHT_THEME } from '../render/theme-catalog';
import type { Locale } from './i18n';
import { LOCALES } from './i18n';

/**
 * 外观模式。
 *
 * 前三个是基础明暗；后面五个是护眼配色 —— 它们本质上都是「浅色/深色的变体」，
 * 差别只在页面底色与文字色，所以归在同一个下拉里，而不是另做一个开关
 * （那样会出现「深色 + 羊皮纸」这种自相矛盾的组合）。
 */
export type ThemeMode =
  | 'auto'
  | 'light'
  | 'dark'
  /** 羊皮纸：最接近纸质书，暖度明显 */
  | 'parchment'
  /** 护眼模式：豆沙绿，国内用户熟悉 */
  | 'eyecare'
  /** 暖白：只是觉得纯白刺眼，变化最轻 */
  | 'warmwhite'
  /** 柔灰：只降对比、不改变色相 */
  | 'softgray'
  /** 暗夜暖调：夜间用，比纯深色柔和、无冷蓝感 */
  | 'darkwarm';

/** 可选外观，顺序即设置界面的排列顺序 */
export const THEME_MODES: ThemeMode[] = [
  'auto',
  'light',
  'dark',
  'parchment',
  'eyecare',
  'warmwhite',
  'softgray',
  'darkwarm',
];

/**
 * 护眼配色（相对于基础明暗）。
 *
 * 单独列出是因为 github-markdown-css 把正文颜色硬编码在 .markdown-body 上，
 * 不吃我们的 CSS 变量 —— 这几套配色需要额外覆盖正文的关键颜色才能生效，
 * 而基础明暗下不能覆盖（它们的变量值本就与 DOC_CSS 一致，多此一举反而有风险）。
 */
export const EYE_CARE_MODES: ThemeMode[] = [
  'parchment',
  'eyecare',
  'warmwhite',
  'softgray',
  'darkwarm',
];

export function isEyeCareMode(mode: ThemeMode): boolean {
  return EYE_CARE_MODES.includes(mode);
}

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
  /**
   * 启用折叠时，默认展开到第几层。
   *
   * N 表示「展开第 N 层」——第 N 层及更浅的节点都展开，更深的一律收起：
   *   -1 = 全部展开
   *    0 = 不展开任何层，只显示第一层
   *    1 = 展开第一层，可见前两层
   *    2 = 展开前两层，可见前三层
   *
   * 只在折叠策略本身变化时生效，不会覆盖用户的手动折叠。
   */
  defaultExpandLevel: number;

  /* ---------------- 「文件夹」面板的偏好（刷新后保留） ---------------- */

  /** 排序依据 */
  folderSortField: 'name' | 'size' | 'modified';
  /** 是否升序 */
  folderSortAsc: boolean;
  /** 文件夹是否始终排在文件之前 */
  folderFoldersFirst: boolean;
  /** 是否显示以 . 开头的隐藏项 */
  folderShowHidden: boolean;
  /** 设置面板是否展开（默认展开，收起后刷新仍保留收起状态） */
  folderSettingsOpen: boolean;

  /** 界面语言；auto 表示跟随浏览器 */
  locale: Locale;

  /** 设置弹窗里「高级设置」分组是否展开（默认收起，大部分人不改它） */
  advancedOpen: boolean;
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
  default: 25,
  min: 0,
  max: 9999,
} as const;

export function clampFoldThreshold(value: number): number {
  if (!Number.isFinite(value)) return FOLD_THRESHOLD.default;
  return Math.min(FOLD_THRESHOLD.max, Math.max(FOLD_THRESHOLD.min, Math.round(value)));
}

/** 默认展开层数的取值范围 */
export const EXPAND_LEVEL = {
  default: 1,
  /** 全部展开 */
  all: -1,
  min: -1,
  max: 10,
} as const;

export function clampExpandLevel(value: number): number {
  if (!Number.isFinite(value)) return EXPAND_LEVEL.default;
  return Math.min(EXPAND_LEVEL.max, Math.max(EXPAND_LEVEL.min, Math.round(value)));
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
  defaultExpandLevel: EXPAND_LEVEL.default,

  folderSortField: 'name',
  folderSortAsc: true,
  folderFoldersFirst: true,
  folderShowHidden: true,
  folderSettingsOpen: true,

  locale: 'auto',

  advancedOpen: false,
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
      // 白名单校验：storage 里可能是旧版本留下的、或用户手改过的值
      mode: THEME_MODES.includes(s.mode as ThemeMode)
        ? (s.mode as ThemeMode)
        : DEFAULT_SETTINGS.mode,
      lightTheme: s.lightTheme ?? DEFAULT_SETTINGS.lightTheme,
      darkTheme: s.darkTheme ?? DEFAULT_SETTINGS.darkTheme,
      fontSize: s.fontSize ?? DEFAULT_SETTINGS.fontSize,
      contentWidth: s.contentWidth ?? DEFAULT_SETTINGS.contentWidth,
      showToc: s.showToc ?? DEFAULT_SETTINGS.showToc,
      tocWidth: clampTocWidth(s.tocWidth ?? DEFAULT_SETTINGS.tocWidth),
      foldThreshold: clampFoldThreshold(s.foldThreshold ?? DEFAULT_SETTINGS.foldThreshold),
      defaultExpandLevel: clampExpandLevel(
        s.defaultExpandLevel ?? DEFAULT_SETTINGS.defaultExpandLevel
      ),

      folderSortField:
        s.folderSortField === 'size' || s.folderSortField === 'modified'
          ? s.folderSortField
          : DEFAULT_SETTINGS.folderSortField,
      folderSortAsc: s.folderSortAsc ?? DEFAULT_SETTINGS.folderSortAsc,
      folderFoldersFirst: s.folderFoldersFirst ?? DEFAULT_SETTINGS.folderFoldersFirst,
      folderShowHidden: s.folderShowHidden ?? DEFAULT_SETTINGS.folderShowHidden,
      folderSettingsOpen: s.folderSettingsOpen ?? DEFAULT_SETTINGS.folderSettingsOpen,

      // 用 LOCALES 校验，加语言时只需改 i18n.ts 一处
      locale: LOCALES.includes(s.locale as Locale)
        ? (s.locale as Locale)
        : DEFAULT_SETTINGS.locale,

      advancedOpen: s.advancedOpen ?? DEFAULT_SETTINGS.advancedOpen,
    };
  } catch {
    return DEFAULT_SETTINGS;
  }
}

export async function saveSettings(settings: ReaderSettings): Promise<void> {
  await chrome.storage.sync.set(settings as unknown as Record<string, unknown>);
}
