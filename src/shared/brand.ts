/**
 * 品牌信息 —— 产品名的**唯一出处**。
 *
 * ★ 改名只改 brand.json 一个文件，下面这些地方全部由它派生：
 *   - manifest 的 name 与 action.default_title（scripts/build/manifest.mjs 读取）
 *   - popup 的 <title> 与 <h1>（data-ext-name 标记，由 popup.ts 填充）
 *   - 控制台日志前缀（LOG_PREFIX）
 *   - 打包产物的 zip 文件名（scripts/build/package.py 读取 slug）
 *
 * ★ 为什么用 JSON 而不是 .ts：构建脚本（Node 的 manifest.mjs / build.mjs）
 *   和打包脚本（Python 的 package.py）也要读同一份。JSON 是 TS、Node、Python
 *   三边都能直接解析的最小公共格式，不需要为任何一侧维护第二份常量。
 *
 * ★ 为什么不在 src/_locales 里放 extName：品牌名各语言都不翻译，
 *   放进语言包意味着改名要同步四份，漏一份那门语言就会显示旧名。
 *   所以 manifest 直接写品牌名，语言包只留真正需要翻译的文案；
 *   文案里需要提到产品名的地方用 `$1` 占位符，调用时传入 EXT_NAME。
 *
 * ★ 不要跟着一起改的东西（属于稳定的内部标识，与显示名无关，
 *   改掉会让老用户的设置丢失或样式失效）：
 *   - CSS 类名与标记属性：md-reader-*、data-md-reader-done
 *   - 全局变量：__mdReaderPerf
 *   - storage 键、性能标记前缀 md-reader:
 *   - Firefox 的 gecko.id（改了等于换一个扩展，老用户收不到更新）
 */
import brand from './brand.json';

/** 产品显示名：manifest、popup 标题、商店卡片、日志前缀都用它 */
export const EXT_NAME: string = brand.name;

/** 文件名用的短标识：发布包的 zip 名（不含空格，便于命令行与商店后台辨认） */
export const EXT_SLUG: string = brand.slug;

/** 控制台日志前缀，形如 `[Just Markdown]` */
export const LOG_PREFIX = `[${EXT_NAME}]`;
