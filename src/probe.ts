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

  /* ---- 4. 清空 ---- */
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
