/** S16 maintained regression entry. No real provider smoke, ZIP, merge or release. */
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, openSync, closeSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { ROOT, electronSafeEnv } from './lib/paths.mjs';

const base = path.join(ROOT, '.tmp'); mkdirSync(base, { recursive: true });
const output = process.argv[2] ? path.resolve(process.argv[2]) : mkdtempSync(path.join(base, 'regression-'));
mkdirSync(output, { recursive: true });
if (existsSync(path.join(output, 'commands.json'))) throw Error('Use a new output directory; previous evidence must be retained.');
const npm = process.env.npm_execpath ?? path.join(path.dirname(process.execPath), 'node_modules/npm/bin/npm-cli.js');
if (!existsSync(npm)) throw Error('Run using npm run test:regression, or a Node installation containing npm.');
const pkg = JSON.parse(readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
const git = args => { const r = spawnSync('git', args, { cwd: ROOT, encoding: 'utf8', windowsHide: true }); if (r.status !== 0) throw Error(r.stderr); return r.stdout.trim(); };
const commands = [['typecheck', [npm, 'run', 'typecheck']], ['tests', [npm, 'test', '--', '--maxWorkers=1', '--reporter=json', '--outputFile=' + path.join(output, 'tests.json')]], ['icons', [npm, 'run', 'verify:icons']], ...(pkg.scripts.lint ? [['lint', [npm, 'run', 'lint']]] : []), ['build', [npm, 'run', 'build']], ['startup', [npm, 'run', 'smoke:electron']], ...['financial-regression', 'review-approval', 'recognition-queue', 'security-recovery', 'restore-reconciliation', 'recovery-crash', 'dataset-workflow', 'dataset-crash'].map(n => [n, ['tests/electron/' + n + '.mjs']]), ['dataset-demo', [npm, 'run', 'dataset:demo', '--', path.join(output, 'dataset-demo')]], ['isolated-package', ['scripts/smoke-isolated-package.mjs', path.join(output, 'isolated-package')]]];
const report = { ok: false, kind: 'S16 implementation selftest; not S17 acceptance', head: git(['rev-parse', 'HEAD']), tree: git(['rev-parse', 'HEAD^{tree}']), statusBefore: git(['status', '--porcelain']), node: process.version, platform: process.platform, arch: process.arch, startedAt: new Date().toISOString(), externalProviderHttp: 0, notExecuted: ['real DeepSeek: samples/key/fee authorization not established', ...(pkg.scripts.lint ? [] : ['lint: not configured']), 'Win11/clean machine, hardware power loss, human IME/DPI/accessibility, formal S18 ZIP and G5/G6'], commands: [] };
const save = () => writeFileSync(path.join(output, 'commands.json'), JSON.stringify(report, null, 2));
save();
for (const [name, args] of commands) {
  const dir = path.join(output, name); mkdirSync(dir, { recursive: true });
  const log = path.join(output, name + '.log'), fd = openSync(log, 'wx'), start = Date.now();
  console.log('START ' + name);
  let result;
  try {
    result = await new Promise(resolve => {
      const child = spawn(process.execPath, args, { cwd: ROOT, windowsHide: true, stdio: ['ignore', fd, fd], env: electronSafeEnv({ BOOKKEEP_QA_OUTPUT: dir }) });
      let error; child.once('error', e => { error = e.message; });
      const timer = setTimeout(() => { child.kill('SIGKILL'); error = 'regression command timeout'; }, 600000);
      child.once('close', (code, signal) => { clearTimeout(timer); resolve({ code, signal, ...(error ? { error } : {}) }); });
    });
  } finally { closeSync(fd); }
  report.commands.push({ name, executable: process.execPath, args, cwd: ROOT, startedAt: new Date(start).toISOString(), endedAt: new Date().toISOString(), log, ...result }); save();
  console.log(name + ': ' + result.code);
  if (result.code !== 0) { console.error(readFileSync(log, 'utf8').slice(-5000)); break; }
}
report.headAfter = git(['rev-parse', 'HEAD']); report.statusAfter = git(['status', '--porcelain']);
report.ok = report.commands.length === commands.length && report.commands.every(c => c.code === 0) && report.head === report.headAfter && report.statusBefore === report.statusAfter;
report.endedAt = new Date().toISOString(); save();
console.log(JSON.stringify({ ok: report.ok, output, commands: report.commands.length })); process.exitCode = report.ok ? 0 : 1;
