/**
 * 发布：升版本 → 提交 → 构建两个目标 → 打包成 zip → 打 tag。
 *
 * ★ 顺序是「先提交、再构建、最后打 tag」。这样 zip、tag 与提交三者对应同一份代码，
 *   将来回滚或对账某个商店版本的代码时能对上，而不是「提交里的代码 ≠ 打包出去的代码」。
 *
 * ★ tag 必须在构建与打包**全部成功之后**才打。
 *   构建失败时会 `git reset --hard HEAD~1` 撤掉版本提交，如果 tag 已经打上，
 *   它就会指向一个被撤掉的提交（悬空 tag），还得手动 `git tag -d` 清理。
 *
 * ★ tag 用 annotated（带日期与作者），同名 tag 已存在时提前失败、不覆盖：
 *   重跑发布撞上旧 tag，通常说明上次发布没走完，应该先确认再删，而不是覆盖。
 *
 * ★ 版本提交由本脚本做，不用 `npm version` 自带的提交与打 tag 功能：它要求整个工作区
 *   干净，而且会把工作区里所有改动一起卷进提交。
 *
 * ★ 预检要求工作区干净（含未跟踪文件）—— 发布出去的 zip 必须对应一个有提交记录的
 *   代码状态。本地调试不需要打包：`npm run build` / `npm run check` 不动版本号、不生成 zip。
 *
 * ★ 不 push：tag 只在本地，需要备份到远程时自己 `git push origin vX.Y.Z`。
 *
 * ★ 回滚到某一版（产物 output/ 不入库，必须重新构建，否则浏览器里跑的还是坏版本）：
 *     git reset --hard v1.0.6
 *     npm run build:all
 *   新版本的提交被 tag 保住了，`git reset --hard v1.0.7` 随时能回去。
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

/** tag 是否已存在（rev-parse 非 0 就说明没有） */
function tagExists(tag) {
  try {
    capture(`git rev-parse -q --verify refs/tags/${tag}`);
    return true;
  } catch {
    return false;
  }
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

  console.log('[release] 1/6 检查工作区…');
  assertCleanTree();

  console.log('[release] 2/6 版本号 +1…');
  run('npm run bump');
  const version = readVersion();
  const tag = `v${version}`;

  console.log('[release] 3/6 确认只改了版本号…');
  try {
    assertOnlyVersionChanged();
  } catch (err) {
    // 预检保证过这两个文件原本是干净的，直接还原即可
    run(`git checkout -- ${VERSION_FILES.join(' ')}`);
    throw err;
  }

  console.log(`[release] 4/6 检查 tag ${tag} 是否已被占用…`);
  if (tagExists(tag)) {
    // 版本号文件已经被 bump 改过，先还原，别把工作区留脏
    run(`git checkout -- ${VERSION_FILES.join(' ')}`);
    throw new Error(
      [
        `tag ${tag} 已经存在，不能覆盖。`,
        '',
        '通常说明上一次发布没走完（构建或打包中断），或者版本号被手动改过。',
        `确认旧 tag 确实无用后再删：git tag -d ${tag}`,
        `只想看看它指向哪一版：git show ${tag}`,
      ].join('\n')
    );
  }

  console.log(`[release] 5/6 提交版本号（${before} → ${version}）…`);
  run(`git add -- ${VERSION_FILES.join(' ')}`);
  run(`git commit -m "chore(release): v${version}" -- ${VERSION_FILES.join(' ')}`);
  const commit = capture('git rev-parse --short HEAD').trim();

  console.log('[release] 6/6 构建并打包…');
  try {
    run('npm run build:all');
    run('python scripts/build/package.py');
  } catch {
    console.error(`\n✗ 构建或打包失败，撤回版本提交 ${commit}…`);
    run('git reset --hard HEAD~1');
    console.error('  已回到发布前的状态；修好后重跑 npm run release 即可。');
    process.exit(1);
  }

  /*
   * 只有走到这里才打 tag：提交与产物都已经验过了。
   * 万一 tag 创建失败（例如 git 没配置 user.name），不回滚 ——
   * 代码和 zip 都是好的，只是缺一个标记，补打即可。
   */
  try {
    run(`git tag -a ${tag} -m "release ${tag}"`);
  } catch {
    console.error(`\n⚠ 提交 ${commit} 与产物已生成，但 tag ${tag} 创建失败。`);
    console.error('  修好后手动补打：');
    console.error(`    git tag -a ${tag} -m "release ${tag}"`);
    process.exit(1);
  }

  console.log(`\n✓ 发布完成：v${version}（提交 ${commit}）`);
  console.log(`  tag ${tag} 已打在这个提交上。`);
  console.log('  上传 output/dist/ 下对应平台的 zip 即可。');
  console.log('');
  console.log('  回滚到这一版（产物不入库，必须重新构建）：');
  console.log(`    git reset --hard ${tag}`);
  console.log('    npm run build:all');
  console.log(`  备份 tag 到远程：git push origin ${tag}`);
}

try {
  main();
} catch (err) {
  console.error(`\n✗ ${err instanceof Error ? err.message : err}`);
  process.exit(1);
}
