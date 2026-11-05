/** Offline source snapshot, checked 2026-11-04. No runtime network lookup. */
export const BILLING_DOCS_URL='https://api-docs.deepseek.com/zh-cn/quick_start/pricing/';
export const DEEPSEEK_BILLING_RULES={
 schemaVersion:1,revision:'deepseek-cn-2026-11-04',verifiedOn:'2026-11-04',sourceUrl:BILLING_DOCS_URL,timeZone:'Asia/Shanghai',
 coverage:{from:'2026-01-01',through:'2026-12-31'},expiresAt:'2027-01-01T00:00:00+08:00',
 weekdays:[1,2,3,4,5],windows:[{startMinute:540,endMinute:720},{startMinute:840,endMinute:1080}],
 officialTargets:[{endpoint:'https://api.deepseek.com/chat/completions',models:['deepseek-flash']}],
 calendar:[{year:2026,verifiedOn:'2026-11-04',
  statutorySourceUrl:'https://app.www.gov.cn/govdata/gov/202411/12/521605/article.html',
  annualSourceUrl:'https://www.beijing.gov.cn/zhengce/zhengcefagui/202511/t20251104_4258873.html',
  confirmedHolidayDates:['2026-01-01','2026-02-16','2026-02-17','2026-02-18','2026-02-19','2026-04-05','2026-05-01','2026-05-02','2026-06-19','2026-09-25','2026-10-01','2026-10-02','2026-10-03'],
  uncertainHolidayDates:['2026-01-02','2026-02-20','2026-02-23','2026-04-06','2026-05-04','2026-05-05','2026-10-05','2026-10-06','2026-10-07'],
  makeUpWorkDates:['2026-01-04','2026-02-14','2026-02-28','2026-05-09','2026-09-20','2026-10-10'],
 }],
} as const;
