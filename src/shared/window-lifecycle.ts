import type {ChannelSpec} from './ipc';
import {isUuidV4} from './validation';
export const WINDOW_CHANNELS={privacyCopy:'privacy.copy',windowCloseReady:'window.closeReady',windowResolveClose:'window.resolveClose',windowBillingDocs:'window.openBillingDocs'} as const;
function spec<T>(channel:ChannelSpec['channel'],required:string[],valid:(v:Record<string,unknown>)=>boolean):ChannelSpec<T>{return {channel,permission:'U',skeletonOnly:false,request:{required,optional:[],allowNullEpoch:false,requireMutationId:false,validatePayload:v=>valid(v)?[]:[{path:'payload',code:'INVALID_WINDOW_INPUT'}],cast:v=>v as T}};}
export const WINDOW_SPECS={
 privacyCopy:spec<Record<string,never>>(WINDOW_CHANNELS.privacyCopy,[],()=>true),
 windowCloseReady:spec<{ready:boolean}>(WINDOW_CHANNELS.windowCloseReady,['ready'],v=>typeof v.ready==='boolean'),
 windowResolveClose:spec<{requestId:string;decision:'allow'|'cancel'}>(WINDOW_CHANNELS.windowResolveClose,['requestId','decision'],v=>isUuidV4(v.requestId)&&['allow','cancel'].includes(String(v.decision))),
 windowBillingDocs:spec<Record<string,never>>(WINDOW_CHANNELS.windowBillingDocs,[],()=>true),
};
