/**
 * 「收藏 / 历史」的本地测试。
 *
 * 覆盖三层：
 *   1. 数据层 shared/link-store.ts：归一化、去重、上限、两种溢出策略、排序、时间格式
 *   2. 面板 render/link-pane.ts + 两个包装：行渲染、交互、清空两步确认、排序行
 *   3. 星标 render/favorite-button.ts：状态切换与满额提示
 *
 * 测不了的：布局与视觉 —— 目录行的左侧省略、悬停浮出按钮、星标的颜色，
 *          这些依赖真实布局与主题变量，必须人眼验证。
 */
import { JSDOM } from 'jsdom';
import * as esbuild from 'esbuild';
import { mkdir, rm } from 'node:fs/promises';

// 独立子目录，与其它脚本隔离
const TMP = '.tmp/collections';
await rm(TMP, { recursive: true, force: true });
await mkdir(TMP, { recursive: true });

for (const [entry, outfile] of [
  ['src/shared/link-store.ts', 'store'],
  ['src/render/history.ts', 'history'],
  ['src/render/favorites.ts', 'favorites'],
  ['src/render/favorite-button.ts', 'fav-button'],
]) {
  await esbuild.build({
    entryPoints: [entry],
    outfile: `${TMP}/${outfile}.mjs`,
    bundle: true,
    format: 'esm',
    platform: 'browser',
    target: 'es2022',
    logLevel: 'silent',
  });
}

/*
 * 假的 chrome.storage.local：内存对象。
 * get 只返回存在的键（与真实 API 一致），set 覆盖对应键。
 * i18n 也一并桩掉：语言固定 zh-CN，文案走 zh_CN 语言包。
 */
const store = {};
globalThis.chrome = {
  storage: {
    local: {
      async get(key) {
        const out = {};
        if (typeof key === 'string' && key in store) out[key] = structuredClone(store[key]);
        return out;
      },
      async set(obj) {
        for (const [key, value] of Object.entries(obj)) store[key] = structuredClone(value);
      },
    },
    onChanged: { addListener() {}, removeListener() {} },
  },
  i18n: { getMessage: () => '', getUILanguage: () => 'zh-CN' },
};

const dom = new JSDOM('<!doctype html><html><body></body></html>', {
  url: 'file:///D:/docs/a.md',
});
globalThis.window = dom.window;
globalThis.document = dom.window.document;

// 产物落在仓库根的 .tmp/ 下，本文件在 tests/ 里 —— 往上只有一层
const data = await import(new URL(`../${TMP}/store.mjs`, import.meta.url).href);
const { mountHistoryPane } = await import(new URL(`../${TMP}/history.mjs`, import.meta.url).href);
const { mountFavoritesPane } = await import(new URL(`../${TMP}/favorites.mjs`, import.meta.url).href);
const { mountFavoriteButton } = await import(new URL(`../${TMP}/fav-button.mjs`, import.meta.url).href);

const cases = [];
const check = (name, ok) => cases.push({ name, ok: !!ok });

/* ------------------------------------------------------ 1. URL 归一化 */
check('去掉 hash', data.normalizeLinkUrl('file:///a/b.md#sec') === 'file:///a/b.md');
check(
  '保留 query，只去 hash',
  data.normalizeLinkUrl('https://x.com/a.md?raw=1#h') === 'https://x.com/a.md?raw=1'
);
check('空串归一化为空', data.normalizeLinkUrl('') === '');
check('非字符串不抛错', data.normalizeLinkUrl(null) === '');

/* ---------------------------------------------------------- 2. 命名 */
check('文件名解码', data.linkNameOf('file:///D:/%E6%96%87%E6%A1%A3/a%20b.md') === 'a b.md');
check('以斜杠结尾时取主机名', data.linkNameOf('https://x.com/') === 'x.com');
check('目录去掉 file:// 前缀', data.linkDirOf('file:///D:/docs/sub/a.md') === 'D:/docs/sub');
check('POSIX 目录保留前导斜杠', data.linkDirOf('file:///home/u/a.md') === '/home/u');
check('http 目录原样', data.linkDirOf('https://x.com/d/a.md') === 'https://x.com/d');

/* ------------------------------------------------------ 3. 插入与去重 */
const base = [
  { url: 'file:///a.md', name: 'a.md', time: 300 },
  { url: 'file:///b.md', name: 'b.md', time: 200 },
];

