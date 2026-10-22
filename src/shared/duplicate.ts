import { normalizeNameKey } from './text';
type Fields = {
    amountFen: number | null;
    occurredDate: string | null;
    name: string | null;
    merchant: string | null;
};
/** Same S11 conservative hint: this never authorizes deletion/rejection of a second real purchase. */
export function isPossibleDuplicate(p: Fields, q: Fields): boolean {
    return p.amountFen !== null && p.occurredDate !== null && p.amountFen === q.amountFen && p.occurredDate === q.occurredDate &&
        !!((p.name && q.name && normalizeNameKey(p.name) === normalizeNameKey(q.name)) || (p.merchant && q.merchant && normalizeNameKey(p.merchant) === normalizeNameKey(q.merchant)));
}
