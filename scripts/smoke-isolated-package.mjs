/** Temporary --dir build only; no S18 ZIP/release. Does not touch release/ or real user data. */
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, realpathSync, symlinkSync, unlinkSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { ROOT, electronSafeEnv } from './lib/paths.mjs';
const output = path.resolve(process.argv[2] ?? path.join(ROOT, '.tmp/isolated-package-' + Date.now()));
mkdirSync(output, { recursive: true });
const reportFile = path.join(output, 'result.json'); if (existsSync(reportFile)) throw Error('Use a new output directory.');
const source = path.join(output, 'source 中文 空格'), artifacts = path.join(output, 'temporary-app 中文 空格');
const report = { ok: false, kind: 'isolated temporary electron-builder --dir, no formal ZIP or clean-machine acceptance', checks: [], commands: [], externalProviderHttp: 0 };
const run = (name, command, args, cwd, env = electronSafeEnv()) => {
  const r = spawnSync(command, args, { cwd, env, windowsHide: true, encoding: 'utf8', timeout: 300000, maxBuffer: 10 * 1024 * 1024 });
  writeFileSync(path.join(output, name + '.log'), (r.stdout ?? '') + (r.stderr ?? ''));
  report.commands.push({ name, command, args, cwd, code: r.status, signal: r.signal });
  assert.equal(r.status, 0, name + ': ' + (r.error?.message ?? r.stderr?.slice(-1500))); return r.stdout;
};
const sha = file => createHash('sha256').update(readFileSync(file)).digest('hex');
try {
  const files = run('tracked-files', 'git', ['ls-files', '-z'], ROOT).split('\0').filter(Boolean);
  mkdirSync(source, { recursive: true });
  for (const file of files) { assert(!path.isAbsolute(file) && !file.split(/[\\/]/).includes('..')); const target = path.join(source, file); mkdirSync(path.dirname(target), { recursive: true }); copyFileSync(path.join(ROOT, file), target); }
  // Build tools are reused locally; the packaged runtime must load its own native module.
  symlinkSync(realpathSync(path.join(ROOT, 'node_modules')), path.join(source, 'node_modules'), process.platform === 'win32' ? 'junction' : 'dir');
  report.source = files.map(file => ({ file, sha256: sha(path.join(source, file)) }));
  const npm = process.env.npm_execpath ?? path.join(path.dirname(process.execPath), 'node_modules/npm/bin/npm-cli.js');
  run('build', process.execPath, [npm, 'run', 'build'], source);
  // npm's dependency collector cannot reliably traverse a junction as an installed project.
  // Remove only this newly created link, then install the locked production tree independently.
  const modules = path.join(source, 'node_modules');
  assert.equal(realpathSync(modules), realpathSync(path.join(ROOT, 'node_modules')));
  unlinkSync(modules);
  run('production-install', process.execPath, [npm, 'ci', '--omit=dev', '--ignore-scripts', '--no-audit', '--no-fund'], source);
  run('package-dir', process.execPath, [path.join(ROOT, 'node_modules/electron-builder/cli.js'), '--win', '--dir', '--x64', '--publish', 'never', '--config', path.join(source, 'electron-builder.yml'), '--config.directories.output=' + artifacts, '--config.win.signAndEditExecutable=false'], source);
  const app = path.join(artifacts, 'win-unpacked'), exe = path.join(app, 'BookKeepAI.exe'); assert(existsSync(exe));
  assert(existsSync(path.join(app, 'resources/app.asar'))); assert(existsSync(path.join(app, 'resources/licenses/THIRD-PARTY-LICENSES.txt')) || readdirSync(path.join(app, 'resources/licenses')).length > 0);
  report.checks.push({ id: 'asar-exe-licenses-present', ok: true });
  const nativeCode = `const assert=require('node:assert/strict'),path=require('node:path'),{createRequire}=require('node:module');
    const asar=path.join(path.dirname(process.execPath),'resources/app.asar'),req=createRequire(asar+'/package.json');
    const paths=Object.fromEntries(['better-sqlite3','sharp','detect-libc','semver','@img/colour'].map(name=>[name,req.resolve(name)]));
    for(const file of Object.values(paths))assert(file.startsWith(asar+path.sep),'dependency escaped package: '+file);
    const DB=req('better-sqlite3'),db=new DB(':memory:');assert.equal(db.prepare('SELECT 2999999998 AS total').get().total,2999999998);db.close();
    const sharp=req('sharp');sharp({create:{width:17,height:13,channels:3,background:'#abcdef'}}).png().toBuffer().then(b=>sharp(b).metadata()).then(meta=>{assert.equal(meta.width,17);assert.equal(meta.height,13);console.log(JSON.stringify({ok:true,paths,sqlite:'2999999998',sharp:sharp.versions,dimensions:[meta.width,meta.height]}));}).catch(e=>{console.error(e);process.exitCode=1;});`;
  const nativeEnv = { ...electronSafeEnv(), ELECTRON_RUN_AS_NODE: '1' }; delete nativeEnv.NODE_PATH;
  report.native = JSON.parse(run('packaged-native', exe, ['-e', nativeCode], app, nativeEnv));
  report.checks.push({ id: 'actual-packaged-dependency-paths-sqlite-and-sharp-decode', ok: true });
  const localAppData = path.join(output, 'isolated user 中文 空格'); mkdirSync(localAppData, { recursive: true });
  const reports = [];
  for (const name of ['first', 'restart']) {
    const file = path.join(output, name + '.json'); run(name, exe, ['--self-test', '--self-test-report=' + file], app, electronSafeEnv({ LOCALAPPDATA: localAppData }));
    const r = JSON.parse(readFileSync(file, 'utf8')); assert.equal(r.ok, true); assert(r.checks.every(c => c.ok)); reports.push(r);
  }
  const seeded = reports.map(r => r.checks.find(c => c.id === 'db.defaultLedgerSeed').detail);
  assert.deepEqual(seeded[0], seeded[1]);
  report.checks.push({ id: 'packaged-native-sqlite-resource-preload-first-and-restart', ok: true, counts: reports.map(r => r.checks.length), seed: seeded[0] });
  report.executable = exe; report.asarSha256 = sha(path.join(app, 'resources/app.asar'));
  report.ok = true;
} catch (e) { report.failure = String(e.stack ?? e); process.exitCode = 1; }
finally { writeFileSync(reportFile, JSON.stringify(report, null, 2)); }
console.log(JSON.stringify({ ok: report.ok, output, failure: report.failure }));
