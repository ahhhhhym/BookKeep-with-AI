/** Windows x64 双 ZIP。只使用已提交白名单；旧包及失败现场均保留。 */
import assert from 'node:assert/strict';
import { spawnSync, execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, realpathSync, statSync, symlinkSync, unlinkSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { ROOT, RELEASE, electronSafeEnv } from './lib/paths.mjs';
import { readZip, zipEntryData } from './lib/zip.mjs';
import { verifyZipFile } from './verify-zip.mjs';
import { smokePackaged } from './smoke-packaged.mjs';

const pwsh = 'C:\\Users\\Administrator\\AppData\\Local\\Microsoft\\WindowsApps\\pwsh.exe';
const allowed = f => /^(src|tests|scripts|assets|resources\/licenses)\//.test(f) || /^(README\.md|package(-lock)?\.json|electron-builder\.yml|tsconfig[^/]*\.json|vite\.config\.ts|vitest\.config\.ts|\.gitignore|\.gitattributes|\.env\.example)$/.test(f);
const sha = f => createHash('sha256').update(readFileSync(f)).digest('hex');
const json = f => JSON.parse(readFileSync(f, 'utf8'));
const save = (f, data) => writeFileSync(f, JSON.stringify(data, null, 2) + '\n', 'utf8');
const copy = (from, to) => { mkdirSync(path.dirname(to), { recursive: true }); copyFileSync(from, to); };
function walk(root, prefix = '') {
  return readdirSync(path.join(root, prefix), { withFileTypes: true }).flatMap(e => {
    assert(!e.isSymbolicLink(), '不允许产物链接');
    const f = prefix ? prefix + '/' + e.name : e.name;
    return e.isDirectory() ? walk(root, f) : [f];
  }).sort();
}
const inventory = root => walk(root).map(file => ({ file, bytes: statSync(path.join(root, file)).size, sha256: sha(path.join(root, file)) }));
function verifyArchive(zip, rows) {
  const buffer = readFileSync(zip), entries = readZip(buffer).filter(e => !e.name.endsWith('/'));
  assert.deepEqual(entries.map(e => e.name).sort(), rows.map(r => r.file).sort());
  for (const row of rows) {
    const data = zipEntryData(buffer, entries.find(e => e.name === row.file));
    assert.equal(data.length, row.bytes, row.file);
    assert.equal(createHash('sha256').update(data).digest('hex'), row.sha256, row.file);
  }
}

export async function buildRelease() {
  assert.equal(process.platform, 'win32'); assert.equal(process.arch, 'x64');
  const gateDir = path.join(ROOT, 'evidence/S17-G5-D66-R1');
  const gate = json(path.join(gateDir, 'GATE-DECISION.json')), freeze = json(path.join(ROOT, 'evidence/S17-RETEST-E02-R1/freeze.json'));
  assert.equal(gate.G5, 'passed'); assert.equal(gate.candidate, freeze.head);
  assert.equal(sha(path.join(gateDir, 'APPROVED-SCOPE.md')), gate.scopeSha256);
  const git = args => execFileSync('git', args, { cwd: ROOT, encoding: 'utf8' }).trim();
  assert.equal(git(['status', '--porcelain']), '', '先提交源码，再绑定 commit 打包');
  const commit = git(['rev-parse', 'HEAD']), version = json(path.join(ROOT, 'package.json')).version;
  const folder = path.join(RELEASE, version);
  for (const f of [folder, path.join(RELEASE, `BookKeepAI-${version}-win-x64.zip`)]) assert(!existsSync(f), '同名产物存在，保留原包并先递增补丁版本');
  const files = git(['ls-files', '-z']).split('\0').filter(Boolean).filter(allowed);
  assert(files.every(f => !/(^|\/)(node_modules|dist|build|datasets|secrets|attachments)(\/|$)|\.(db|sqlite3?|bkdb|jsonl|pem|key|pfx|map)$|(^|\/)\.env(?!\.example$)/i.test(f)));
  for (const row of freeze.tracked.filter(r => /^(src|assets)\//.test(r.file) || r.file === 'electron-builder.yml')) assert.equal(sha(path.join(ROOT, row.file)), row.sha256, '影响 G5，先回 S17：' + row.file);
  const originalLock = JSON.parse(execFileSync('git', ['show', freeze.head + ':package-lock.json'], { cwd: ROOT, encoding: 'utf8' }));
  const lock = json(path.join(ROOT, 'package-lock.json'));
  originalLock.version = lock.version; originalLock.packages[''].version = lock.packages[''].version;
  assert.deepEqual(lock, originalLock, '依赖变化须先回 S17');
  assert.equal(lock.version, version); assert.equal(lock.packages[''].version, version);
  const oldZips = walk(RELEASE).filter(f => f.endsWith('.zip')).map(file => ({ file, sha256: sha(path.join(RELEASE, file)) }));
  mkdirSync(folder, { recursive: true });
  const work = path.join(ROOT, '.tmp', 'S18 打包 ' + version + '-' + Date.now());
  const source = path.join(work, 'source 中文 空格'), artifacts = path.join(work, 'artifacts');
  mkdirSync(source, { recursive: true });
  const report = { ok: false, version, commit, tree: git(['rev-parse', 'HEAD^{tree}']), g5: { candidate: gate.candidate, scope: gate.scopeId, scopeSha256: gate.scopeSha256 }, work, commands: [], oldZips, externalProviderHttp: 0, G6: 'not_executed' };
  function run(name, exe, args, cwd, env = electronSafeEnv()) {
    const r = spawnSync(exe, args, { cwd, env, windowsHide: true, encoding: 'utf8', timeout: 600000, maxBuffer: 20 * 1024 * 1024 });
    writeFileSync(path.join(folder, name + '.log'), (r.stdout ?? '') + (r.stderr ?? '') + (r.error?.message ?? ''), 'utf8');
    report.commands.push({ name, executable: exe, args, code: r.status, signal: r.signal });
    console.log(`[S18] ${name}: exit ${r.status}`);
    assert.equal(r.status, 0, name + ' 失败，查看 ' + folder); return r.stdout;
  }
  function zip(from, target, name) {
    assert(!existsSync(target));
    run(name, pwsh, ['-NoProfile', '-Command', "if ($PSVersionTable.PSVersion.Major -lt 7 -or $PSVersionTable.PSEdition -ne 'Core') { throw 'pwsh 7 Core required' }; [IO.Compression.ZipFile]::CreateFromDirectory($env:BK_ZIP_INPUT, $env:BK_ZIP_OUTPUT)"], ROOT, { ...electronSafeEnv(), BK_ZIP_INPUT: from, BK_ZIP_OUTPUT: target });
  }
  try {
    for (const f of files) copy(path.join(ROOT, f), path.join(source, f));
    report.source = files.map(file => ({ file, bytes: statSync(path.join(source, file)).size, sha256: sha(path.join(source, file)) }));
    // 构建工具只临时共享；随包运行依赖独立安装，杜绝宿主依赖泄入。
    const modules = path.join(source, 'node_modules'); symlinkSync(realpathSync(path.join(ROOT, 'node_modules')), modules, 'junction');
    run('build', process.execPath, [path.join(source, 'scripts/build.mjs')], source);
    report.frozenBuildComparison = freeze.build.map(row => {
      assert.equal(sha(path.join(ROOT, row.file)), row.sha256);
      const relative = row.file.split('/builds/candidate/')[1]; assert(relative);
      const before = readFileSync(path.join(ROOT, row.file)), after = readFileSync(path.join(source, 'dist', relative));
      const identical = before.equals(after);
      const normalized = b => b.toString().replace(/commit: "[a-f0-9]{40}"/, 'commit: "BUILD_COMMIT"');
      const commitMetadataOnly = !identical && relative === 'main/index.cjs' && normalized(before) === normalized(after);
      assert(identical || commitMetadataOnly, '构建行为变化，先回 S17：' + relative);
      return { file: relative, frozenSha256: row.sha256, releaseSha256: sha(path.join(source, 'dist', relative)), identical, commitMetadataOnly };
    });
    assert.equal(realpathSync(modules), realpathSync(path.join(ROOT, 'node_modules'))); unlinkSync(modules);
    const npm = process.env.npm_execpath ?? path.join(path.dirname(process.execPath), 'node_modules/npm/bin/npm-cli.js');
    run('production-install', process.execPath, [npm, 'ci', '--omit=dev', '--ignore-scripts', '--no-audit', '--no-fund'], source);
    report.runtimeLicenses = [];
    for (const f of walk(modules).filter(f => /^(@[^/]+\/)?[^/]+\/package\.json$/.test(f))) {
      const dir = path.dirname(f), pkg = json(path.join(modules, f));
      const legal = readdirSync(path.join(modules, dir)).filter(n => /^(licen[cs]e|copying|notice)(\.|$)/i.test(n) && statSync(path.join(modules, dir, n)).isFile());
      assert(legal.length, '缺少许可原文：' + pkg.name);
      for (const n of legal) copy(path.join(modules, dir, n), path.join(source, 'resources/licenses/production', dir, n));
      report.runtimeLicenses.push({ name: pkg.name, version: pkg.version, license: pkg.license, files: legal.map(n => 'production/' + dir.replaceAll('\\', '/') + '/' + n) });
    }
    for (const f of walk(path.join(source, 'assets/licenses'))) copy(path.join(source, 'assets/licenses', f), path.join(source, 'resources/licenses', f));
    for (const f of ['README.md', 'versions.json']) copy(path.join(modules, '@img/sharp-win32-x64', f), path.join(source, 'resources/licenses/production/@img/sharp-win32-x64', f));
    save(path.join(source, 'resources/licenses/PRODUCTION-LICENSES.json'), report.runtimeLicenses);
    run('package-dir', process.execPath, [path.join(ROOT, 'node_modules/electron-builder/cli.js'), '--win', '--dir', '--x64', '--publish', 'never', '--config', path.join(source, 'electron-builder.yml'), '--config.directories.output=' + artifacts], source);
    const app = path.join(artifacts, 'win-unpacked');
    const identity = { version, commit, tree: report.tree, g5: report.g5, platform: 'win32', arch: 'x64', generatedAt: new Date().toISOString(), environment: { node: process.version, os: os.release(), electron: json(path.join(ROOT, 'node_modules/electron/package.json')).version, electronBuilder: json(path.join(ROOT, 'node_modules/electron-builder/package.json')).version }, dataDirectory: '%LOCALAPPDATA%\\BookKeepAI', initialLedger: 'empty', ai: 'experimental; real quality unverified; no model training', G6: 'not_executed' };
    writeFileSync(path.join(app, '使用与迁移说明.md'), '# BookKeepAI ' + version + '\n\n完整解压后启动 BookKeepAI.exe，无需 Node、Python、Codex 或 DSH。首次为空账本，数据位于 %LOCALAPPDATA%\\BookKeepAI。\n\n升级前正常关闭应用，创建并另存 .bkdb 备份、保存数据根目录副本，然后解压到新程序目录。启动执行 schema 迁移，不用旧程序直接覆盖新库。恢复先预备份，在新 generation 校验后原子切换；保留旧 generation，不手工合并数据库。备份不含密钥和独立 datasets；数据集授权/撤回记录另行保护，不靠回拷恢复授权。\n\n密钥从设置页配置，无密钥时离线手工记账可用。AI 实验性，真实质量待验证，未训练。内置合成探针图不是预置交易或真实样本，只有用户明确启动探针才发送。运行组件许可见 resources/licenses 及 LICENSES.chromium.html。本软件未数字签名。\n\nG5 通过 D66 首版范围，10个环境不可执行配置仍未验证。S18 冒烟不代替 S19/G6 或干净 Windows 10/11 验收；最终发布由人类决定。\n', 'utf8');
    save(path.join(app, 'RELEASE.json'), identity);
    const softwareRows = inventory(app);
    assert(softwareRows.every(r => !/(^|\/)(data|datasets|secrets|attachments|backups)\/|\.(db|sqlite3?|bkdb|jsonl|pem|key|pfx)(-wal|-shm|-journal)?$|(^|\/)\.env(\.|$)/i.test(r.file)));
    const softwareZip = path.join(folder, `BookKeepAI-${version}-win-x64.zip`);
    zip(app, softwareZip, 'zip-software'); verifyArchive(softwareZip, softwareRows);
    const verification = verifyZipFile(softwareZip); assert(verification.ok, JSON.stringify(verification.findings)); save(path.join(folder, 'software-files.json'), softwareRows);
    const sourceArchive = path.join(work, 'source-archive'); mkdirSync(sourceArchive);
    for (const row of report.source) copy(path.join(ROOT, row.file), path.join(sourceArchive, row.file));
    save(path.join(sourceArchive, 'SOURCE-IDENTITY.json'), { ...identity, files: report.source });
    writeFileSync(path.join(sourceArchive, 'BUILDING.md'), '# Windows x64 构建\n\n版本：' + version + '\n源码 commit：' + commit + '\n\n安装 Node >=22.12（本次 ' + process.version + '），使用 PowerShell 7 Core：\n\n```powershell\nnpm ci --ignore-scripts --no-audit --no-fund\nnode node_modules/electron/install.js\nnode node_modules/esbuild/install.js\nnpm run typecheck\nnpm test -- --maxWorkers=2\nnpm run build\n```\n\n正式 npm run package:zip 还要求本地 G5 判定及 freeze.json（开发验收记录按上传约定不在源码包）。拒绝覆盖旧版本，冲突须同步递增 package/锁文件补丁版本并提交。普通构建不依赖 Codex、DSH 或 Python。无 Git 的构建 commit 为 unknown，SOURCE-IDENTITY.json 仍提供原始源码逐文件 hash。其余见 README。\n', 'utf8');
    const sourceRows = inventory(sourceArchive), sourceZip = path.join(folder, `BookKeepAI-${version}-source.zip`);
    zip(sourceArchive, sourceZip, 'zip-source'); verifyArchive(sourceZip, sourceRows); save(path.join(folder, 'source-files.json'), sourceRows);
    report.smoke = smokePackaged({ zipPath: softwareZip, workDir: path.join(work, '解压 冒烟 中文 空格') }); assert(report.smoke.ok);
    for (const old of oldZips) assert.equal(sha(path.join(RELEASE, old.file)), old.sha256, '旧包改变');
    report.artifacts = [softwareZip, sourceZip].map(f => ({ file: path.basename(f), absolutePath: f, bytes: statSync(f).size, sha256: sha(f) }));
    report.identity = identity; report.ok = true; save(path.join(folder, 'release-manifest.json'), report);
    writeFileSync(path.join(folder, 'SHA256SUMS.txt'), ['release-manifest.json', 'software-files.json', 'source-files.json', ...report.artifacts.map(a => a.file)].map(f => sha(path.join(folder, f)) + '  ' + f).join('\n') + '\n', 'utf8');
    console.log(JSON.stringify({ ok: true, folder, artifacts: report.artifacts }));
    return { zipPath: softwareZip, sourceZip, verification };
  } catch (error) { report.failure = String(error.stack ?? error); throw error; }
  finally { save(path.join(folder, 'build-result.json'), report); }
}