const added = data.addLinkEntry(base, { url: 'file:///c.md', name: 'c.md', time: 400 }, 50);
check('新条目排在最前', added[0].url === 'file:///c.md' && added.length === 3);
check('不改入参', base.length === 2 && base[0].url === 'file:///a.md');

const dup = data.addLinkEntry(base, { url: 'file:///a.md#h', name: 'a.md', time: 500 }, 50);
check(
  '带锚点的重复条目：不新增、提到最前、时间更新',
  dup.length === 2 && dup[0].url === 'file:///a.md' && dup[0].time === 500
);

const full = Array.from({ length: 50 }, (_, i) => ({
  url: `file:///f${i}.md`,
  name: `f${i}.md`,
  time: 1000 - i,
}));
const capped = data.addLinkEntry(full, { url: 'file:///new.md', name: 'new.md', time: 2000 }, 50);
check(
  '超过上限时裁掉最旧的一条',
  capped.length === 50 &&
    capped[0].url === 'file:///new.md' &&
    !capped.some((entry) => entry.url === 'file:///f49.md')
);

check('空 URL 被忽略', data.addLinkEntry(base, { url: '', name: '', time: 1 }, 50).length === 2);

/* ------------------------------------------------------ 4. 脏数据解析 */
check('非数组当空', data.parseLinks('oops', 50).length === 0);
check(
  '丢弃字段非法的条目',
  data.parseLinks(
    [null, 1, 'x', { url: 2 }, { url: 'file:///a.md', name: 'a', time: 1 }],
    50
  ).length === 1
);
check(
  '按时间降序',
  data
    .parseLinks(
      [
        { url: 'file:///old.md', name: 'old', time: 10 },
        { url: 'file:///new.md', name: 'new', time: 20 },
      ],
      50
    )
    .map((entry) => entry.url)
    .join(',') === 'file:///new.md,file:///old.md'
);
check(
  '重复条目合并',
  data.parseLinks(
    [
      { url: 'file:///a.md', name: 'a', time: 10 },
      { url: 'file:///a.md#x', name: 'a', time: 20 },
    ],
    50
  ).length === 1
);
check('缺 name 时自动补', data.parseLinks([{ url: 'file:///a.md', time: 10 }], 50)[0].name === 'a.md');
check(
  '超长列表被裁剪',
  data.parseLinks(
    Array.from({ length: 60 }, (_, i) => ({ url: `file:///${i}.md`, time: i })),
    50
  ).length === 50
);

/* ---------------------------------------------------------- 5. 排序 */
const sortable = [
  { url: 'file:///b.md', name: 'b.md', time: 20 },
  { url: 'file:///a.md', name: 'a.md', time: 10 },
  { url: 'file:///c.md', name: 'c.md', time: 30 },
];
const urls = (items) => items.map((item) => item.url).join(',');

check(
  '时间降序（最新的在前）',
  urls(data.sortLinks(sortable, { field: 'time', ascending: false })) ===
    'file:///c.md,file:///b.md,file:///a.md'
);
check(
  '时间升序（最早的在最前）',
  urls(data.sortLinks(sortable, { field: 'time', ascending: true })) ===
    'file:///a.md,file:///b.md,file:///c.md'
);
check(
  '名称升序',
  urls(data.sortLinks(sortable, { field: 'name', ascending: true })) ===
    'file:///a.md,file:///b.md,file:///c.md'
);
check(
  '名称降序',
  urls(data.sortLinks(sortable, { field: 'name', ascending: false })) ===
    'file:///c.md,file:///b.md,file:///a.md'
);
check(
  '排序不改入参',
  urls(sortable) === 'file:///b.md,file:///a.md,file:///c.md'
);
// 主字段相同：按名称兜底，名称也相同再按 URL
check(
  '时间相同时按名称兜底',
  urls(
    data.sortLinks(
      [
        { url: 'file:///z.md', name: 'z.md', time: 5 },
        { url: 'file:///a.md', name: 'a.md', time: 5 },
      ],
      { field: 'time', ascending: true }
    )
  ) === 'file:///a.md,file:///z.md'
);
check(
  '名称相同时按 URL 兜底',
  urls(
    data.sortLinks(
      [
        { url: 'file:///b/x.md', name: 'x.md', time: 1 },
        { url: 'file:///a/x.md', name: 'x.md', time: 2 },
      ],
      { field: 'name', ascending: true }
    )
  ) === 'file:///a/x.md,file:///b/x.md'
);

