/** Desktop distribution from a clean, committed source tree. Never publishes or replaces artifacts. */
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, realpathSync, statSync, symlinkSync, unlinkSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { isDeepStrictEqual } from 'node:util';
import { ROOT, RELEASE, electronSafeEnv, ensurePlainNode } from './lib/paths.mjs';
import { readZip, zipEntryData } from './lib/zip.mjs';
import { verifyZipFile } from './verify-zip.mjs';
import { smokePackaged } from './smoke-packaged.mjs';

const PWSH = 'C:\\Users\\Administrator\\AppData\\Local\\Microsoft\\WindowsApps\\pwsh.exe';
const allowed = f => /^(src|tests|scripts|assets|resources\/licenses)\//.test(f) || /^(README\.md|package(-lock)?\.json|electron-builder\.yml|tsconfig[^/]*\.json|vite\.config\.ts|vitest\.config\.ts|\.gitignore|\.gitattributes|\.env\.example)$/.test(f);
const forbidden = f => /(^|\/)(node_modules|dist|build|datasets|secrets|attachments|evidence|handoff|tasks)(\/|$)|\.(db|sqlite3?|bkdb|jsonl|pem|key|pfx|map)$|(^|\/)\.env(?!\.example$)/i.test(f);
const sha = f => createHash('sha256').update(readFileSync(f)).digest('hex');
const json = f => JSON.parse(readFileSync(f, 'utf8'));
const save = (f, v) => writeFileSync(f, JSON.stringify(v, null, 2) + '\n', 'utf8');
const copy = (from, to) => { mkdirSync(path.dirname(to), { recursive: true }); copyFileSync(from, to); };
function walk(root, prefix = '') {
  return readdirSync(path.join(root, prefix), { withFileTypes: true }).flatMap(e => {
    assert(!e.isSymbolicLink(), 'Artifact links are not allowed');
    const f = prefix ? prefix + '/' + e.name : e.name;
    return e.isDirectory() ? walk(root, f) : [f];
  }).sort();
}
const inventory = root => walk(root).map(file => ({ file, bytes: statSync(path.join(root, file)).size, sha256: sha(path.join(root, file)) }));
function verifyArchive(file, rows) {
  const buffer = readFileSync(file), entries = readZip(buffer).filter(e => !e.name.endsWith('/'));
  assert.deepEqual(entries.map(e => e.name).sort(), rows.map(r => r.file).sort());
  for (const row of rows) {
    const data = zipEntryData(buffer, entries.find(e => e.name === row.file));
    assert.equal(data.length, row.bytes, row.file);
    assert.equal(createHash('sha256').update(data).digest('hex'), row.sha256, row.file);
  }
}

