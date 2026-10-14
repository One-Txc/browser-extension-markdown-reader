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

const NAME = '__MSG_extName__';
/**
 * 版本号。★ 唯一的版本来源 —— 改这里即可，package.json 只是给 npm 看的。
 * Chrome 与 Firefox 都会拒绝「版本号回退」的上传，改小之前务必确认。
 */
const VERSION = '1.0.0';
/** 由浏览器按 __MSG_extDescription__ 从 _locales 解析 */
const DESCRIPTION = '__MSG_extDescription__';

/*
 * content script 的注入范围：本地文档 + 在线文档。
 *
 * ★ 在线这一档只能写「http 与 https 的全部路径」，无法在清单里限定只匹配 .md ——
 * 服务器给的 Content-Type 不一定是 text/markdown，URL 也未必以 .md 结尾。
 * 所以脚本会注入到每个 http(s) 页面，真正的筛选在运行时做：
 * isMarkdownPage() 先看 document.contentType，text/plain 时再看路径后缀，
 * 不匹配就立刻 return，不做任何 DOM 改动（尤其是不会隐藏页面）。
 *
 * 代价是安装时会出现「读取您在所有网站上的数据」这类权限提示。
 */
const MATCHES = ['file:///*', 'http://*/*', 'https://*/*'];

/*
 * 扩展图标。形状取自 folder.ts 里表示 Markdown 文件的那枚
 * （圆角卡片 + M 折线），位图直接提交在 src/icons 下，由 build.mjs 复制 ——
 * manifest 只接受位图，认不了 SVG，所以这里只能是 PNG。
 *
 * 路径不带 build/ 前缀：图标与语言包这类资源必须位于**扩展根目录**。
 * 源码在 src/icons 下，构建时由 build.mjs 复制到每个目标的扩展根，
 * 产物里仍叫 icons/ —— 这个名字是浏览器定的，不跟着源码目录走。
 */
const ICONS = {
  16: 'icons/icon16.png',
  32: 'icons/icon32.png',
  48: 'icons/icon48.png',
  128: 'icons/icon128.png',
};

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
    /*
     * 语言包目录 _locales 必须位于扩展根目录，浏览器据此解析上面的 __MSG_ 占位。
     * 源码在 src/_locales，构建时由 build.mjs 复制到每个目标的扩展根 ——
     * 目录名保持 _locales，浏览器只认这个位置。
     */
    default_locale: 'zh_CN',
    permissions: ['storage', 'scripting'],
    /*
     * 扩展图标，形状取自 folder.ts 里表示 Markdown 文件的那枚
     * （圆角卡片 + M 折线）。位图直接提交在 src/icons 下 ——
     * manifest 只接受位图，认不了 SVG，所以这里只能是 PNG。
     */
    icons: ICONS,
    content_scripts: [
      {
        matches: MATCHES,
        js: [p('content.js')],
        run_at: 'document_start',
        all_frames: false,
      },
    ],
    action: {
      default_popup: p('popup.html'),
      default_title: NAME,
      default_icon: ICONS,
    },
  };

  if (target === 'firefox') {
    return {
      ...common,
      manifest_version: 2,
      // MV2 没有 host_permissions，主机权限直接列进 permissions
      permissions: [...common.permissions, ...MATCHES],
      background: {
        scripts: [p('background.js')],
        persistent: false,
      },
      // MV2 的 web_accessible_resources 是纯路径数组，没有 matches 概念
      web_accessible_resources: [p('fonts/*'), 'icons/*'],
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
    host_permissions: MATCHES,
    background: { service_worker: p('background.js') },
    /*
     * fonts：在线文档里的公式要取 KaTeX 字体，否则退化成回退字体。
     * icons：content script 会给渲染后的页面插一个 <link rel="icon">，
     *        让标签页显示本扩展的图标；读 chrome-extension:// 资源必须在这里声明，
     *        否则会被拒绝。
     */
    web_accessible_resources: [{ resources: [p('fonts/*'), 'icons/*'], matches: MATCHES }],
  };
}
