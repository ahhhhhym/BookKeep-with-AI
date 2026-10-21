/** S09 scoped startup regression; isolated synthetic data, never real credentials. */
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { smokeElectron } from '../../scripts/smoke-electron.mjs';
import { ROOT } from '../../scripts/lib/paths.mjs';
process.env.LOCALAPPDATA = mkdtempSync(path.join(tmpdir(), 'BookKeep S09 startup 中文 '));
const result = await smokeElectron({ reportPath: path.join(ROOT, 'evidence/RECEIPT-S09-R1/startup.json'), restartReportPath: path.join(ROOT, 'evidence/RECEIPT-S09-R1/startup-restart.json') });
writeFileSync(path.join(ROOT, 'evidence/RECEIPT-S09-R1/startup-summary.json'), JSON.stringify({ kind: 'S09-R1 acceptance startup regression', localAppData: process.env.LOCALAPPDATA, ...result }, null, 2) + '\n', 'utf8');
process.exitCode = result.ok ? 0 : 1;
