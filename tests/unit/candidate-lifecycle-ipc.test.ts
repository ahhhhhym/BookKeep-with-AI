import {expect,it} from 'vitest';
import {randomUUID} from 'node:crypto';
import {CHANNEL_SPECS} from '../../src/shared/ipc';
import {validateIpcRequest} from '../../src/main/ipc/validate-request';
import {CONTRACT_VERSION} from '../../src/shared/constants';
it.each(['candidateDelete','candidateRestore'] as const)('%s enforces epoch, mutation, id/version and rejects source overrides',key=>{
 const epoch=randomUUID(),payload={id:randomUUID(),expectedVersion:1};
 const req={contractVersion:CONTRACT_VERSION,requestId:randomUUID(),dataEpoch:epoch,mutationId:randomUUID(),payload};
 expect(()=>validateIpcRequest(CHANNEL_SPECS[key],req,{expectedEpoch:epoch})).not.toThrow();
 for(const patch of [{dataEpoch:null},{dataEpoch:randomUUID()},{mutationId:undefined},{payload:{...payload,expectedVersion:1.5}},{payload:{...payload,reason:'unexpected'}},{payload:{...payload,ledgerId:randomUUID()}}])expect(()=>validateIpcRequest(CHANNEL_SPECS[key],{...req,...patch},{expectedEpoch:epoch})).toThrow();
 expect(CHANNEL_SPECS[key].permission).toBe('W');
});
it('deleted is a separate valid filter; five statuses are rejected',()=>{
 const epoch=randomUUID(),request={contractVersion:CONTRACT_VERSION,requestId:randomUUID(),dataEpoch:epoch,payload:{jobId:null,page:{limit:100,cursor:null},reviewStates:['deleted','rejected']}};
 expect(()=>validateIpcRequest(CHANNEL_SPECS.candidateList,request,{expectedEpoch:epoch})).not.toThrow();
 expect(()=>validateIpcRequest(CHANNEL_SPECS.candidateList,{...request,payload:{...request.payload,reviewStates:Array(5).fill('deleted')}},{expectedEpoch:epoch})).toThrow();
});
