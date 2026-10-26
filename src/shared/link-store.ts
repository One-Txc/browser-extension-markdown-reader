/**
 * 「收藏 / 历史」共用的数据层：一组按 URL 去重的文档条目，存 `chrome.storage.local`。
 *
 * 两份列表（历史、收藏）形态完全一致，差异只有三项：
 *   1. storage 键名
 *   2. 上限
 *   3. 满了怎么办 —— 历史自动淘汰最旧的（evict），收藏拒绝新增（reject）
 * 所以这里做成一个工厂，两边各实例化一次，不再各写一份读改写逻辑。
 *
 * ★ 为什么用 storage.local 而不是 sync：
 *   1. sync 单键上限 8 KB，50 条绝对路径很容易撑破；
 *   2. 本地路径属于隐私，不该同步到别的设备；
 *   3. 这两个列表本来就是「这台机器上」的概念。
 *
 * storage 形状（一个键存整表，顺序即存储顺序，最新在前）：
 *   { history: [...] } / { favorites: [...] }
 */

import { safeDecode } from './const';

/** 一条记录（历史 / 收藏共用） */
export interface LinkEntry {
  /** 归一化后的 URL（已去掉 hash），同时作为去重键 */
  url: string;
  /** 文件名（已解码），取不到时回退成整条 URL */
  name: string;
  /** 最后加入的时间戳（ms）：历史是「打开时间」，收藏是「收藏时间」 */
  time: number;
}

/**
 * 列表满了之后的行为：
 *   evict  —— 静默淘汰最旧的一条（历史：自动记录，用户无感）
 *   reject —— 拒绝新增（收藏：用户主动保存的内容不该被静默删掉）
 */
export type LinkOverflow = 'evict' | 'reject';

/** 排序字段：文件名 / 时间 */
export type LinkSortField = 'name' | 'time';

export interface LinkSort {
  field: LinkSortField;
  ascending: boolean;
}

/* -------------------------------------------------------------- 纯函数 */

/**
 * 归一化 URL：去掉 hash，**保留 query**。
 *
 * - hash 只是锚点，同一文档跳到不同章节不该多出一条
 * - query 对在线文档可能是内容的一部分（例如 ?raw=1），不能丢
 *
 * 不用 `new URL()`：文件名里带裸 `%` 时它会抛 URIError，字符串裁剪就够了。
 */
export function normalizeLinkUrl(raw: string): string {
  if (typeof raw !== 'string') return '';
  const text = raw.trim();
  const hash = text.indexOf('#');
  return hash >= 0 ? text.slice(0, hash) : text;
}

/** 从 URL 取展示用文件名；取不到时回退成整条 URL，避免空行 */
export function linkNameOf(url: string): string {
  const base = normalizeLinkUrl(url).split('?')[0].replace(/[/\\]+$/, '');
  const seg = base.slice(base.lastIndexOf('/') + 1);
  return safeDecode(seg) || normalizeLinkUrl(url);
}

/**
 * 从 URL 取展示用目录。
 *
 * `file://` 前缀去掉（`D:/docs` 比 `file:///D:/docs` 好读），
 * Windows 盘符前那个多余的分隔符也一并去掉；http(s) 保持原样。
 */
