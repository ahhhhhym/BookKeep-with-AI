import {useEffect,useState} from 'react';
import {evaluateDeepSeekBilling,type BillingTarget} from '../../shared/deepseek-billing';
import {DEEPSEEK_BILLING_RULES} from '../../shared/deepseek-billing-rules';
export function DeepSeekBillingNotice({target,active}:{target:BillingTarget;active:boolean}){
 const [decision,setDecision]=useState(()=>evaluateDeepSeekBilling(Date.now(),target,DEEPSEEK_BILLING_RULES));
 useEffect(()=>{if(!active)return;let timer:ReturnType<typeof setTimeout>;
  const refresh=()=>{clearTimeout(timer);const next=evaluateDeepSeekBilling(Date.now(),target,DEEPSEEK_BILLING_RULES);setDecision(old=>JSON.stringify(old)===JSON.stringify(next)?old:next);timer=setTimeout(refresh,Math.min(30000,Math.max(1,(next.nextCheckAt??Date.now()+30000)-Date.now())));};
  refresh();const visible=()=>{if(!document.hidden)refresh();};window.addEventListener('focus',refresh);window.addEventListener('pageshow',refresh);document.addEventListener('visibilitychange',visible);
  const stop=window.bookkeep?.windowLifecycle.onRuntimeResumed(refresh);
  return()=>{clearTimeout(timer);stop?.();window.removeEventListener('focus',refresh);window.removeEventListener('pageshow',refresh);document.removeEventListener('visibilitychange',visible);};
 },[target.provider,target.endpoint,target.model,active]);
 if(target.provider==='mock'||decision.state==='not_applicable')return null;
 return <aside hidden={decision.state==='off_peak'} data-billing-state={decision.state} className="billing-notice">
  <div role="status" aria-live="polite">{decision.state==='peak'?<p className="notice" data-tone="warn">当前处于 DeepSeek API 计费高峰时段，调用费用可能高于空闲时段，具体以官方计费为准。</p>:decision.state==='unknown'?<p className="notice">无法确认当前计费时段，请查看官方说明。</p>:null}</div>
 </aside>;
}
