/** Stable ledger achievements, rule v1. Renderer receives results, never controls settlement. */
export const ACHIEVEMENT_RULE_VERSION = 1 as const;
export const ACHIEVEMENTS = [
 {id:'entry_first',name:'第一笔',metric:'entries',target:1,condition:'有效支出1笔'},
 {id:'entry_10',name:'小有积累',metric:'entries',target:10,condition:'有效支出10笔'},
 {id:'entry_100',name:'百笔成章',metric:'entries',target:100,condition:'有效支出100笔'},
 {id:'streak_3',name:'三日小成',metric:'longestStreak',target:3,condition:'连续记账3天'},
 {id:'streak_7',name:'一周坚持',metric:'longestStreak',target:7,condition:'连续记账7天'},
 {id:'streak_30',name:'月度习惯',metric:'longestStreak',target:30,condition:'连续记账30天'},
 {id:'ai_first',name:'慧眼初审',metric:'aiEntries',target:1,condition:'有效AI审核入账1笔'},
 {id:'ai_10',name:'审核有方',metric:'aiEntries',target:10,condition:'有效AI审核入账10笔'},
 {id:'backup_first',name:'有备无患',metric:'backups',target:1,condition:'首次主动备份成功'},
 {id:'backup_days_3',name:'备份习惯',metric:'backupDays',target:3,condition:'3个不同自然日主动备份成功'},
] as const;
export type AchievementId = typeof ACHIEVEMENTS[number]['id'];
export type AchievementOrigin = 'history'|'live';
export type NoticeStatus = 'pending'|'shown'|'closed'|'suppressed';
export interface AchievementProgress {
 readonly entries:number; readonly aiEntries:number; readonly activityDays:number;
 readonly currentStreak:number; readonly longestStreak:number; readonly backups:number; readonly backupDays:number;
}
export interface AchievementView {
 readonly id:AchievementId; readonly name:string; readonly condition:string; readonly conditionVersion:1;
 readonly target:number; readonly progress:number; readonly unlocked:boolean;
 readonly unlockedAt:string|null; readonly origin:AchievementOrigin|null; readonly evaluatedAt:string|null;
 readonly evidence:string|null;
}
export interface AchievementNotice {
 readonly id:string; readonly kind:'unlock'|'history_summary'; readonly achievementIds:readonly AchievementId[];
 readonly status:NoticeStatus; readonly createdAt:string; readonly stateAt:string;
}
export interface AchievementList {
 readonly ruleVersion:1; readonly ledgerId:string; readonly dataEpoch:string; readonly progress:AchievementProgress;
 readonly items:readonly AchievementView[]; readonly notices:readonly AchievementNotice[];
}
export interface NoticeConsumeInput { readonly noticeId:string; readonly state:Exclude<NoticeStatus,'pending'> }
