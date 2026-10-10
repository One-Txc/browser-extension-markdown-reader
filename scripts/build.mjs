/**
 * 构建脚本：esbuild 打包 content script 与 service worker。
 *
 * 为什么不用框架（Vite / WXT / Plasmo）：
 * content script 必须是自包含的 IIFE（不能有 ESM import，也不能依赖
 * web_accessible_resources），esbuild 的 `format: 'iife'` + `loader: {'.css':'text'}`
 * 正好覆盖这个需求，且零配置负担。
 *
 * 这个项目真正费劲的地方在于几处定制构建（ASCII 兜底、字体复制、CSS 作为字符串、
 * Mermaid 独立产物），框架并不会替你解决这些 —— 引入框架后仍然要自己写插件，
 * 反而多一层需要绕开的抽象。跨浏览器那点清单差异用 manifest.mjs 表达就够了。
 *
 * 用法：
 *   node scripts/build.mjs                    # Chrome / Edge（MV3）
 *   node scripts/build.mjs --target=firefox   # Firefox（MV2）
 *   node scripts/build.mjs --watch            # 监听重建
 */
import * as esbuild from 'esbuild';
import { rm, mkdir, cp, readFile, writeFile } from 'node:fs/promises';
import { buildManifest, LAYOUT } from './manifest.mjs';

const watch = process.argv.includes('--watch');
const target = process.argv.includes('--target=firefox') ? 'firefox' : 'chrome';
const { outDir, manifestPath, extRoot } = LAYOUT[target];

/**
 * 兜底把产物转成纯 ASCII。
 *
 * 背景：Chrome 加载扩展时会校验脚本文件的编码，任何非 ASCII 字节都可能被判成
 * 「该文件采用的不是 UTF-8 编码」而拒绝加载 content script（实测踩过）。
 *
 * esbuild 的 `charset: 'ascii'` 只能转义字符串与标识符，
 * **正则字面量里的非 ASCII 字符它不处理** —— 例如 markdown-it typographer 的
 * `/([?!])…/`、mermaid 的 `/[îïíì]/`，这些会让产物残留少量非 ASCII 字节。
 *
 * 这里统一转成 \uXXXX：该写法在字符串、正则、标识符三种上下文里语义都等价
 * （CSS 是作为 JS 字符串嵌进来的，运行时还原后 CSS 看到的仍是原字符）。
 * 补充平面字符会被拆成一对代理项转义，同样可还原。
 */
async function asciiEscape(file) {
  let source;
  try {
    source = await readFile(file, 'utf8');
  } catch {
    return;
  }

  const escaped = source.replace(/[^\x00-\x7F]/g, (ch) => {
    return '\\u' + ch.charCodeAt(0).toString(16).padStart(4, '0');
  });

  if (escaped !== source) await writeFile(file, escaped, 'utf8');

  // 断言：产物必须是纯 ASCII。
  // Chrome 加载扩展时对脚本编码的校验比「是否合法 UTF-8」更严，
  // 一旦残留非 ASCII 字节就会拒绝加载 content script，且报错只说是编码问题，
  // 排查成本很高 —— 所以在构建期直接拦住。
  const bytes = await readFile(file);
  const offset = bytes.findIndex((b) => b > 0x7f);
  if (offset >= 0) {
    throw new Error(
      `${file} 仍含非 ASCII 字节（偏移 ${offset}），Chrome 会拒绝加载。请检查产物是否被其它步骤改写。`
    );
  }
}

/** 每个产物构建完成后立刻做一次 ASCII 兜底（watch 模式也生效） */
function asciiPlugin(out) {
  return {
    name: 'ascii-escape',
    setup(build) {
      build.onEnd(async (result) => {
        if (result.errors.length > 0) return;
        await asciiEscape(out);
      });
    },
  };
}

/** @type {import('esbuild').BuildOptions} */
const base = {
  bundle: true,
  format: 'iife',
  platform: 'browser',
  target: ['chrome110'],
  // 所有 .css 都作为字符串导入（import css from './x.css'）
  loader: { '.css': 'text' },
  legalComments: 'none',
  minify: !watch,
  sourcemap: watch ? 'inline' : false,
  logLevel: 'info',
  // ★ 必须保持 'ascii'（esbuild 默认值）。
  // 设为 'utf8' 会让 esbuild 在产物里保留原始非 ASCII 字符，即使文件是合法 UTF-8，
  // Chrome 加载扩展时也会报「该文件采用的不是 UTF-8 编码」而拒绝加载 content script。
  // ASCII 是 UTF-8 的真子集，esbuild 会把中文等字符转义成 \uXXXX（CSS 里用 CSS 转义），
  // 运行时由 JS 引擎还原，功能不受影响。
  charset: 'ascii',
  define: {
    'process.env.NODE_ENV': watch ? '"development"' : '"production"',
    /*
     * 构建时间，显示在 popup 里。
     *
     * 版本号在开发期几乎不变，看不出「浏览器里加载的是不是刚才那次构建」；
     * 构建时间每次都不一样，刷新 popup 一眼就能确认。
     */
    __BUILD_TIME__: JSON.stringify(
      new Date().toLocaleString('zh-CN', {
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        hour12: false,
      })
    ),
  },
};

const entries = [
  { in: 'src/content.ts', out: `${outDir}/content.js` },
  { in: 'src/background.ts', out: `${outDir}/background.js` },
  { in: 'src/popup/popup.ts', out: `${outDir}/popup.js` },
  // Mermaid 单独打包：只在页面真的含 ```mermaid 时按需注入，不拖累常规页面
  { in: 'src/render/mermaid-entry.ts', out: `${outDir}/mermaid.js` },
];

/*
 * 只清理本目标的扩展根。
 *
 * 不能清空整个 output/ —— build:all 会连续构建两次，
 * 第二次会把第一次刚生成的产物一起删掉。
 */
await rm(extRoot, { recursive: true, force: true });
await mkdir(outDir, { recursive: true });

// 清单也由脚本生成：两个平台的字段差异集中在 manifest.mjs，避免两份静态 JSON 漂移
await writeFile(manifestPath, JSON.stringify(buildManifest(target), null, 2) + '\n', 'utf8');

// popup 的 HTML 一并产出到产物目录，这样清单里可以统一写相对路径
await cp('src/popup/popup.html', `${outDir}/popup.html`);

// KaTeX 字体：只复制 woff2（20 个 / 约 260KB），浏览器优先使用它。
// 这些文件要由 file:// 页面加载，因此必须在清单的 web_accessible_resources
// 里声明，且路径以 chrome-extension:// 绝对地址引用。
await cp('node_modules/katex/dist/fonts', `${outDir}/fonts`, {
  recursive: true,
  filter: (src) => !src.endsWith('.ttf') && !src.endsWith('.woff'),
});

const entryOptions = (e) => ({
  ...base,
  entryPoints: [e.in],
  outfile: e.out,
  plugins: [asciiPlugin(e.out)],
});

if (watch) {
  const contexts = await Promise.all(entries.map((e) => esbuild.context(entryOptions(e))));
  await Promise.all(contexts.map((c) => c.watch()));
  console.log(`[build] watching for changes… (target=${target})`);
} else {
  const started = Date.now();
  await Promise.all(entries.map((e) => esbuild.build(entryOptions(e))));
  console.log(`[build] done in ${Date.now() - started}ms (target=${target}, out=${outDir})`);
}
