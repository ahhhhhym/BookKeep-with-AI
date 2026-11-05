import {AppError} from '../../shared/errors';
export interface CloseRequest {requestId:string;dataEpoch:string}
/** One outstanding request per owner, and a one-use permit; no timeout ever grants it. */
export class CloseHandshake {
 private ready=false;
 private acknowledged=false;
 private pending:CloseRequest|null=null;
 constructor(private epoch:()=>string,private send:(r:CloseRequest)=>void,private close:()=>void,private uuid:()=>string){}
 setReady(ready:boolean){this.ready=ready;if(ready&&this.pending)this.acknowledged=true;if(!ready)this.pending=null;}
 request():boolean{if(this.pending&&this.pending.dataEpoch!==this.epoch())this.pending=null;if(this.pending)return true;if(!this.ready)return false;this.acknowledged=false;this.pending={requestId:this.uuid(),dataEpoch:this.epoch()};this.send(this.pending);return true;}
 resolve(requestId:string,epoch:string,decision:'allow'|'cancel'){
   if(!this.pending||this.pending.requestId!==requestId||this.pending.dataEpoch!==epoch||epoch!==this.epoch())throw new AppError('STATE_CONFLICT');
   this.pending=null;if(decision==='allow')this.close();
 }
 reset(){this.pending=null;this.acknowledged=false;}
 get currentRequest(){return this.pending;}
 get awaitingResponse(){return !!this.pending&&!this.acknowledged;}
 get outstanding(){return this.pending!==null;}
}
