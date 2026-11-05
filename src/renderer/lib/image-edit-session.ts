import type {Asset,Rect,PrepareInput} from '../../shared/imports';
export interface ImageEditSession {asset:Asset;crop:Rect;masks:Rect[];retainOriginal:boolean;dirty:boolean;saving:boolean;failed:boolean;attempt:null|{mutationId:string;input:PrepareInput}}
export const newImageSession=(asset:Asset):ImageEditSession=>({asset,crop:{x:0,y:0,width:asset.width,height:asset.height},masks:[],retainOriginal:asset.originalRetained,dirty:false,saving:false,failed:false,attempt:null});
export function editImage(s:ImageEditSession,patch:Partial<Pick<ImageEditSession,'crop'|'masks'|'retainOriginal'>>):ImageEditSession{
 if(s.saving||s.attempt)return s;
 const next={...s,...patch};const clean=newImageSession(s.asset);
 return {...next,dirty:JSON.stringify([next.crop,next.masks,next.retainOriginal])!==JSON.stringify([clean.crop,clean.masks,clean.retainOriginal])};
}
export const beginImageSave=(s:ImageEditSession,mutationId:string):ImageEditSession=>({...s,saving:true,failed:false,attempt:s.attempt??{mutationId,input:{imageAssetId:s.asset.id,expectedVersion:s.asset.version,crop:s.crop,masks:s.masks,retainOriginal:s.retainOriginal}}});
export const finishImageSave=(s:ImageEditSession,asset:Asset,mutationId:string):ImageEditSession=>s.attempt?.mutationId===mutationId?newImageSession(asset):s;
export const failImageSave=(s:ImageEditSession):ImageEditSession=>({...s,saving:false,failed:true,dirty:true});
export const discardImage=(s:ImageEditSession):ImageEditSession=>newImageSession(s.asset);
export function keyboardRect(r:Rect,key:string,resize:boolean,step:number,width:number,height:number):Rect{
 const n={...r},dx=key==='ArrowLeft'?-step:key==='ArrowRight'?step:0,dy=key==='ArrowUp'?-step:key==='ArrowDown'?step:0;
 if(resize){n.width=Math.max(1,Math.min(width-r.x,r.width+dx));n.height=Math.max(1,Math.min(height-r.y,r.height+dy));}
 else{n.x=Math.max(0,Math.min(width-r.width,r.x+dx));n.y=Math.max(0,Math.min(height-r.height,r.y+dy));}
 return n;
}
