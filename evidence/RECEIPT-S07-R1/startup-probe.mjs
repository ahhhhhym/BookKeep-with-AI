import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { smokeElectron } from '../../scripts/smoke-electron.mjs';
const target = path.resolve('evidence/RECEIPT-S07-R1');
const localAppData = mkdtempSync(path.join(tmpdir(), 'BookKeepAI S07 startup 中文 '));
process.env.LOCALAPPDATA = localAppData;
const result = await smokeElectron({ reportPath: path.join(target, 'selftest-dev.json'), restartReportPath: path.join(target, 'selftest-dev-restart.json') });
writeFileSync(path.join(target, 'startup-result.json'), JSON.stringify({ localAppData, kind: 'S07 R1 acceptance startup regression; not S08 or G1', ...result }, null, 2) + '\n', 'utf8');
process.exitCode = result.ok ? 0 : 1;