/* ------------------------------------------------------ 6. 时间格式 */
const now = new Date(2026, 9, 13, 22, 30).getTime();
const todayTime = new Date(2026, 9, 13, 9, 5).getTime();
const thisYear = new Date(2026, 2, 3, 9, 5).getTime();
const yearsAgo = new Date(2024, 2, 3, 9, 5).getTime();

check(
  '今天只显示时分',
  /^\d{1,2}:\d{2}$/.test(data.formatLinkTime(todayTime, now, 'zh-CN'))
);
const thisYearText = data.formatLinkTime(thisYear, now, 'zh-CN');
check('今年显示月日、不带年份', !thisYearText.includes('2026') && /\d/.test(thisYearText));
check('往年带年份', data.formatLinkTime(yearsAgo, now, 'zh-CN').includes('2024'));
check('非法时间返回空串', data.formatLinkTime(0, now, 'zh-CN') === '');
check('完整时间包含日期', data.formatLinkFullTime(yearsAgo, 'zh-CN').includes('2024'));

/* ---------------------------------------------------------- 7. 存储 */
const history = data.createLinkStore({ key: 'history', max: 3, overflow: 'evict' });
const favorites = data.createLinkStore({ key: 'favorites', max: 3, overflow: 'reject' });

check('初始为空', (await history.load()).length === 0);

await history.add('file:///D:/a.md', 1000);
check('写入后可读回', (await history.load()).length === 1);

await history.add('file:///D:/a.md#sec', 2000);
const same = await history.load();
check('重复加入只保留一条并更新时间', same.length === 1 && same[0].time === 2000);

await history.add('file:///D:/b.md', 2500);
check('最新的排最前', (await history.load())[0].url === 'file:///D:/b.md');

await history.remove('file:///D:/a.md');
check('移除单条', (await history.load()).length === 1);

await history.add('file:///D:/c.md', 3000);
await history.add('file:///D:/d.md', 3001);
await history.add('file:///D:/e.md', 3002);
const evicted = await history.load();
check(
  'evict 策略：超过上限时淘汰最旧的',
  evicted.length === 3 && !evicted.some((item) => item.url === 'file:///D:/b.md')
);

await Promise.all([
  favorites.add('file:///D:/x1.md', 4000),
  favorites.add('file:///D:/x2.md', 4001),
  favorites.add('file:///D:/x3.md', 4002),
]);
check('并发写入不互相覆盖', (await favorites.load()).length === 3);

const overflow = await favorites.add('file:///D:/x4.md', 5000);
check('reject 策略：已满时拒绝新增', overflow.ok === false && overflow.items.length === 3);
check(
  'reject 策略：拒绝后列表内容不变',
  (await favorites.load()).every((item) => item.url !== 'file:///D:/x4.md')
);

const again = await favorites.add('file:///D:/x1.md', 6000);
check(
  'reject 策略：已在列表里的重复加入不受上限影响',
  again.ok === true && again.existed === true && again.items.length === 3
);

await favorites.clear();
check('清空后为空', (await favorites.load()).length === 0);

/* ------------------------------------------------------ 8. 历史面板 */
const calls = { open: [], newTab: [], remove: [], clear: 0 };
let currentUrl = 'file:///D:/docs/a.md';

const historyEntries = [
  { url: 'file:///D:/docs/a.md', name: 'a.md', time: Date.now() },
  { url: 'file:///D:/other/b.md', name: 'b.md', time: Date.now() - 86400000 },
];

const historyPane = mountHistoryPane({
  getItems: () => historyEntries,
  currentUrl: () => currentUrl,
  onOpen: (url) => {
    calls.open.push(url);
    return url === 'file:///D:/docs/a.md';
  },
  onOpenNewTab: (url) => calls.newTab.push(url),
  onRemove: (url) => calls.remove.push(url),
  onClear: () => {
    calls.clear += 1;
  },
});
document.body.append(historyPane.element);

