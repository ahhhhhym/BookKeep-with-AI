import {expect,it} from 'vitest';
import {reviewFieldErrors} from '../../src/shared/review-validation';
import {proposal} from './db/review-fixture';
const cats=[{id:'cat_food',enabled:true}];
it('four missing fields on entry in focus order',()=>expect(reviewFieldErrors(proposal({amountFen:null,occurredDate:null,timePrecision:'unknown',name:null,categoryId:null}),cats).map(e=>e.field)).toEqual(['amountFen','occurredDate','name','categoryId']));
it.each([0,-1,1.5,1000000000])('invalid fen %s',amountFen=>expect(reviewFieldErrors(proposal({amountFen}),cats)[0]?.field).toBe('amountFen'));
it.each(['2026-02-29','1899-12-31','9999-01-01'])('invalid date %s',occurredDate=>expect(reviewFieldErrors(proposal({occurredDate}),cats)[0]?.field).toBe('occurredDate'));
it.each(['','  ','a\u0000b','a'.repeat(101)])('invalid name',name=>expect(reviewFieldErrors(proposal({name}),cats)[0]?.field).toBe('name'));
it('valid leap day and amount boundary; unavailable category and time mismatch',()=>{
 expect(reviewFieldErrors(proposal({amountFen:999999999,occurredDate:'2028-02-29'}),cats)).toEqual([]);
 expect(reviewFieldErrors(proposal(),[{id:'cat_food',enabled:false}])[0]?.field).toBe('categoryId');
 expect(reviewFieldErrors(proposal({timePrecision:'minute',occurredTime:null}),cats)[0]?.field).toBe('occurredDate');
});
