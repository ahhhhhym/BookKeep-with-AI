import {expect,it} from 'vitest';
import {CloseHandshake} from '../../src/main/services/window-close-guard';
it('duplicate close shares a token; wrong epoch/request rejected; cancel and one-shot allow',()=>{
 const sent:unknown[]=[];let closed=0;
 const c=new CloseHandshake(()=> 'epoch',v=>sent.push(v),()=>closed++,()=> 'token');
 c.setReady(true);c.request();c.request();expect(sent).toHaveLength(1);
 expect(()=>c.resolve('token','wrong','allow')).toThrow();expect(closed).toBe(0);
 c.resolve('token','epoch','cancel');c.request();c.resolve('token','epoch','allow');expect(closed).toBe(1);
 expect(()=>c.resolve('token','epoch','allow')).toThrow();
});
it('cancelling or resetting an epoch invalidates only that request, not the registered owner',()=>{
 let epoch='one';const sent:unknown[]=[];const c=new CloseHandshake(()=>epoch,v=>sent.push(v),()=>{},()=>String(sent.length));
 c.setReady(true);c.request();c.reset();expect(c.request()).toBe(true);expect(sent).toHaveLength(2);
 epoch='two';c.reset();expect(c.request()).toBe(true);expect(sent).toHaveLength(3);
});