const hRows = historyPane.element.querySelectorAll('.link-row');
check('历史上：行数与数据一致', hRows.length === 2);
check('历史上：显示文件名', hRows[0].querySelector('.link-name').textContent === 'a.md');
check('历史上：显示目录', hRows[1].querySelector('.link-dir').textContent === 'D:/other');
check('历史上：显示计数', historyPane.element.querySelector('.count').textContent === '2 条');
check('历史上：当前文档高亮', hRows[0].classList.contains('is-current'));
check('历史上：没有排序行', !historyPane.element.querySelector('.link-sort-box'));
check(
  '历史上：× 的提示是「从历史中移除」',
  hRows[0].querySelector('.link-remove').title === '从历史中移除'
);
check('历史上：行 title 是完整 URL', hRows[1].title === 'file:///D:/other/b.md');

hRows[0].dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));
check('历史上：点击行调用 onOpen', calls.open.length === 1);

hRows[1]
  .querySelector('.link-jump')
  .dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));
check('历史上：跳转图标调用 onOpenNewTab', calls.newTab.length === 1);
check('历史上：跳转不触发行点击', calls.open.length === 1);

hRows[1]
  .querySelector('.link-remove')
  .dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));
check('历史上：× 调用 onRemove', calls.remove.length === 1);

const hClear = historyPane.element.querySelector('.link-clear');
hClear.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));
check('历史上：第一次点清空不清空', calls.clear === 0);
check('历史上：第一次点进入确认态', hClear.textContent === '确认清空');
hClear.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));
check('历史上：第二次点才清空', calls.clear === 1);

hRows[1].dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));
await new Promise((resolve) => setTimeout(resolve, 0));
check(
  '历史上：打开失败显示错误提示',
  !historyPane.element.querySelector('.link-error').classList.contains('md-reader-hidden')
);

historyPane.setCurrent('file:///D:/other/b.md');
check(
  '历史上：setCurrent 更新高亮',
  historyPane.element.querySelectorAll('.link-row')[1].classList.contains('is-current')
);

historyEntries.length = 1;
historyPane.refresh();
check('历史上：refresh 按新数据重绘', historyPane.element.querySelectorAll('.link-row').length === 1);
check('历史上：refresh 更新计数', historyPane.element.querySelector('.count').textContent === '1 条');
historyPane.destroy();
check('历史上：destroy 后从 DOM 移除', !document.querySelector('.md-reader-link-pane'));

/* ------------------------------------------------------ 9. 收藏面板 */
const favCalls = { set: [] };
let favSort = { field: 'time', ascending: false };
let favCurrent = 'file:///D:/docs/a.md';

const favoriteEntries = [
  { url: 'file:///D:/docs/a.md', name: 'a.md', time: 300 },
  { url: 'file:///D:/docs/c.md', name: 'c.md', time: 100 },
  { url: 'file:///D:/docs/b.md', name: 'b.md', time: 200 },
];

const favoritesPane = mountFavoritesPane({
  getItems: () => favoriteEntries,
  currentUrl: () => favCurrent,
  onOpen: () => true,
  onOpenNewTab: () => {},
  onRemove: () => {},
  onClear: () => {},
  sort: {
    get: () => favSort,
    set: (patch) => {
      favCalls.set.push(patch);
      favSort = { ...favSort, ...patch };
    },
  },
});
document.body.append(favoritesPane.element);

const fRows = () => favoritesPane.element.querySelectorAll('.link-row');
check('收藏：默认按收藏时间降序', fRows()[0].dataset.url === 'file:///D:/docs/a.md');
check('收藏：显示计数', favoritesPane.element.querySelector('.count').textContent === '3 条');
check(
  '收藏：× 的提示是「移出收藏」',
  fRows()[0].querySelector('.link-remove').title === '移出收藏'
);
check('收藏：有排序行', !!favoritesPane.element.querySelector('.link-sort-box'));

const sortSelect = favoritesPane.element.querySelector('.link-sort-select');
const ascBtn = favoritesPane.element.querySelector('.link-asc');
check('收藏：排序默认选中收藏时间', sortSelect.value === 'time');
check('收藏：方向按钮默认显示降序', ascBtn.textContent === '↓ 降序');
check('收藏：方向按钮 title 说明点击结果', ascBtn.title === '当前降序，点击改为升序');

