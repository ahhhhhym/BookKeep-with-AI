// S09-R1 acceptance only. Frozen app; no product changes. --real sends one fixed image.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { createHash, randomUUID } from 'node:crypto';
import { readFileSync, writeFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { ROOT, electronExecutable, electronSafeEnv } from '../../scripts/lib/paths.mjs';
const require = createRequire(import.meta.url);
const { _electron } = createRequire(path.join(process.env.BOOKKEEP_QA_NODE_MODULES, '__qa__.cjs'))('playwright');
const Database = require('better-sqlite3');
const real = process.argv.includes('--real');
const target = path.join(ROOT, 'evidence/RECEIPT-S09-R1');
const localAppData = real ? process.env.LOCALAPPDATA : mkdtempSync(path.join(tmpdir(), 'BookKeep S09 R1 中文 '));
const checks = [];
const result = { kind: real ? 'real-api-S09-R1' : 'isolated-IPC-and-mock-S09-R1-NOT-G2', localAppData, checks, ok: false };
let app, page;
const check = (id, detail = {}) => { checks.push({ id, detail, ok: true }); console.log('PASS ' + id); };
function snapshot() {
  const data = path.join(localAppData, 'BookKeepAI/data');
  const pointer = JSON.parse(readFileSync(path.join(data, 'active.json'), 'utf8'));
  const db = new Database(path.join(data, 'generations', pointer.generationId, 'ledger.db'), { readonly: true });
  try {
    // Only row counts and hashes leave this helper. No user transaction text is recorded.
    const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all();
    return { tables: tables.map(({name}) => { const rows = db.prepare('SELECT * FROM "' + name.replaceAll('"', '""') + '" ORDER BY rowid').all(); return { name, rows: rows.length, sha256: createHash('sha256').update(JSON.stringify(rows)).digest('hex') }; }), quickCheck: db.pragma('quick_check'), foreignKeys: db.pragma('foreign_key_check') };
  } finally { db.close(); }
}
async function launch() {
  app = await _electron.launch({ executablePath: electronExecutable(), args: [ROOT], cwd: ROOT, env: electronSafeEnv({ LOCALAPPDATA: localAppData }), timeout: 30000 });
  page = await app.firstWindow(); page.setDefaultTimeout(15000);
  await page.locator('[data-ledger-total]').waitFor();
  await page.getByRole('button', { name: '设置', exact: true }).click();
}
const api = (group, method, input) => page.evaluate(async ({group, method, input}) => window.bookkeep[group][method](...(input === undefined ? [] : [input])), {group, method, input});
const payload = { fixtureId: 's09-receipt-v1', uploadConsent: true, possibleChargeAccepted: true };
try {
  await launch();
  const before = snapshot(); result.databaseBefore = before;
  assert.equal((await api('settings','readAi')).data.readiness,'needs_probe');
  assert.equal((await api('provider','capabilities',{providerId:'deepseek'})).data.structuredOutputStatus,'unverified');
  check('new-process-readiness-not-inherited-from-history');
  if (!real) {
    for (const [id, input] of [
      ['upload-consent-required', {...payload, uploadConsent:false}],
      ['charge-consent-required', {...payload, possibleChargeAccepted:false}],
      ['fixed-fixture-required', {...payload, fixtureId:'arbitrary-image'}],
      ['no-arbitrary-url-path-key', {...payload, url:'https://example.com', path:'C:/sample.png', key:'synthetic-only'}],
    ]) { const reply=await api('provider','probe',input); assert.equal(reply.ok,false); check(id,{code:reply.error.code}); }
    const missing = await api('provider','probe',payload);
    assert.equal(missing.data.requestCount,0); assert.equal(missing.data.errorCode,'SECRET_REQUIRED');
    check('missing-key-zero-HTTP');
    const mock=await api('skeleton','mockRecognition',{scenario:'paid-order'});
    assert.equal(mock.ok,true);
    assert.equal((await api('provider','capabilities',{providerId:'deepseek'})).data.structuredOutputStatus,'unverified');
    check('mock-provider-does-not-verify-deepseek');
    const status = (await api('settings','readStatus')).data;
    const save = await api('settings','saveSecret',{expectedVersion:status.version,action:'save',secret:'R1-synthetic-key-never-leaves-test',persistence:'session'});
    assert.equal(save.ok,true);
  } else {
    const status=(await api('settings','readStatus')).data;
    assert.equal(status.configured,true,'本应用未配置密钥，本轮真实请求未执行');
    assert.equal(await page.locator('#secret-input').inputValue(),'');
    result.secretStatus = status; // Safe status only; no encrypted blob or plaintext is read by harness.
  }
  const forcedMutationId = randomUUID();
  await app.evaluate(({ ipcMain }, {real, forcedMutationId}) => {
    const originalHandler = ipcMain._invokeHandlers.get('provider.probe');
    globalThis.__r1 = { originalFetch: globalThis.fetch, originalHandler, invokes:0, calls:0, requests:[], forcedMutationId, pending:!real };
    globalThis.__r1.gate = new Promise(resolve => { globalThis.__r1.release=resolve; });
    ipcMain.removeHandler('provider.probe');
    ipcMain.handle('provider.probe',(event, request)=>{globalThis.__r1.invokes++;return originalHandler(event,{...request,mutationId:globalThis.__r1.forcedMutationId ?? request.mutationId});});
    globalThis.fetch = async (url, init) => {
      const qa=globalThis.__r1; qa.calls++;
      const body=JSON.parse(init.body);
      const imageUrl=body.messages[1].content.find(part=>part.type==='image_url').image_url.url;
      const image=Buffer.from(imageUrl.split(',')[1],'base64');
      const text=JSON.stringify(body.messages.map(m=>typeof m.content==='string'?m.content:m.content.filter(p=>p.type==='text')));
      qa.requests.push({endpoint:url,method:init.method,redirect:init.redirect,model:body.model,responseFormat:body.response_format.type,thinking:body.thinking.type,imageBytes:image.length,imageSha256:Buffer.from(await globalThis.crypto.subtle.digest('SHA-256',image)).toString('hex'),textContainsTruth:['3742','37.42','2026-08-19','燕麦饼干'].some(t=>text.includes(t)),containsLedger:JSON.stringify(body).includes('ledgerId')});
      if(real) return qa.originalFetch(url,init);
      await qa.gate;
      const output={schemaVersion:'bk-candidate.v1',candidates:[{amountFen:3742,occurredDate:'2026-08-19',occurredTime:null,timePrecision:'date',name:'燕麦饼干',merchant:null,categoryId:'cat_food',transactionKind:'expense',amountBasis:'paid_total',groupKey:null,lineItems:[],evidence:['amountFen','occurredDate','name','categoryId'].map(field=>({field,text:'合成字段',region:null,source:'image'})),missingFields:[],warnings:[],confidence:null}],warnings:[]};
      return new Response(JSON.stringify({model:'deepseek-flash',choices:[{finish_reason:'stop',message:{content:JSON.stringify(output)}}],usage:{prompt_tokens:1,completion_tokens:1,total_tokens:2}}));
    };
  },{real,forcedMutationId});
  let first;
  if(real) {
    const button=page.getByRole('button',{name:'运行一次真实图片探针',exact:true});
    assert.equal(await button.isDisabled(),true);
    await page.getByRole('checkbox',{name:'我同意上传合成测试图并接受本次 API 费用',exact:true}).check();
    await button.click();
    await page.locator('[data-probe-result]').waitFor({timeout:100000});
    first={ok:true,data:JSON.parse(await page.locator('[data-probe-result]').innerText())};
    writeFileSync(path.join(target,'real-probe-'+first.data.id+'.json'),JSON.stringify(first.data,null,2)+'\n','utf8');
    result.realReportId=first.data.id;
    check('one-real-UI-action-returned-report',{id:first.data.id,passed:first.data.passed,errorCode:first.data.errorCode});
  } else {
    const pending=api('provider','probe',payload);
    await app.evaluate(async()=>{while(!globalThis.__r1.calls) await new Promise(resolve=>setImmediate(resolve));});
    const replayPending=api('provider','probe',payload);
    await app.evaluate(async()=>{while(globalThis.__r1.invokes<2) await new Promise(resolve=>setImmediate(resolve));});
    await app.evaluate(()=>{globalThis.__r1.forcedMutationId=null;});
    const conflict=await api('provider','probe',payload); result.concurrentResponse=conflict; assert.equal(conflict.error?.code,'STATE_CONFLICT');
    check('different-mutation-concurrent-probe-rejected',{code:conflict.error.code});
    await app.evaluate(()=>globalThis.__r1.release());
    first=await pending; const replay=await replayPending;
    assert.equal(replay.data.id,first.data.id); check('same-mutation-concurrent-replay-same-report');
    await app.evaluate((_electron,id)=>{globalThis.__r1.forcedMutationId=id;},forcedMutationId);
  }
  assert.equal(first.ok,true); result.report=first.data;
  const replay=await api('provider','probe',payload); assert.equal(replay.data.id,first.data.id);
  const transport=await app.evaluate(()=>({calls:globalThis.__r1.calls,requests:globalThis.__r1.requests}));
  result.transport=transport;
  assert.equal(transport.calls,1); assert.equal(transport.requests[0].imageBytes,26450);
  assert.equal(transport.requests[0].imageSha256,'0136644513a3a9ebebec66bf893d81c31694f01d95057856190d965b5133d2d8');
  assert.equal(transport.requests[0].textContainsTruth,false); assert.equal(transport.requests[0].containsLedger,false);
  check('replay-no-second-HTTP-and-exact-image-no-truth-in-text',transport);
  assert.equal(first.data.passed,true,'本轮图片字段或schema未通过，保留失败证据');
  assert.equal((await api('settings','readAi')).data.readiness,'ready');
  assert.equal((await api('provider','capabilities',{providerId:'deepseek'})).data.probeEvidenceId,first.data.id);
  check(real?'real-success-readiness-binds-this-report':'MOCK-valid-response-gates-readiness-NOT-G2');
  const after=snapshot(); result.databaseAfter=after; assert.deepEqual(after,before);
  check('all-business-tables-counts-and-content-hashes-unchanged');
  if(real) {
    assert.equal(await page.locator('#secret-input').inputValue(),'');
    await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].setContentSize(1280,1000));
    writeFileSync(path.join(target,'real-success.png'),Buffer.from(await app.evaluate(async({BrowserWindow})=>(await BrowserWindow.getAllWindows()[0].webContents.capturePage()).toPNG().toString('base64')),'base64'));
  } else {
    const status=(await api('settings','readStatus')).data;
    assert.equal((await api('settings','saveSecret',{expectedVersion:status.version,action:'remove'})).ok,true);
    assert.equal((await api('settings','readAi')).data.readiness,'needs_probe');
    assert.equal((await api('provider','capabilities',{providerId:'deepseek'})).data.probeEvidenceId,null);
    check('key-version-change-invalidates-verified-evidence');
  }
  await app.close(); app=null; await launch();
  assert.equal((await api('settings','readAi')).data.readiness,'needs_probe');
  assert.equal((await api('provider','capabilities',{providerId:'deepseek'})).data.structuredOutputStatus,'unverified');
  assert.deepEqual(snapshot(),before); check('restart-keeps-business-tables-and-resets-session-verification');
  result.ok=true;
} catch(error) { result.error=error.stack; console.error(error); process.exitCode=1; }
finally {
  if(app) await app.close().catch(()=>{});
  writeFileSync(path.join(target,(real?'real':'isolated')+'-acceptance-'+Date.now()+'.json'),JSON.stringify(result,null,2)+'\n','utf8');
}
