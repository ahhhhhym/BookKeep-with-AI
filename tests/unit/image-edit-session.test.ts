import {expect,it} from 'vitest';
import {newImageSession,editImage,beginImageSave,finishImageSave,failImageSave,discardImage,keyboardRect} from '../../src/renderer/lib/image-edit-session';
import type {Asset} from '../../src/shared/imports';
const asset={id:'a',version:1,width:100,height:80,originalRetained:true,preparedHash:'h1'} as Asset;
it('pixel edits dirty and block old hash; failed save keeps immutable retry and draft; success rebases once',()=>{
 let s=newImageSession(asset);s=editImage(s,{crop:{x:10,y:10,width:60,height:50}});
 expect(s.dirty).toBe(true);s=beginImageSave(s,'m1');const attempt=s.attempt!;
 s=failImageSave(s);expect(s.dirty).toBe(true);expect(s.crop.width).toBe(60);
 s=beginImageSave(s,'m2');expect(s.attempt).toEqual(attempt);
 expect(editImage(s,{masks:[]})).toBe(s);
 s=finishImageSave(s,{...asset,id:'b',width:60,height:50,preparedHash:'h2'},'wrong');expect(s.dirty).toBe(true);
 s=finishImageSave(s,{...asset,id:'b',width:60,height:50,preparedHash:'h2'},'m1');expect(s.dirty).toBe(false);expect(s.crop).toEqual({x:0,y:0,width:60,height:50});expect(s.masks).toEqual([]);
});
it('discard returns saved image; retention is dirty; keyboard clamps source pixel movement and sizes',()=>{
 const initial=newImageSession(asset);expect(discardImage(editImage(initial,{retainOriginal:false}))).toEqual(initial);
 expect(keyboardRect({x:0,y:0,width:100,height:80},'ArrowRight',true,10,100,80).width).toBe(100);
 expect(keyboardRect({x:1,y:1,width:20,height:20},'ArrowLeft',false,10,100,80).x).toBe(0);
 expect(keyboardRect({x:0,y:0,width:1,height:1},'ArrowLeft',true,10,100,80).width).toBe(1);
});
