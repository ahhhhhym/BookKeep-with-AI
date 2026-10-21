/** S09 scoped startup regression; isolated synthetic data, never real credentials. */
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { smokeElectron } from './smoke-electron.mjs';
import { ROOT } from './lib/paths.mjs';
process.env.LOCALAPPDATA = mkdtempSync(path.join(tmpdir(), 'BookKeep S09 startup 中文 '));
const result = await smokeElectron({ reportPath: path.join(ROOT, 'evidence/S09/startup.json'), restartReportPath: path.join(ROOT, 'evidence/S09/startup-restart.json') });
writeFileSync(path.join(ROOT, 'evidence/S09/startup-summary.json'), JSON.stringify({ kind: 'S09 implementation startup regression', localAppData: process.env.LOCALAPPDATA, ...result }, null, 2) + '\n', 'utf8');
process.exitCode = result.ok ? 0 : 1;