// 切成按名称升序：先改字段，再改方向
sortSelect.value = 'name';
sortSelect.dispatchEvent(new dom.window.Event('change'));
check('收藏：切换字段调用 set', favCalls.set.some((patch) => patch.field === 'name'));

ascBtn.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));
check('收藏：点方向按钮翻转升序', favSort.ascending === true);
check('收藏：方向按钮文字更新', ascBtn.textContent === '↑ 升序');
check(
  '收藏：按名称升序重排',
  fRows()[0].dataset.url === 'file:///D:/docs/a.md' &&
    fRows()[1].dataset.url === 'file:///D:/docs/b.md' &&
    fRows()[2].dataset.url === 'file:///D:/docs/c.md'
);

// 再切回时间降序
sortSelect.value = 'time';
sortSelect.dispatchEvent(new dom.window.Event('change'));
ascBtn.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));
check(
  '收藏：切回时间降序重排',
  fRows()[0].dataset.url === 'file:///D:/docs/a.md' &&
    fRows()[2].dataset.url === 'file:///D:/docs/c.md'
);

favoritesPane.destroy();
check('收藏：destroy 后从 DOM 移除', !document.querySelector('.md-reader-link-pane'));

/* 空状态 */
const emptyPane = mountFavoritesPane({
  getItems: () => [],
  currentUrl: () => '',
  onOpen: () => true,
  onOpenNewTab: () => {},
  onRemove: () => {},
  onClear: () => {},
  sort: { get: () => ({ field: 'time', ascending: false }), set: () => {} },
});
document.body.append(emptyPane.element);
check(
  '收藏：空列表显示空状态',
  !emptyPane.element.querySelector('.link-empty').classList.contains('md-reader-hidden')
);
check('收藏：空列表时清空按钮禁用', emptyPane.element.querySelector('.link-clear').disabled);
check(
  '收藏：空状态文案正确',
  emptyPane.element.querySelector('.link-empty-title').textContent === '还没有收藏任何文档'
);
emptyPane.destroy();

/* ------------------------------------------------------ 10. 星标按钮 */
let favoriteState = false;
const toggles = [];

const favButton = mountFavoriteButton({
  isFavorited: () => favoriteState,
  onToggle: () => {
    toggles.push(1);
    favoriteState = !favoriteState;
    return { active: favoriteState };
  },
});

check('星标：初始为未收藏', favButton.element.getAttribute('aria-pressed') === 'false');
check('星标：初始 title 是「收藏」', favButton.element.title === '收藏');
check('星标：初始是空心（fill none）', favButton.element.innerHTML.includes('fill="none"'));

favButton.element.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));
await new Promise((resolve) => setTimeout(resolve, 0));
check('星标：点击调用 onToggle', toggles.length === 1);
check('星标：收藏后 aria-pressed 为 true', favButton.element.getAttribute('aria-pressed') === 'true');
check('星标：收藏后 title 是「取消收藏」', favButton.element.title === '取消收藏');
check('星标：收藏后是实心', favButton.element.innerHTML.includes('fill="currentColor"'));

favButton.setActive(false);
check('星标：setActive 可外部同步', favButton.element.getAttribute('aria-pressed') === 'false');
favButton.destroy();
check('星标：destroy 后移除', !document.querySelector('.md-reader-btn-favorite'));

/* 满额提示 */
const fullButton = mountFavoriteButton({
  isFavorited: () => false,
  onToggle: () => ({ active: false, full: true }),
});
fullButton.element.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));
await new Promise((resolve) => setTimeout(resolve, 0));
const toast = document.querySelector('.md-reader-toast');
check('星标：满额时弹提示', !!toast);
check('星标：满额提示包含上限数字', !!toast && toast.textContent.includes('50'));
check(
  '星标：满额后仍为未收藏',
  fullButton.element.getAttribute('aria-pressed') === 'false'
);
fullButton.destroy();

/* ------------------------------------------------------------ 输出 */
let failed = 0;
for (const { name, ok } of cases) {
  if (!ok) failed += 1;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}`);
}

if (failed > 0) {
  console.log(`\n${failed} 项失败`);
  process.exit(1);
}
// 关掉 jsdom 窗口，清掉 toast 的 4.2 秒定时器，避免进程空等
dom.window.close();
console.log(`\n全部 ${cases.length} 项通过`);