export async function buildDesktopRelease() {
  assert.equal(process.platform, 'win32'); assert.equal(process.arch, 'x64');
  const git = args => execFileSync('git', args, { cwd: ROOT, encoding: 'utf8', windowsHide: true }).trim();
  assert.equal(git(['status', '--porcelain']), '', 'Commit the source tree before packaging');
  const pkg = json(path.join(ROOT, 'package.json')), lock = json(path.join(ROOT, 'package-lock.json'));
  assert.equal(lock.version, pkg.version); assert.equal(lock.packages[''].version, pkg.version);
  const version = pkg.version, commit = git(['rev-parse', 'HEAD']), tree = git(['rev-parse', 'HEAD^{tree}']);
  const folder = path.join(RELEASE, version);
  assert(!existsSync(folder), 'Version output already exists; preserve it and choose a new version/output');
  const tracked = git(['ls-files', '-z']).split('\0').filter(Boolean);
  const historical = new Set(['docs/DATASET.md', 'docs/EVALUATION.md', 'docs/S12-DECISIONS.md', 'tasks/S12.md', 'handoff/S12/HANDOFF.md', 'evidence/S12/QA.md']);
  const files = tracked.filter(allowed), excluded = tracked.filter(f => !allowed(f));
  assert(excluded.every(f => historical.has(f)), 'Unexpected tracked material outside the application whitelist');
  assert(files.length > 0 && files.every(f => !forbidden(f)), 'Source archive must contain only application source and required resources');
  const previous = (existsSync(RELEASE) ? walk(RELEASE) : []).filter(f => /\.(zip|exe)$/.test(f)).map(file => ({ file, sha256: sha(path.join(RELEASE, file)) }));
  const work = path.join(ROOT, '.tmp', 'Desktop release ' + version + '-' + Date.now());
  const source = path.join(work, 'source 中文 空格'), artifacts = path.join(work, 'artifacts');
  const evidence = path.join(work, 'verification');
  mkdirSync(evidence, { recursive: true }); mkdirSync(source, { recursive: true }); mkdirSync(folder, { recursive: true });
  const report = { ok: false, version, commit, tree, work, commands: [], previous, excludedHistoricalFiles: excluded, externalProviderHttp: 0 };
  const env = extra => {
    const clean = electronSafeEnv({ CSC_IDENTITY_AUTO_DISCOVERY: 'false', ...extra });
    for (const key of ['CSC_LINK', 'CSC_KEY_PASSWORD', 'WIN_CSC_LINK', 'WIN_CSC_KEY_PASSWORD']) delete clean[key];
    return clean;
  };
  const run = (name, command, args, cwd = source, extra = {}) => {
    const r = spawnSync(command, args, { cwd, env: env(extra), windowsHide: true, encoding: 'utf8', timeout: 600000, maxBuffer: 20 * 1024 * 1024 });
    writeFileSync(path.join(evidence, name + '.log'), (r.stdout ?? '') + (r.stderr ?? '') + (r.error?.message ?? ''), 'utf8');
    report.commands.push({ name, command, args, cwd, code: r.status, signal: r.signal });
    console.log(`[release] ${name}: ${r.status}`);
    assert.equal(r.status, 0, name + ' failed: ' + path.join(evidence, name + '.log'));
    return r.stdout;
  };
  const zip = (from, target, name) => run(name, PWSH, ['-NoProfile', '-Command', "if ($PSVersionTable.PSVersion.Major -lt 7 -or $PSVersionTable.PSEdition -ne 'Core') { throw 'PowerShell 7 Core required' }; [IO.Compression.ZipFile]::CreateFromDirectory($env:BK_ZIP_INPUT, $env:BK_ZIP_OUTPUT)"], ROOT, { BK_ZIP_INPUT: from, BK_ZIP_OUTPUT: target });
  try {
    for (const f of files) copy(path.join(ROOT, f), path.join(source, f));
    report.source = inventory(source);
    const modules = path.join(source, 'node_modules');
    symlinkSync(realpathSync(path.join(ROOT, 'node_modules')), modules, 'junction');
    try { run('build', process.execPath, [path.join(source, 'scripts/build.mjs')]); }
    finally { assert.equal(realpathSync(modules), realpathSync(path.join(ROOT, 'node_modules'))); unlinkSync(modules); }
    const npm = process.env.npm_execpath ?? path.join(path.dirname(process.execPath), 'node_modules/npm/bin/npm-cli.js');
    run('production-install', process.execPath, [npm, 'ci', '--omit=dev', '--ignore-scripts', '--no-audit', '--no-fund']);
    const licenses = [];
    for (const f of walk(modules).filter(f => /^(@[^/]+\/)?[^/]+\/package\.json$/.test(f))) {
      const dir = path.dirname(f), dep = json(path.join(modules, f));
      const legal = readdirSync(path.join(modules, dir)).filter(n => /^(licen[cs]e|copying|notice)(\.|$)/i.test(n) && statSync(path.join(modules, dir, n)).isFile());
      assert(legal.length, 'Missing license: ' + dep.name);
      for (const n of legal) copy(path.join(modules, dir, n), path.join(source, 'resources/licenses/production', dir, n));
      licenses.push({ name: dep.name, version: dep.version, license: dep.license, files: legal });
    }
    for (const f of walk(path.join(source, 'assets/licenses'))) copy(path.join(source, 'assets/licenses', f), path.join(source, 'resources/licenses', f));
    for (const f of ['README.md', 'versions.json']) copy(path.join(modules, '@img/sharp-win32-x64', f), path.join(source, 'resources/licenses/production/@img/sharp-win32-x64', f));
    save(path.join(source, 'resources/licenses/PRODUCTION-LICENSES.json'), licenses);
    const builder = path.join(ROOT, 'node_modules/electron-builder/cli.js');
    const config = ['--config', path.join(source, 'electron-builder.yml'), '--config.directories.output=' + artifacts];
    run('package-dir', process.execPath, [builder, '--win', '--dir', '--x64', '--publish', 'never', ...config]);
    const app = path.join(artifacts, 'win-unpacked');
    const identity = { version, commit, tree, platform: 'win32', arch: 'x64', publisher: '瀚宇铭', signing: 'unsigned', dataDirectory: '%LOCALAPPDATA%\\BookKeepAI' };
    save(path.join(app, 'RELEASE.json'), identity);
    writeFileSync(path.join(app, '使用说明.txt'), `BookKeepAI ${version}\n\nZIP 完整解压后启动 BookKeepAI.exe；安装版运行 setup.exe，按向导选择安装目录。无需安装 Node.js 或 Python。\n\n账本和设置保存在 %LOCALAPPDATA%\\BookKeepAI，不随程序目录移动。ZIP 与安装版使用同一用户的数据目录，请勿同时运行。卸载保留用户数据。\n\n升级前关闭应用，在数据管理中创建并另存 .bkdb 备份，再安装新版或解压到新目录。不要用旧版程序打开新版数据库。备份不含 API 密钥和独立数据集，请分别保护相关资料。\n\n手工记账可离线使用。AI 识别需在设置配置自己的密钥，并确认图片上传与费用；结果须逐笔审核后才入账。\n\n隐私政策：设置 → 隐私政策。运营主体：瀚宇铭。\n第三方许可见 resources/licenses、LICENSE.electron.txt、LICENSES.chromium.html。\n本版本未数字签名，下载请核对发行页的 SHA256SUMS.txt。\n`, 'utf8');
    const softwareRows = inventory(app);
    assert(softwareRows.every(r => !/(^|\/)(data|datasets|secrets|attachments|backups)\/|\.(db|sqlite3?|bkdb|jsonl|pem|key|pfx)(-wal|-shm|-journal)?$|(^|\/)\.env(\.|$)/i.test(r.file)));
    const softwareZip = path.join(folder, `BookKeepAI-${version}-win-x64.zip`);
    zip(app, softwareZip, 'zip-software'); verifyArchive(softwareZip, softwareRows);
    report.zipVerification = verifyZipFile(softwareZip); assert(report.zipVerification.ok);
    run('package-installer', process.execPath, [builder, '--prepackaged', app, '--win', 'nsis', '--x64', '--publish', 'never', ...config]);
    assert(isDeepStrictEqual(inventory(app), softwareRows), 'Installer packaging changed portable payload');
    const setupName = `BookKeepAI-${version}-win-x64-setup.exe`;
    copy(path.join(artifacts, setupName), path.join(folder, setupName));
    const sourceArchive = path.join(work, 'source-archive'); mkdirSync(sourceArchive);
    for (const row of report.source) copy(path.join(ROOT, row.file), path.join(sourceArchive, row.file));
    save(path.join(sourceArchive, 'SOURCE-IDENTITY.json'), { ...identity, files: report.source });
    writeFileSync(path.join(sourceArchive, 'BUILDING.md'), `# BookKeepAI ${version}\n\n源码 commit：${commit}\n\nWindows 10/11 x64，Node.js >=22.12，PowerShell 7 Core。\n\n运行以下命令：\n\n    npm ci --ignore-scripts --no-audit --no-fund\n    node node_modules/electron/install.js\n    node node_modules/esbuild/install.js\n    npm run typecheck\n    npm test -- --maxWorkers=1\n    npm run build\n    npm run smoke:electron\n\n生成发行文件请从 Git 仓库检出上述 commit，在干净工作区执行 npm run package:release。该命令仅生成本地文件，不上传或发布。直接从无 Git 的源码 ZIP 构建时，程序的 commit 字段为 unknown，SOURCE-IDENTITY.json 提供原始源码标识与逐文件 SHA256。\n`, 'utf8');
    const sourceRows = inventory(sourceArchive), sourceZip = path.join(folder, `BookKeepAI-${version}-source.zip`);
    zip(sourceArchive, sourceZip, 'zip-source'); verifyArchive(sourceZip, sourceRows);
    report.smoke = smokePackaged({ zipPath: softwareZip, workDir: path.join(work, '解压 启动 中文 空格') }); assert(report.smoke.ok);
    for (const old of previous) assert.equal(sha(path.join(RELEASE, old.file)), old.sha256, 'Previous artifact changed');
    assert.equal(git(['rev-parse', 'HEAD']), commit); assert.equal(git(['status', '--porcelain']), '');
    for (const row of report.source) assert.equal(sha(path.join(ROOT, row.file)), row.sha256, 'Source changed during packaging');
    report.softwareFiles = softwareRows; report.sourceFiles = sourceRows;
    report.artifacts = [softwareZip, sourceZip, path.join(folder, setupName)].map(f => ({ file: path.basename(f), bytes: statSync(f).size, sha256: sha(f) }));
    writeFileSync(path.join(folder, 'SHA256SUMS.txt'), report.artifacts.map(a => `${a.sha256}  ${a.file}`).join('\n') + '\n', 'utf8');
    report.environment = { node: process.version, os: os.release(), electron: json(path.join(ROOT, 'node_modules/electron/package.json')).version };
    report.ok = true;
    console.log(JSON.stringify({ ok: true, folder, evidence, artifacts: report.artifacts }));
    return report;
  } catch (error) { report.failure = String(error.stack ?? error); throw error; }
  finally { save(path.join(evidence, 'build-result.json'), report); }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) { ensurePlainNode(); await buildDesktopRelease(); }
