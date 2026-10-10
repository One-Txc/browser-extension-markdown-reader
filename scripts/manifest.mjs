/**
 * 扩展清单生成。
 *
 * 为什么用代码生成而不是静态 JSON：
 * Chrome/Edge 与 Firefox 的清单字段差异不小，静态文件只能维护两份、迟早漂移。
 * 这里用「一份公共配置 + 目标覆盖」，全部差异集中在这一个文件里，读一遍就清楚。
 *
 * 两个目标的差异（均为实测确认）：
 *   - background：MV3 用 service_worker；MV2 用 scripts（Firefox 无 SW 支持）
 *   - web_accessible_resources：MV3 是 {resources, matches} 数组；MV2 是纯路径数组
 *   - host_permissions：MV2 没有该字段，主机权限要合并进 permissions
 *   - Firefox 必须显式声明 gecko.id，否则 storage.sync 不可用
 *
 * 注意本文件是 .mjs（纯 JS），不要写 TypeScript 语法。
 *
 * @typedef {'chrome' | 'firefox'} Target
 */

/**
 * 各目标的产物布局。
 *
 * 统一输出到 output/ 下、按清单版本分目录（参考 WXT 的做法）：
 *
 *   output/
 *     MV3/            ← 扩展根，Chrome / Edge 加载这个目录
 *       manifest.json
 *       build/…
 *     MV2/            ← 扩展根，Firefox 加载这里的 manifest.json
 *       manifest.json
 *       build/…
 *
 * 两个目标的内部结构完全一致（脚本都在 build/ 下），因此清单里的路径相同，
 * 源码不需要按平台分支 —— background 注入 Mermaid 的路径两个平台通用。
 *
 * @type {Record<Target, {
 *   extRoot: string,
 *   outDir: string,
 *   manifestPath: string,
 *   needsPrefix: boolean,
 * }>}
 */
export const LAYOUT = {
  chrome: {
    /** 扩展根目录（在浏览器里加载扩展时选的那个目录） */
    extRoot: 'output/MV3',
    /** 脚本、字体等产物的输出目录 */
    outDir: 'output/MV3/build',
    /** 清单文件的位置 */
    manifestPath: 'output/MV3/manifest.json',
    /** 清单里引用产物时是否需要 build/ 前缀 */
    needsPrefix: true,
  },
  firefox: {
    extRoot: 'output/MV2',
    outDir: 'output/MV2/build',
    manifestPath: 'output/MV2/manifest.json',
    needsPrefix: true,
  },
};

const NAME = 'MD Reader';
const VERSION = '0.1.0';
const DESCRIPTION = '直接在浏览器中优雅地阅读本地 .md 文件，无需任何本地服务。';

/**
 * Firefox 要求显式扩展 ID。
 * strict_min_version 定在 128：scripting.executeScript 的 world:'MAIN'
 * （Mermaid 注入依赖它）从该版本起支持 —— Mozilla 把这个 MV3 API 一并回移到了 MV2。
 */
const GECKO_ID = 'md-reader@local.extension';
const GECKO_MIN_VERSION = '128.0';

/**
 * @param {Target} target
 * @returns {Record<string, unknown>}
 */
export function buildManifest(target) {
  const { needsPrefix } = LAYOUT[target];

  /**
   * 把产物文件名拼成清单里的路径。
   * @param {string} file
   */
  const p = (file) => (needsPrefix ? `build/${file}` : file);

  const common = {
    name: NAME,
    version: VERSION,
    description: DESCRIPTION,
    permissions: ['storage', 'scripting'],
    content_scripts: [
      {
        matches: ['file:///*'],
        js: [p('content.js')],
        run_at: 'document_start',
        all_frames: false,
      },
    ],
    action: {
      default_popup: p('popup.html'),
      default_title: NAME,
    },
  };

  if (target === 'firefox') {
    return {
      ...common,
      manifest_version: 2,
      // MV2 没有 host_permissions，主机权限直接列进 permissions
      permissions: [...common.permissions, 'file:///*'],
      background: {
        scripts: [p('background.js')],
        persistent: false,
      },
      // MV2 的 web_accessible_resources 是纯路径数组，没有 matches 概念
      web_accessible_resources: [p('fonts/*')],
      browser_specific_settings: {
        gecko: { id: GECKO_ID, strict_min_version: GECKO_MIN_VERSION },
      },
    };
  }

  return {
    ...common,
    manifest_version: 3,
    // scripting.executeScript 的 world 参数需要 Chrome 111+
    minimum_chrome_version: '111',
    host_permissions: ['file:///*'],
    background: { service_worker: p('background.js') },
    web_accessible_resources: [{ resources: [p('fonts/*')], matches: ['file:///*'] }],
  };
}
