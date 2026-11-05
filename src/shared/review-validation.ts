import {isValidAmountFen} from './amount';
import {isTransactionDate,isPrecisionConsistent} from './date';
import {checkRequiredText} from './text';
import type {EditableFields} from './review';
export type ReviewField='amountFen'|'occurredDate'|'name'|'categoryId';
export interface ReviewFieldError {field:ReviewField;code:string;message:string}
export const reviewFieldNames:Record<ReviewField,string>={amountFen:'金额',occurredDate:'日期',name:'名称',categoryId:'分类'};
/** The same domain primitives as formal ledger validation, in keyboard focus order. */
export function reviewFieldErrors(p:Pick<EditableFields,'amountFen'|'occurredDate'|'occurredTime'|'timePrecision'|'name'|'categoryId'>,categories:readonly {id:string;enabled:boolean}[]):ReviewFieldError[]{
 const errors:ReviewFieldError[]=[];
 if(!isValidAmountFen(p.amountFen))errors.push({field:'amountFen',code:'AMOUNT_INVALID',message:'请填写有效的正数金额，最多两位小数，上限9,999,999.99元。'});
 if(!isTransactionDate(p.occurredDate)||!isPrecisionConsistent(p.timePrecision,p.occurredTime))errors.push({field:'occurredDate',code:'DATE_INVALID',message:'请填写1900至9998年的有效日期，并核对时间精度。'});
 const name=checkRequiredText(p.name,100);
 if(!name.ok)errors.push({field:'name',code:name.code,message:'请填写1至100字的购买物或服务名称，不含控制字符。'});
 if(!categories.some(c=>c.id===p.categoryId&&c.enabled))errors.push({field:'categoryId',code:'CATEGORY_DISABLED',message:'请选择当前账本可用的分类。'});
 return errors;
}
