/**
 * 目录列举：读取某个目录下有哪些文件与子目录。
 *
 * ★ 原理（经实测确认）：
 * Chrome 会为 file:// 的目录 URL 生成一份「目录索引」HTML —— 里面是一个
 * `function addRow(name, url, isdir, size, size_string, date_modified, date_modified_string)`
 * 的定义，后面跟着一连串 addRow(...) 调用，每个调用就是一条目录项。
 *
 * 所以不需要任何用户授权：直接 fetch 目录 URL，解析这些调用即可。
 * 这条路径比 File System Access API 简单得多 —— 不用选目录、不用持久化 handle、
 * 也不用反查路径。
 *
 * ★ 三个实测踩过的坑：
 *   1. fetch(file://目录) 返回的 Response 是 ok:false / status:0（file 协议没有
 *      HTTP 状态码），但 body 是完整的 —— 判断成败必须看文本长度，不能看 res.ok。
 *   2. 不能截断返回的 HTML。目录数据在 11000+ 字符的后半段，
 *      只取前 6000 字符会解析出 0 项。
 *   3. addRow 的第 3 个参数 isdir 是 1/0 数字，不是 true/false；调用以分号结尾。
 */

export interface DirEntry {
  /** 显示名（不含结尾斜杠） */
  name: string;
  /** 相对于父目录的 URL 片段，可直接与父目录拼接 */
  path: string;
  isDir: boolean;
  /** 字节数，目录为 0 */
  size: number;
  /** 修改时间（毫秒时间戳）；解析不到时为 0 */
  modified: number;
}

/**
 * 「文件夹」面板默认展示的文件类型。
 *
 * ★ 这只是**兜底默认值**：调用方通常会传入 effectiveExtensions(settings.extraExtensions)
 * 的结果，好让用户在设置里追加的后缀（例如 txt）在这里也生效。
 * 两处列表若各写各的，就会出现「正文能渲染但文件夹里看不到」这种不一致。
 */
const FALLBACK_EXT = ['md', 'markdown', 'mkd', 'mdown', 'mkdn', 'mdwn', 'mdtxt', 'mdtext', 'markdn', 'mdx'];

/**
 * 解析 Chrome 目录索引页里的 addRow(...) 调用。
 *
 * 注意该正则来自实测可用的版本，改动前请先看文件头的说明。
 * 参数顺序：
 *   addRow(name, url, isdir, size, size_string, date_modified, date_modified_string)
 */
export function parseDirectoryIndex(html: string): DirEntry[] {
  const out: DirEntry[] = [];
  const re =
    /addRow\("(.*?)",\s*"(.*?)",\s*(\d+),\s*(\d+),\s*"([\d.]+ [BkMG]B?)",\s*(\d+),\s*"(.*?)"\);/g;

  let m: RegExpExecArray | null;
  while ((m = re.exec(html)) !== null) {
    const name = m[1];

    // 名字里如果混入了路径分隔符，说明解析可能错位，跳过以防构造出奇怪的 URL
    if (name.includes('/') || name.includes('\\')) continue;

    out.push({
      name,
      path: m[2],
      isDir: Number.parseInt(m[3], 10) !== 0,
      size: Number.parseInt(m[4], 10),
      modified: Number.parseInt(m[6], 10) || 0,
    });
  }

  return out;
}

/**
 * 过滤出需要展示的条目：目录 + 受支持的文档类型。
 *
 * 只做过滤不做排序 —— 排序取决于用户在「文件夹」面板里的设置。
 *
 * @param showHidden 是否保留以 . 开头的隐藏项
 * @param extensions 受支持的扩展名（不含点号，小写）。
 *                   传 effectiveExtensions(settings.extraExtensions) 即可让
 *                   用户自定义的后缀也在这里生效；不传则用默认那批。
 */
export function filterEntries(
  entries: DirEntry[],
  showHidden = true,
  extensions: readonly string[] = FALLBACK_EXT
): DirEntry[] {
  const wanted = extensions.map((e) => `.${e.toLowerCase()}`);
  return entries.filter((e) => {
    if (!showHidden && e.name.startsWith('.')) return false;
    if (e.isDir) return true;
    const lower = e.name.toLowerCase();
    return wanted.some((ext) => lower.endsWith(ext));
  });
}

/** 排序依据 */
export type SortField = 'name' | 'size' | 'modified';

export interface SortOptions {
  field: SortField;
  ascending: boolean;
  /** 文件夹是否始终排在文件之前（升降序都生效） */
  foldersFirst: boolean;
}

/**
 * 按用户设置排序。
 *
 * 文件夹置顶的判断放在比较字段**之前**，所以升降序都会保持「目录在前」。
 * 主字段相同时用名称兜底，避免顺序在多次渲染间抖动。
 */
export function sortEntries(entries: DirEntry[], opts: SortOptions): DirEntry[] {
  const byName = (a: DirEntry, b: DirEntry): number =>
    a.name.localeCompare(b.name, 'zh-Hans-CN', { numeric: true });

  return [...entries].sort((a, b) => {
    if (opts.foldersFirst && a.isDir !== b.isDir) return a.isDir ? -1 : 1;

    let cmp = 0;
    if (opts.field === 'size') cmp = a.size - b.size;
    else if (opts.field === 'modified') cmp = a.modified - b.modified;
    else cmp = byName(a, b);

    if (cmp === 0) cmp = byName(a, b);
    return opts.ascending ? cmp : -cmp;
  });
}

/** 从文档 URL 推出所在目录的 URL（保留结尾斜杠） */
export function directoryOf(fileUrl: string): string {
  const base = fileUrl.replace(/[^/]*$/, '');
  return base.endsWith('/') ? base : `${base}/`;
}

/** 把父目录 URL 与条目路径拼成可直接使用的绝对 URL */
export function resolveEntryUrl(parentDirUrl: string, entry: DirEntry): string {
  const join = `${parentDirUrl}${entry.path}`;
  return entry.isDir && !join.endsWith('/') ? `${join}/` : join;
}
