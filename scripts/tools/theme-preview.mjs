/**
 * 生成代码高亮主题预览页。
 *
 * 为什么需要它：highlight.js 的 164 套主题全是 `.hljs-*` 作用域的选择器，
 * 直接在一个页面里引入多套会互相覆盖，根本没法并排对比。
 * 这里在构建期给每套主题的选择器加独立前缀（`.t-<theme> `），实现真正的隔离。
 *
 * 输出的 HTML 是自包含的（无外部依赖），直接双击打开即可对比。
 *
 * 用法：node scripts/tools/theme-preview.mjs
 */
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import hljs from 'highlight.js/lib/core';
import javascript from 'highlight.js/lib/languages/javascript';
import python from 'highlight.js/lib/languages/python';
import sql from 'highlight.js/lib/languages/sql';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const OUT = join(ROOT, 'preview', '代码主题预览.html');

hljs.registerLanguage('javascript', javascript);
hljs.registerLanguage('python', python);
hljs.registerLanguage('sql', sql);

/* ------------------------------------------------------------ 主题清单 */

const LIGHT_THEMES = [
  ['github', '当前使用'],
  ['atom-one-light', ''],
  ['stackoverflow-light', ''],
  ['xcode', ''],
  ['intellij-light', ''],
  ['vs', ''],
  ['tokyo-night-light', ''],
  ['a11y-light', '高对比度'],
];

const DARK_THEMES = [
  ['github-dark', ''],
  ['github-dark-dimmed', ''],
  ['atom-one-dark', ''],
  ['tokyo-night-dark', ''],
  ['nord', ''],
  ['night-owl', ''],
  ['monokai', ''],
  ['vs2015', ''],
  ['rose-pine', ''],
  ['rose-pine-moon', ''],
  ['a11y-dark', '高对比度'],
];

/* ------------------------------------------------------------ 代码样本 */

const SAMPLES = [
  {
    lang: 'javascript',
    label: 'JavaScript',
    code: `// 用户权限校验中间件
import { verify } from './auth.js';

const CACHE_TTL = 3600;
const ALLOWED_ROLES = ['admin', 'editor'];

export async function requireRole(req, res, next, role = 'admin') {
  const token = req.headers['authorization']?.replace(/^Bearer\\s+/, '');
  if (!token) {
    return res.status(401).json({ error: '缺少令牌', code: 'NO_TOKEN' });
  }
  try {
    const payload = await verify(token, process.env.JWT_SECRET);
    if (!ALLOWED_ROLES.includes(payload.role)) {
      throw new Error(\`角色 \${payload.role} 无权访问\`);
    }
    req.user = payload;
    next();
  } catch (err) {
    console.error('[auth] 校验失败:', err.message);
    res.status(403).json({ error: '禁止访问' });
  }
}`,
  },
  {
    lang: 'python',
    label: 'Python',
    code: `from dataclasses import dataclass
from typing import Optional


@dataclass
class Review:
    """评论数据模型"""
    review_id: int
    rating: float
    text: Optional[str] = None

    def summary(self) -> str:
        status = "好评" if self.rating >= 4.0 else "差评"
        return f"[{status}] {self.text[:20]}... (#{self.review_id})"`,
  },
  {
    lang: 'sql',
    label: 'SQL',
    code: `SELECT r.review_id, COUNT(*) AS topic_count
FROM platinum_bi.mv_voc AS r
LEFT JOIN platinum_foundation.fact_voc_topic AS t
    ON r.review_id = t.review_id
WHERE r.rating >= 4.0
  AND r.dt = '2026-08-19'
GROUP BY r.review_id
ORDER BY topic_count DESC
LIMIT 20;`,
  },
];

/* ---------------------------------------------------------- CSS 前缀化 */

/**
 * 把 CSS 按顶层切成「普通规则」与「@media/@supports 块」两类。
 * 需要按括号深度扫描，因为 @media 块内部也有花括号。
 */
