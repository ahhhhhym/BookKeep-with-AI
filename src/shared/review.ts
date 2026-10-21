import type { Candidate, ListResult, CandidateQuery } from './imports';
import type { Proposal } from './candidate';
import type { TransactionView } from './entities';
export interface Confirmation {
  amount: boolean; date: boolean; name: boolean; category: boolean;
  confirmedVersion: number; reviewDigest: string;
}
export type EditableFields = Pick<Proposal, 'amountFen'|'occurredDate'|'occurredTime'|'timePrecision'|'name'|'merchant'|'categoryId'|'transactionKind'|'amountBasis'|'groupKey'>;
export type ReviewUpdate = { id: string; expectedVersion: number; reason: string } & (
  { action: 'edit'; patch: Partial<EditableFields> } | { action: 'reopen' } |
  { action: 'resolve_duplicate'; duplicateResolution: 'distinct'|'duplicate'; reviewDigest: string } |
  { action: 'resolve_warning'; warningCode: string; field: string|null; reviewDigest: string }
);
export interface ReviewCandidate extends Candidate {
  reviewDigest: string; blockingReasons: string[]; highRisk: boolean;
  resolvedWarnings: string[]; duplicateResolution: 'distinct'|'duplicate'|null;
  duplicateDetails: {targetId:string;name:string|null;amountFen:number|null;date:string|null;merchant:string|null;state:string}[];
}
export interface ApprovalItem { id: string; expectedVersion: number; confirmation: Confirmation }
export type ApprovalInput = ({mode:'single'} & ApprovalItem) | {mode:'preview';items:ApprovalItem[]} | {mode:'commit';previewToken:string};
export interface ApprovalResult {
  transactions: TransactionView[]; candidateIds: string[]; count: number; totalFen: string;
  alreadyApproved: boolean; replayed: boolean;
}
export interface ApprovalPreview {
  eligible: ReviewCandidate[]; excluded: {id:string;reasons:string[]}[];
  count: number; totalFen: string; previewToken: string|null;
}
export type ReviewList = ListResult<ReviewCandidate> & {counts:Record<Candidate['reviewState'],number>};
export type ReviewQuery = CandidateQuery;
