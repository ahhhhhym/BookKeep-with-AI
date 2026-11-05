export type StoredCandidateState='pending_review'|'rejected'|'approved';
export type CandidateReviewState=StoredCandidateState|'deleted';
export const candidateReviewState=(state:StoredCandidateState,deletedAt:string|null):CandidateReviewState=>deletedAt?'deleted':state;
