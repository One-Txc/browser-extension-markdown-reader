/**
 * 技术探针（临时文件，验证完即删）。
 *
 * 要回答的问题：能不能用 File System Access API 给「文件夹」tab 供数据。
 *
 * 三个未知数，任何一个不通过，架构就得换：
 *   1. content script（isolated world + file:// 页面）能否调用 showDirectoryPicker
 *   2. file:// 页面的 IndexedDB 是否可用 —— file:// 的 origin 很可能是 null（不透明源），
 *      而不透明源按规范是不能用 IndexedDB 的，这是最大的风险点
 *   3. FileSystemHandle 能否存进 IndexedDB，并在刷新后恢复、枚举
 *
 * 用法：打开任意 .md 文件，在地址栏 URL 末尾加 #mdreader-probe 回车。
 * 面板会插在 documentElement 上（不会被正文替换清掉）。
 */

const PROBE_HASH = '#mdreader-probe';
const DB_NAME = 'md-reader-probe';
const STORE = 'handles';
const KEY = 'dir';

/* ------------------------------------------------------------------ 工具 */

/**
 * TS 的 DOM lib 没有声明 queryPermission（它属于 FileSystemHandle 的权限扩展），
 * 这里补上，顺便标记为可选 —— 某些环境可能没实现。
 */
type PermissibleHandle = FileSystemDirectoryHandle & {
  queryPermission?(desc: { mode: 'read' | 'readwrite' }): Promise<PermissionState>;
};

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      if (!req.result.objectStoreNames.contains(STORE)) req.result.createObjectStore(STORE);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error('indexedDB.open 失败'));
  });
}

function idbPut(value: unknown): Promise<void> {
  return openDb().then(
    (db) =>
      new Promise<void>((resolve, reject) => {
        const tx = db.transaction(STORE, 'readwrite');
        tx.objectStore(STORE).put(value, KEY);
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error ?? new Error('put 失败'));
      })
  );
}

function idbGet(): Promise<unknown> {
  return openDb().then(
    (db) =>
      new Promise((resolve, reject) => {
        const tx = db.transaction(STORE, 'readonly');
        const req = tx.objectStore(STORE).get(KEY);
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error ?? new Error('get 失败'));
      })
  );
}

function idbClear(): Promise<void> {
  return openDb().then(
    (db) =>
      new Promise<void>((resolve, reject) => {
        const tx = db.transaction(STORE, 'readwrite');
        tx.objectStore(STORE).clear();
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error ?? new Error('clear 失败'));
      })
  );
}

/** 枚举目录的直接子项，返回 "目录名/" 或 "文件名" */
async function listDir(handle: FileSystemDirectoryHandle): Promise<string[]> {
  const out: string[] = [];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  for await (const [name, entry] of (handle as any).entries()) {
    out.push(entry.kind === 'directory' ? `${name}/` : name);
  }
  return out.sort();
}

/* ------------------------------------------------------------------ 定位算法 */

/**
 * 用当前页面的 URL 路径，在已授权的目录 handle 里定位到本文件。
 *
 * 思路：handle 只暴露目录名（拿不到绝对路径），所以把名字当作**锚点**，
 * 在 URL 的路径段里找到它的位置，然后拿其后的段逐级向下走。
 *
 * 关键点是**每一级都到真实文件系统里验证**，而不是纯字符串猜测：
 * 因此可以逐个候选位置试，取第一个能走通的，重名目录也能处理。
 *
 * @param handle 用户授权的目录
 * @param log 输出日志
 */
async function locateByUrl(
  handle: FileSystemDirectoryHandle,
  log: (msg: string) => void
): Promise<void> {
  // location.pathname 对 file:// 形如 /D:/a/b/c.md（Windows）或 /Users/x/a.md
  const segments = decodeURIComponent(location.pathname).split('/').filter(Boolean);
  log(`URL 路径段：${segments.join(' / ')}`);
  log(`授权目录名：${handle.name}`);

  const positions: number[] = [];
  segments.forEach((seg, i) => {
    if (seg === handle.name) positions.push(i);
  });

  if (positions.length === 0) {
    log('✗ 授权目录名在 URL 路径里没有出现 —— 无法自动定位，需用户手动导航');
    return;
  }
  log(`锚点候选位置（从后往前试）：${[...positions].reverse().join(', ')}`);

  // 从后往前试：越靠后的同名目录越可能是目标
  for (const pos of [...positions].reverse()) {
    const rest = segments.slice(pos + 1);
    log(`— 试位置 ${pos}，其后 ${rest.length} 段：${rest.join(' / ') || '（就是它本身）'}`);

    let cur: FileSystemDirectoryHandle = handle;
    let ok = true;

    // 除最后一段（文件名）外，逐级进入子目录
    for (let i = 0; i < rest.length - 1; i++) {
      try {
        cur = await cur.getDirectoryHandle(rest[i]);
      } catch {
        log(`  ✗ 没有子目录 "${rest[i]}"`);
        ok = false;
        break;
      }
    }
    if (!ok) continue;

    const fileName = rest[rest.length - 1];
    if (!fileName) {
      log('  ✓ 命中：URL 指向的就是这个目录本身');
      return;
    }

    try {
      await cur.getFileHandle(fileName);
      log(`  ✓ 定位成功：该目录下确实存在 "${fileName}"`);
      log(`    最终目录 = ${cur.name}`);
      return;
    } catch {
      log(`  ✗ 目录里没有文件 "${fileName}"`);
    }
  }

  log('✗ 所有候选都未通过验证');
}

