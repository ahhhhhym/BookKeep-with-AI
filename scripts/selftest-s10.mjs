/** Startup + real process restart on isolated synthetic profile. */
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { smokeElectron } from './smoke-electron.mjs';
import { ROOT } from './lib/paths.mjs';
process.env.LOCALAPPDATA=mkdtempSync(path.join(tmpdir(),'BookKeep S10 startup 中文 '));
const result=await smokeElectron({reportPath:path.join(ROOT,'evidence/S10/startup.json'),restartReportPath:path.join(ROOT,'evidence/S10/startup-restart.json')});
writeFileSync(path.join(ROOT,'evidence/S10/startup-summary.json'),JSON.stringify({kind:'S10 implementation startup regression; not acceptance',...result},null,2)+'\n');
process.exitCode=result.ok?0:1;
