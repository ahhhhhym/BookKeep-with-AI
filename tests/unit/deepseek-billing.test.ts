import {expect,it} from 'vitest';
import {evaluateDeepSeekBilling} from '../../src/shared/deepseek-billing';
import {DEEPSEEK_BILLING_RULES} from '../../src/shared/deepseek-billing-rules';
import {spawnSync} from 'node:child_process';
import {buildSync} from 'esbuild';
const target={provider:'deepseek' as const,endpoint:'https://api.deepseek.com/chat/completions',model:'deepseek-flash'};
const decide=(t:string,r:unknown=DEEPSEEK_BILLING_RULES)=>evaluateDeepSeekBilling(Date.parse(t+'+08:00'),target,r).state;
it.each([['08:59:59.999','off_peak'],['09:00:00','peak'],['11:59:59.999','peak'],['12:00:00','off_peak'],['13:59:59.999','off_peak'],['14:00:00','peak'],['17:59:59.999','peak'],['18:00:00','off_peak']])('Beijing boundary %s', (time,state)=>expect(decide('2026-11-04T'+time)).toBe(state));
it('weekend, cross-year, before verification and invalid clock are conservative',()=>{
 expect(decide('2026-11-07T10:00:00')).toBe('off_peak');expect(decide('2026-12-31T23:59:59')).toBe('off_peak');expect(decide('2027-01-01T00:00:00')).toBe('unknown');
 expect(decide('2026-01-01T10:00:00')).toBe('unknown');expect(evaluateDeepSeekBilling(NaN,target,DEEPSEEK_BILLING_RULES).state).toBe('unknown');
});
it('synthetic historical snapshot tests statutory holiday, ambiguous leave and natural weekend makeup',()=>{
 const syntheticRuleSnapshot={...DEEPSEEK_BILLING_RULES,verifiedOn:'2026-01-01',calendar:DEEPSEEK_BILLING_RULES.calendar.map(c=>({...c,verifiedOn:'2026-01-01'}))};
 expect(decide('2026-02-17T10:00:00',syntheticRuleSnapshot)).toBe('off_peak');expect(decide('2026-02-20T10:00:00',syntheticRuleSnapshot)).toBe('unknown');expect(decide('2026-02-28T10:00:00',syntheticRuleSnapshot)).toBe('off_peak');
});
it('corrupt calendar, overlapping windows and future calendar verification are unknown',()=>{
 for(const r of [
  {...DEEPSEEK_BILLING_RULES,calendar:DEEPSEEK_BILLING_RULES.calendar.map(c=>({...c,confirmedHolidayDates:[]}))},
  {...DEEPSEEK_BILLING_RULES,windows:[{startMinute:540,endMinute:720},{startMinute:600,endMinute:900}]},
  {...DEEPSEEK_BILLING_RULES,windows:[{startMinute:540,endMinute:720}]},
  {...DEEPSEEK_BILLING_RULES,calendar:DEEPSEEK_BILLING_RULES.calendar.map(c=>({...c,verifiedOn:'2027-01-01'}))},
 ])expect(decide('2026-11-04T10:00:00',r)).toBe('unknown');
});
it('same absolute instant is independent of device timezone in real subprocesses',()=>{
 const built=buildSync({entryPoints:['src/shared/deepseek-billing.ts'],bundle:true,write:false,platform:'node',format:'cjs'}).outputFiles[0]!.text;
 const rules=JSON.stringify(DEEPSEEK_BILLING_RULES),t=JSON.stringify(target);
 const output=['UTC','America/Los_Angeles','Asia/Shanghai'].map(TZ=>{
  const p=spawnSync(process.execPath,['-e',built+`\nconsole.log(JSON.stringify(module.exports.evaluateDeepSeekBilling(Date.parse('2026-11-04T01:00:00Z'),${t},${rules})));`],{encoding:'utf8',env:{...process.env,TZ}});
  expect(p.status).toBe(0);return p.stdout;
 });expect(new Set(output).size).toBe(1);expect(output[0]).toContain('peak');
});
it('mock/nonofficial exclude; target missing/model unknown/rules corrupt never off peak',()=>{
 const now=Date.parse('2026-11-04T02:00:00Z');
 expect(evaluateDeepSeekBilling(now,{...target,provider:'mock'},null).state).toBe('not_applicable');
 expect(evaluateDeepSeekBilling(now,{...target,endpoint:'https://example.org/v1'},null).state).toBe('not_applicable');
 for(const r of [null,{}, {...DEEPSEEK_BILLING_RULES,timeZone:'UTC'},{...DEEPSEEK_BILLING_RULES,calendar:[]}])expect(evaluateDeepSeekBilling(now,target,r).state).toBe('unknown');
 expect(evaluateDeepSeekBilling(now,{...target,endpoint:null},DEEPSEEK_BILLING_RULES).state).toBe('unknown');
 expect(evaluateDeepSeekBilling(now,{...target,model:'unverified'},DEEPSEEK_BILLING_RULES).state).toBe('unknown');
});
