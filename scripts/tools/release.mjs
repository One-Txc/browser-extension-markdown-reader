/**
 * 发布：升版本 → 提交 → 构建两个目标 → 打包成 zip。
 *
 * ★ 顺序是「先提交、再构建、最后打包」。这样 zip 对应的就是那个提交（HEAD），
 *   以后回滚或对账某个商店版本的代码时能对上，而不是「提交里的代码 ≠ 打包出去的代码」。
 *
 * ★ 版本提交由本脚本做，不用 `npm version` 自带的提交功能：它要求整个工作区
 *   干净，而且会把工作区里所有改动一起卷进提交。这里只提交版本号相关的两个文件。
 *
 * ★ 预检要求工作区干净（含未跟踪文件）—— 发布出去的 zip 必须对应一个有提交记录的
 *   代码状态。本地调试不需要打包：`npm run build` / `npm run check` 不动版本号、不生成 zip。
 *
 * ★ 构建或打包失败时，用 `git reset --hard HEAD~1` 撤掉刚做的版本提交 ——
 *   预检已经保证工作区干净，所以那一步只会撤掉本次发布产生的提交，不会吃掉别的东西。
 *
 * 不打 tag、不 push：发布产物在 output/dist/ 下，上传由人来做。
 */
import { execSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/** 仓库根：本文件在 scripts/tools/ 下 */
const ROOT = fileURLToPath(new URL('../..', import.meta.url));

/** 与版本号相关的文件：发布提交只包含它们 */
const VERSION_FILES = ['package.json', 'package-lock.json'];

/** 跑命令，输出直接给用户看 */
function run(command) {
  execSync(command, { cwd: ROOT, stdio: 'inherit' });
}

/** 跑命令并收下 stdout（用于读 git 状态） */
function capture(command) {
  return execSync(command, { cwd: ROOT, encoding: 'utf8' });
}

function readVersion() {
  return JSON.parse(readFileSync(path.join(ROOT, 'package.json'), 'utf8')).version;
}

/**
 * 工作区里所有未提交/未跟踪的路径。
 * `core.quotepath=false` 让中文文件名照原样显示，而不是八进制转义。
 */
function dirtyPaths() {
  const out = capture('git -c core.quotepath=false status --porcelain --untracked-files=normal');
  return out
    .split('\n')
    .filter((line) => line.trim() !== '')
    .map((line) => {
      // porcelain 格式：两位状态 + 空格 + 路径；重命名写成「旧路径 -> 新路径」
      const rest = line.slice(3);
      const arrow = rest.indexOf(' -> ');
      return arrow >= 0 ? rest.slice(arrow + 4) : rest;
    });
}

/** 第 1 步：发布前工作区必须是干净的 */
function assertCleanTree() {
  const dirty = dirtyPaths();
  if (dirty.length === 0) return;

  throw new Error(
    [
      '工作区还有未提交的改动，先提交再发布：',
      ...dirty.map((p) => `    ${p}`),
      '',
      '发布出去的 zip 必须对应一个有提交记录的代码状态。',
      '只想本地看效果就用 `npm run build` / `npm run check` —— 它们不动版本号、不打包。',
    ].join('\n')
  );
}

/**
 * 第 3 步：确认这次 diff 只动了版本号。
 *
 * `npm version` 只应该改 version 字段；一旦它顺手改了别的东西（npm 大版本升级时
 * 有可能重排 lock 字段），那个改动不该被塞进一个叫 `chore(release)` 的提交里。
 */
function assertOnlyVersionChanged() {
  const diff = capture(`git -c core.quotepath=false diff -- ${VERSION_FILES.join(' ')}`);
  const changed = diff
    .split('\n')
    .filter(
      (line) =>
        (line.startsWith('+') || line.startsWith('-')) &&
        !line.startsWith('+++') &&
        !line.startsWith('---')
    );

  const unexpected = changed.filter((line) => !line.includes('"version"'));
  if (unexpected.length > 0) {
    throw new Error(
      ['版本号文件里出现了预期之外的改动：', ...unexpected.map((line) => `    ${line}`)].join('\n')
    );
  }
}

function main() {
  const before = readVersion();

  console.log('[release] 1/5 检查工作区…');
  assertCleanTree();

  console.log('[release] 2/5 版本号 +1…');
  run('npm run bump');
  const version = readVersion();

  console.log('[release] 3/5 确认只改了版本号…');
  try {
    assertOnlyVersionChanged();
  } catch (err) {
    // 预检保证过这两个文件原本是干净的，直接还原即可
    run(`git checkout -- ${VERSION_FILES.join(' ')}`);
    throw err;
  }

  console.log(`[release] 4/5 提交版本号（${before} → ${version}）…`);
  run(`git add -- ${VERSION_FILES.join(' ')}`);
  run(`git commit -m "chore(release): v${version}" -- ${VERSION_FILES.join(' ')}`);
  const commit = capture('git rev-parse --short HEAD').trim();

  console.log('[release] 5/5 构建并打包…');
  try {
    run('npm run build:all');
    run('python scripts/build/package.py');
  } catch {
    console.error(`\n✗ 构建或打包失败，撤回版本提交 ${commit}…`);
    run('git reset --hard HEAD~1');
    console.error('  已回到发布前的状态；修好后重跑 npm run release 即可。');
    process.exit(1);
  }

  console.log(`\n✓ 发布完成：v${version}（提交 ${commit}）`);
  console.log('  上传 output/dist/ 下对应平台的 zip 即可。');
}

try {
  main();
} catch (err) {
  console.error(`\n✗ ${err instanceof Error ? err.message : err}`);
  process.exit(1);
}