function splitTopLevel(css) {
  const blocks = [];
  let buf = '';
  let i = 0;

  while (i < css.length) {
    if (css[i] !== '@') {
      buf += css[i];
      i += 1;
      continue;
    }

    const braceIdx = css.indexOf('{', i);
    if (braceIdx === -1) {
      buf += css.slice(i);
      break;
    }

    const header = css.slice(i, braceIdx).trim();
    let depth = 0;
    let j = braceIdx;
    for (; j < css.length; j += 1) {
      if (css[j] === '{') depth += 1;
      else if (css[j] === '}') {
        depth -= 1;
        if (depth === 0) break;
      }
    }

    if (buf.trim()) blocks.push({ at: null, body: buf });
    buf = '';
    blocks.push({ at: header, body: css.slice(braceIdx + 1, j) });
    i = j + 1;
  }

  if (buf.trim()) blocks.push({ at: null, body: buf });
  return blocks;
}

/** 给一段扁平 CSS 的每条选择器加前缀 */
function prefixRules(css, prefix) {
  const out = [];
  const ruleRe = /([^{}]+)\{([^{}]*)\}/g;
  let match;

  while ((match = ruleRe.exec(css)) !== null) {
    const selectors = match[1].trim();
    const body = match[2].trim();
    if (!selectors || !body || selectors.startsWith('@')) continue;

    const prefixed = selectors
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean)
      // :root / html / body 前缀化后会永不匹配，必须改写成前缀元素自身，
      // 否则定义了 CSS 变量的主题（如 a11y-light）会整片失色
      .map((s) => (s === ':root' || s === 'html' || s === 'body' ? prefix : `${prefix} ${s}`))
      .join(',\n');

    out.push(`${prefixed} {\n  ${body}\n}`);
  }
  return out.join('\n');
}

/**
 * 给主题 CSS 的每条选择器加前缀，实现单页多主题隔离。
 */
