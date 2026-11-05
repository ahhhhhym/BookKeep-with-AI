import {expect,it} from 'vitest';
import {PRIVACY_VERSION,PRIVACY_EFFECTIVE_DATE,PRIVACY_SECTIONS,privacyText} from '../../src/shared/privacy';
it('0.2.0 release has one actual effective date and no unreleased claims; offline disclosure remains complete',()=>{
 expect(PRIVACY_VERSION).toBe('0.2.0');expect(PRIVACY_EFFECTIVE_DATE).toBe('2026-11-05');const text=privacyText();
 for(const value of ['瀚宇铭','github.com/ahhhhhym/BookKeep-with-AI/issues','候选','恢复','快照','哈希','计费','设备',PRIVACY_EFFECTIVE_DATE!])expect(text).toContain(value);
 expect(text).not.toMatch(/0\.1\.3|0\.2\.0 待发行|生效日期待实际|发行前须更新本项/);expect(PRIVACY_SECTIONS.length).toBeGreaterThan(8);
});