export function linkDirOf(url: string): string {
  const base = normalizeLinkUrl(url).split('?')[0].replace(/[/\\]+$/, '');
  const slash = base.lastIndexOf('/');
  let dir = slash > 0 ? base.slice(0, slash) : base;
  dir = dir.replace(/^file:\/\//i, '');
  dir = dir.replace(/^\/([A-Za-z]:)/, '$1');
  return dir;
}

/**
 * 插入一条记录：已存在则提到最前并刷新时间，否则新建一条。
 *
 * 「最新在前」靠位置表达，不靠排序；超过上限时从尾部截掉。
 * 返回新数组，不改入参。
 */
export function addLinkEntry(
  list: readonly LinkEntry[],
  entry: LinkEntry,
  max: number
): LinkEntry[] {
  const url = normalizeLinkUrl(entry.url);
  if (!url) return [...list].slice(0, max);

  const rest = list.filter((item) => normalizeLinkUrl(item.url) !== url);
  const head: LinkEntry = {
    url,
    name: entry.name || linkNameOf(url),
    time: Number.isFinite(entry.time) ? entry.time : Date.now(),
  };

  return [head, ...rest].slice(0, max);
}

/**
 * 校验并整理 storage 里的数据。
 *
 * storage 里可能是旧版本留下的、或被手动改过的值，所以逐项校验：
 * 非数组当空，字段类型不对的条目丢弃，重复的合并，最后按时间降序并裁剪。
 */
export function parseLinks(raw: unknown, max: number): LinkEntry[] {
  const arr = Array.isArray(raw) ? raw : [];
  const seen = new Set<string>();
  const out: LinkEntry[] = [];

  for (const item of arr) {
    if (!item || typeof item !== 'object') continue;

    const record = item as Record<string, unknown>;
    if (typeof record.url !== 'string') continue;

    const url = normalizeLinkUrl(record.url);
    if (!url || seen.has(url)) continue;

    const time =
      typeof record.time === 'number' && Number.isFinite(record.time) ? record.time : 0;
    seen.add(url);
    out.push({
      url,
      name: typeof record.name === 'string' && record.name ? record.name : linkNameOf(url),
      time,
    });
  }

  out.sort((a, b) => b.time - a.time);
  return out.slice(0, max);
}

/**
 * 按用户选择排序（**只影响显示**，不改存储顺序）。
 *
 * 主字段相同时用名称兜底，再相同用 URL 兜底 —— 否则同时间/同名的两条
 * 在不同渲染之间顺序会抖。方向统一在最后取正负，与「文件」面板的
 * sortEntries 写法一致。
 */
export function sortLinks(items: readonly LinkEntry[], sort: LinkSort): LinkEntry[] {
  const byName = (a: LinkEntry, b: LinkEntry): number =>
    a.name.localeCompare(b.name, 'zh-Hans-CN', { numeric: true });

  return [...items].sort((a, b) => {
    let cmp = sort.field === 'time' ? a.time - b.time : byName(a, b);
    if (cmp === 0) cmp = byName(a, b);
    if (cmp === 0) cmp = a.url < b.url ? -1 : a.url > b.url ? 1 : 0;
    return sort.ascending ? cmp : -cmp;
  });
}

/**
 * 列表里的简版时间：今天只显示时分，今年显示月日，往年才带年份。
 * `tag` 是 BCP47 标签（zh-CN / en / ja / ko），交给 Intl 本地化。
 */
export function formatLinkTime(time: number, now: number, tag: string): string {
  if (!Number.isFinite(time) || time <= 0) return '';

  const date = new Date(time);
  const today = new Date(now);
  const sameDay =
    date.getFullYear() === today.getFullYear() &&
    date.getMonth() === today.getMonth() &&
    date.getDate() === today.getDate();
  const sameYear = date.getFullYear() === today.getFullYear();

  const options: Intl.DateTimeFormatOptions = sameDay
    ? { hour: '2-digit', minute: '2-digit', hour12: false }
    : sameYear
      ? { month: 'numeric', day: 'numeric' }
      : { year: 'numeric', month: 'numeric', day: 'numeric' };

  try {
    return new Intl.DateTimeFormat(tag || undefined, options).format(date);
  } catch {
    // 环境不支持 Intl 或 tag 非法：手写一份接近中文习惯的兜底
    const pad = (n: number): string => String(n).padStart(2, '0');
    if (sameDay) return `${pad(date.getHours())}:${pad(date.getMinutes())}`;
    if (sameYear) return `${date.getMonth() + 1}-${date.getDate()}`;
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
  }
}

/** 悬停提示用的完整时间；同样交给 Intl 本地化，失败时退回系统默认格式 */
export function formatLinkFullTime(time: number, tag: string): string {
  if (!Number.isFinite(time) || time <= 0) return '';
  const date = new Date(time);
  try {
    return new Intl.DateTimeFormat(tag || undefined, {
      dateStyle: 'medium',
      timeStyle: 'short',
    }).format(date);
  } catch {
    try {
      return date.toLocaleString();
    } catch {
      return date.toISOString();
    }
  }
}

/* -------------------------------------------------------------- 存储 */

export interface LinkStoreOptions {
  /** storage.local 里的键名，例如 'history' / 'favorites' */
  key: string;
  /** 最多保留多少条 */
  max: number;
  /** 满了之后的行为 */
  overflow: LinkOverflow;
}

export interface AddLinkResult {
  /** 写入后的完整列表（拒绝时是原列表） */
  items: LinkEntry[];
  /** 是否写入了；只有 reject 且已满时为 false */
  ok: boolean;
  /** 加入前是否已经在列表里（面板 / 星标可据此区分「新增」和「更新时间」） */
  existed: boolean;
}

export interface LinkStore {
  readonly key: string;
  readonly max: number;
  load(): Promise<LinkEntry[]>;
  add(url: string, time?: number): Promise<AddLinkResult>;
  remove(url: string): Promise<LinkEntry[]>;
  clear(): Promise<LinkEntry[]>;
  /** 监听其它标签页的改动；返回取消函数 */
  watch(cb: (items: LinkEntry[]) => void): () => void;
}

/** 同一页面内的写入串行化，避免并发读改写互相覆盖 */
export function createLinkStore(options: LinkStoreOptions): LinkStore {
  let queue: Promise<unknown> = Promise.resolve();

  function serialize<T>(task: () => Promise<T>): Promise<T> {
    // 前一个任务失败也要继续排队，否则一次异常会卡住后续所有写入
    const run = queue.then(task, task);
    queue = run.then(
      () => undefined,
      () => undefined
    );
    return run;
  }

  async function load(): Promise<LinkEntry[]> {
    try {
      const stored = await chrome.storage.local.get(options.key);
      return parseLinks(
        (stored as Record<string, unknown> | undefined)?.[options.key],
        options.max
      );
    } catch {
      // 读不到就当空列表：这两个列表失败绝不能影响正文渲染
      return [];
    }
  }

  async function save(items: LinkEntry[]): Promise<void> {
    try {
      await chrome.storage.local.set({ [options.key]: items });
    } catch {
      /* 写失败只影响该列表，忽略 */
    }
  }

  function add(url: string, time = Date.now()): Promise<AddLinkResult> {
    return serialize(async () => {
      const normalized = normalizeLinkUrl(url);
      const list = await load();
      if (!normalized) return { items: list, ok: true, existed: false };

      const existed = list.some((item) => item.url === normalized);
      // 收藏满了就拒绝新增：不静默淘汰用户主动保存的内容
      if (!existed && options.overflow === 'reject' && list.length >= options.max) {
        return { items: list, ok: false, existed: false };
      }

      const next = addLinkEntry(
        list,
        { url: normalized, name: linkNameOf(normalized), time },
        options.max
      );
      await save(next);
      return { items: next, ok: true, existed };
    });
  }

  function remove(url: string): Promise<LinkEntry[]> {
    return serialize(async () => {
      const normalized = normalizeLinkUrl(url);
      const list = await load();
      const next = list.filter((item) => item.url !== normalized);
      await save(next);
      return next;
    });
  }

  function clear(): Promise<LinkEntry[]> {
    return serialize(async () => {
      await save([]);
      return [];
    });
  }

  function watch(cb: (items: LinkEntry[]) => void): () => void {
    try {
      const listener = (
        changes: Record<string, chrome.storage.StorageChange>,
        area: string
      ): void => {
        if (area !== 'local' || !changes[options.key]) return;
        cb(parseLinks(changes[options.key].newValue, options.max));
      };
      chrome.storage.onChanged.addListener(listener);
      return () => {
        try {
          chrome.storage.onChanged.removeListener(listener);
        } catch {
          /* 忽略 */
        }
      };
    } catch {
      return () => {};
    }
  }

  return { key: options.key, max: options.max, load, add, remove, clear, watch };
}