function prefixCss(css, prefix) {
  const stripped = css.replace(/\/\*[\s\S]*?\*\//g, '');

  return splitTopLevel(stripped)
    .map((block) => {
      const rules = prefixRules(block.body, prefix);
      if (!rules) return '';
      return block.at ? `${block.at} {\n${rules}\n}` : rules;
    })
    .filter(Boolean)
    .join('\n');
}

/* ---------------------------------------------------------------- 生成 */

/**
 * 代码块容器背景色 —— 必须与 src/render/theme-catalog.ts 保持一致。
 * 浅色主题统一用 #f1f3f5，因为主题自带的 #fff/#fafafa 在白文档上看不出边界。
 */
const CODE_BG = {
  'atom-one-light': '#f1f3f5',
  'stackoverflow-light': '#f1f3f5',
  xcode: '#f1f3f5',
  github: '#f1f3f5',
  'tokyo-night-light': '#f1f3f5',
  'intellij-light': '#f1f3f5',
  vs: '#f1f3f5',
  'a11y-light': '#f1f3f5',

  'atom-one-dark': '#282c34',
  'github-dark': '#161b22',
  'github-dark-dimmed': '#22272e',
  'tokyo-night-dark': '#1a1b26',
  nord: '#2e3440',
  'night-owl': '#011627',
  monokai: '#272822',
  vs2015: '#1e1e1e',
  'rose-pine': '#191724',
  'rose-pine-moon': '#232136',
  'a11y-dark': '#2b2b2b',
};

function renderCode(sample, codeBg) {
  const html = hljs.highlight(sample.code, {
    language: sample.lang,
    ignoreIllegals: true,
  }).value;
  // 内联背景与扩展实际渲染一致（扩展侧由 --md-code-bg 提供），
  // 内联样式优先级最高，可覆盖主题自带的 .hljs background
  const style = codeBg ? ` style="background:${codeBg}"` : '';
  return `<pre><code class="hljs language-${sample.lang}"${style}>${html}</code></pre>`;
}

function escapeHtml(s) {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

async function buildSection(themes, title, note) {
  const cards = [];

  for (const [name] of themes) {
    const cssPath = join(ROOT, 'node_modules', 'highlight.js', 'styles', `${name}.css`);
    const raw = await readFile(cssPath, 'utf8');
    const prefixed = prefixCss(raw, `.t-${name}`);

    const codeBg = CODE_BG[name] ?? '';
    const blocks = SAMPLES.map(
      (s) =>
        `<div class="sample"><span class="lang">${escapeHtml(s.label)}</span>${renderCode(
          s,
          codeBg
        )}</div>`
    ).join('\n');

    cards.push(
      `<section class="card">
  <h3><code>${escapeHtml(name)}</code><span class="tag">${escapeHtml(
        themes.find((t) => t[0] === name)?.[1] ?? ''
      )}</span></h3>
  <div class="t-${name} demo">${blocks}</div>
</section>

<style>
${prefixed}
</style>`
    );
  }

  return `<h2>${escapeHtml(title)}<small>${escapeHtml(note)}</small></h2>
<div class="grid">
${cards.join('\n')}
</div>`;
}

const lightSection = await buildSection(LIGHT_THEMES, '浅色主题', '适合浅色文档背景');
const darkSection = await buildSection(DARK_THEMES, '深色主题', '适合深色文档背景 / 夜间阅读');

const page = `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<title>代码高亮主题预览 · Markdown Read</title>
<style>
  :root { color-scheme: light; }
  body {
    margin: 0;
    padding: 28px 24px 80px;
    background: #f6f8fa;
    color: #1f2328;
    font: 14px/1.6 system-ui, "Segoe UI", "Microsoft YaHei", sans-serif;
  }
  h1 { font-size: 20px; margin: 0 0 6px; }
  .intro {
    max-width: 860px; margin: 0 0 28px; padding: 12px 16px;
    background: #fff8c5; border: 1px solid #d4a72c; border-radius: 8px;
    font-size: 13px; color: #4d2d00;
  }
  .intro code { background: rgba(0,0,0,.06); padding: 1px 5px; border-radius: 4px; }
  h2 {
    font-size: 15px; margin: 34px 0 14px; padding-bottom: 8px;
    border-bottom: 1px solid #d0d7de; display: flex; align-items: baseline; gap: 10px;
  }
  h2 small { font-weight: 400; font-size: 12px; color: #656d76; }
  .grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(520px, 1fr)); gap: 18px; }
  .card {
    background: #fff; border: 1px solid #d0d7de; border-radius: 10px;
    overflow: hidden; box-shadow: 0 1px 2px rgba(0,0,0,.04);
  }
  .card > h3 {
    margin: 0; padding: 9px 14px; font-size: 12px; font-weight: 600;
    background: #eef1f4; border-bottom: 1px solid #d0d7de;
    display: flex; align-items: center; gap: 8px;
    font-family: ui-monospace, Consolas, Menlo, monospace;
  }
  .card .tag {
    margin-left: auto; font-weight: 400; font-size: 11px; color: #0a3069;
    background: #ddf4ff; border: 1px solid #b6e3ff; border-radius: 20px; padding: 1px 8px;
  }
  .tag:empty { display: none; }
  .demo { background: #fff; }
  .sample { padding: 10px 14px 14px; }
  .sample + .sample { border-top: 1px dashed #e4e8ec; }
  .lang {
    display: block; margin-bottom: 5px; font-size: 10px; letter-spacing: .08em;
    text-transform: uppercase; color: #8c959f;
    font-family: ui-monospace, Consolas, Menlo, monospace;
  }
  .sample pre { margin: 0; padding: 0; background: transparent; border: 0; }
  .sample code.hljs {
    display: block; padding: 12px 14px; border-radius: 6px;
    overflow-x: auto; font: 12.5px/1.55 ui-monospace, Consolas, Menlo, monospace;
    white-space: pre;
  }
</style>
</head>
<body>

<h1>代码高亮主题预览</h1>
<div class="intro">
  同一段代码在 ${LIGHT_THEMES.length + DARK_THEMES.length} 套 highlight.js 主题下的渲染效果。
  <br>
  注意：这里的每个代码块都用了<strong>主题自身的背景色</strong>——这正是当前
  <code>github</code> 主题的问题所在，它是白底，在白色文档里几乎没有区分度。
  <br>
  选好后告诉我主题名，我接上「跟随系统 + 手动切换」。
</div>

${lightSection}

${darkSection}

</body>
</html>
`;

await mkdir(dirname(OUT), { recursive: true });
await writeFile(OUT, page, 'utf8');

const sizeKb = (Buffer.byteLength(page, 'utf8') / 1024).toFixed(1);
console.log(`[preview] 已生成 ${LIGHT_THEMES.length + DARK_THEMES.length} 套主题 → ${OUT}`);
console.log(`[preview] 文件大小 ${sizeKb} KB`);