/**
 * 解析 Chrome 目录索引页里的 addRow(...) 调用。
 *
 * 那个页面不是静态 <a href>，而是页面加载后由脚本调 addRow(name, url, isdir, size, …)
 * 动态建表，所以只能从脚本文本里提取。
 */
function parseAddRows(
  html: string
): Array<{ name: string; url: string; isDir: boolean; size: number }> {
  const out: Array<{ name: string; url: string; isDir: boolean; size: number }> = [];
  // 只取前 4 个参数就够了：name, url, isdir, size
  const re =
    /addRow\(\s*"((?:[^"\\]|\\.)*)"\s*,\s*"((?:[^"\\]|\\.)*)"\s*,\s*(true|false)\s*,\s*(\d+)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html)) !== null) {
    out.push({
      name: m[1].replace(/\\(.)/g, '$1'),
      url: m[2].replace(/\\(.)/g, '$1'),
      isDir: m[3] === 'true',
      size: Number(m[4]),
    });
  }
  return out;
}

/* ------------------------------------------------------------------ 面板 */

export function maybeRunProbe(): void {
  if (location.hash !== PROBE_HASH) return;
  // 等主流程把正文替换完，避免视觉上打架
  window.setTimeout(renderPanel, 400);
}

function renderPanel(): void {
  const logEl = document.createElement('pre');
  logEl.style.cssText =
    'margin:8px 0 0;padding:8px;background:#0d1117;color:#c9d1d9;border-radius:5px;' +
    'font:11px/1.55 ui-monospace,Consolas,monospace;white-space:pre-wrap;max-height:320px;overflow:auto';

  const lines: string[] = [];
  const log = (msg: string): void => {
    lines.push(msg);
    logEl.textContent = lines.join('\n');
    console.info('[探针]', msg);
  };

  const btn = (text: string, fn: () => Promise<void> | void): HTMLButtonElement => {
    const b = document.createElement('button');
    b.textContent = text;
    b.style.cssText =
      'margin:0 6px 6px 0;padding:5px 11px;font:12px system-ui;cursor:pointer;' +
      'background:#0969da;color:#fff;border:0;border-radius:5px';
    b.addEventListener('click', () => {
      b.disabled = true;
      Promise.resolve(fn())
        .catch((err) => log(`✗ 异常：${String(err)}`))
        .finally(() => {
          b.disabled = false;
        });
    });
    return b;
  };

  const panel = document.createElement('div');
  panel.style.cssText = [
    'position:fixed',
    'right:16px',
    'bottom:16px',
    'width:430px',
    'z-index:2147483647',
    'padding:12px 14px',
    'background:#fff',
    'border:1px solid #d0d7de',
    'border-radius:9px',
    'box-shadow:0 6px 26px rgba(0,0,0,.22)',
    'font:13px/1.5 system-ui,"Microsoft YaHei",sans-serif',
    'color:#1f2328',
  ].join(';');

  const title = document.createElement('div');
  title.textContent = 'MD Reader · 文件夹能力探针';
  title.style.cssText = 'font-weight:600;font-size:13px;margin-bottom:8px';

  /* ---- 环境检测（同步部分，立刻给结论）---- */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const w = window as any;
  log(`showDirectoryPicker : ${typeof w.showDirectoryPicker}`);
  log(`isSecureContext     : ${window.isSecureContext}`);
  log(`location.origin     : ${location.origin === 'null' ? '"null"（不透明源）' : location.origin}`);
  log(`location.protocol   : ${location.protocol}`);

  const buttons = document.createElement('div');

  /* ---- 1. 选择文件夹 ---- */
  let picked: FileSystemDirectoryHandle | null = null;
  buttons.append(
    btn('① 选择文件夹', async () => {
      if (typeof w.showDirectoryPicker !== 'function') {
        log('✗ 该环境没有 showDirectoryPicker，方案不成立');
        return;
      }
      const started = performance.now();
      picked = (await w.showDirectoryPicker({ mode: 'read' })) as FileSystemDirectoryHandle;
      log(`✓ 选择成功：${picked.name}（耗时 ${Math.round(performance.now() - started)}ms）`);
      log(`  handle.kind = ${picked.kind}`);

      const ph = picked as PermissibleHandle;
      const perm = ph.queryPermission
        ? await ph.queryPermission({ mode: 'read' })
        : '（未实现 queryPermission）';
      log(`  queryPermission(read) = ${perm}`);

      const items = await listDir(picked);
      log(`  枚举到 ${items.length} 项：${items.slice(0, 8).join('、')}${items.length > 8 ? ' …' : ''}`);
    })
  );

  /* ---- 2. 存入 IndexedDB ---- */
  buttons.append(
    btn('② 存入 IndexedDB', async () => {
      if (!picked) {
        log('! 请先执行 ①');
        return;
      }
      await idbPut(picked);
      log('✓ handle 已写入 IndexedDB —— 说明可结构化克隆');
    })
  );

  /* ---- 3. 读出并枚举（刷新后执行才有效）---- */
  buttons.append(
    btn('③ 读出并枚举', async () => {
      const raw = await idbGet();
      if (!raw) {
        log('✗ IndexedDB 里没有 handle');
        return;
      }
      log('✓ 读到了 handle —— 持久化可行');
      const handle = raw as FileSystemDirectoryHandle;
      log(`  handle.name = ${handle.name}`);

      const ph = handle as PermissibleHandle;
      const perm = ph.queryPermission
        ? await ph.queryPermission({ mode: 'read' })
        : '（未实现 queryPermission）';
      log(`  queryPermission(read) = ${perm}${perm === 'prompt' ? ' ← 需要再点一次授权' : ''}`);

      const items = await listDir(handle);
      log(`  枚举到 ${items.length} 项：${items.slice(0, 8).join('、')}${items.length > 8 ? ' …' : ''}`);
    })
  );

  /* ---- 4. 用当前 URL 定位（演示目录名链匹配）---- */
  buttons.append(
    btn('④ 用当前 URL 定位', async () => {
      const raw = await idbGet();
      if (!raw) {
        log('! 请先执行 ① ②');
        return;
      }
      await locateByUrl(raw as FileSystemDirectoryHandle, log);
    })
  );

  /* ---- 5. 尝试直接 fetch 目录 URL（不需要任何授权）---- */
  buttons.append(
    btn('⑤ fetch 目录 URL', async () => {
      // 当前页面的目录：去掉 URL 最后一段文件名
      const dirUrl = location.href.replace(/[^/]*$/, '');
      log(`请求目录：${dirUrl}`);

      const res = (await chrome.runtime.sendMessage({
        type: 'probe-fetch-dir',
        url: dirUrl,
      })) as { ok: boolean; status?: number; len?: number; text?: string; error?: string } | undefined;

      if (!res) {
        log('✗ 没有收到响应（后台可能没跑起来）');
        return;
      }
      if (!res.ok) {
        log(`✗ 请求失败：${res.error}`);
        return;
      }
      log(`✓ HTTP ${res.status}，拿到 ${res.len} 字符`);

      const html = res.text ?? '';
      if (!html.trim()) {
        log('⚠ 返回内容为空 —— 这条路走不通');
        return;
      }

      const rows = parseAddRows(html);
      log(`解析 addRow 调用：${rows.length} 项`);

      if (rows.length === 0) {
        log('⚠ 一项都没解析出来 —— 需要调整正则，把原始 HTML 贴出来看看');
        log(`前 700 字符：\n${html.slice(0, 700)}`);
        return;
      }

      const dirs = rows.filter((r) => r.isDir);
      const mdFiles = rows.filter((r) => !r.isDir && /\.(md|markdown)$/i.test(r.name));
      log(`  其中：目录 ${dirs.length} 个、md 文件 ${mdFiles.length} 个、其他 ${rows.length - dirs.length - mdFiles.length} 个`);
      log('  全部条目：');
      for (const r of rows) {
        const tag = r.isDir ? '📁' : /\.(md|markdown)$/i.test(r.name) ? '📄' : '  ';
        log(`    ${tag} ${r.name}${r.isDir ? '/' : ''}${r.isDir ? '' : `  (${r.size} B)`}`);
      }
    })
  );

  /* ---- 6. 清空 ---- */
  buttons.append(
    btn('清空探针数据', async () => {
      await idbClear();
      log('✓ 已清空');
    })
  );

  panel.append(title, buttons, logEl);
  document.documentElement.appendChild(panel);

  // 主动测一次 IndexedDB 是否可用（这是最大的风险点）
  openDb()
    .then(() => log('IndexedDB 打开        : ✓ 可用'))
    .catch((err) => log(`IndexedDB 打开        : ✗ ${String(err)}`));
}
