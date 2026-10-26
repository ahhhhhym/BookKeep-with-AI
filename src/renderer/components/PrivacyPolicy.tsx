import type { JSX } from 'react';
import { PRIVACY_EFFECTIVE_DATE, PRIVACY_SECTIONS, PRIVACY_VERSION } from '../../shared/privacy';
import { Modal } from './Modal';

export function PrivacyPolicy({ onClose }: { onClose: () => void }): JSX.Element {
  return <Modal title="隐私政策" onClose={onClose}>
    <p className="tiny">版本 {PRIVACY_VERSION} · 生效 {PRIVACY_EFFECTIVE_DATE}</p>
    <div className="privacy-body" tabIndex={0} aria-label="隐私政策正文">
      {PRIVACY_SECTIONS.map(section => <section key={section.title}>
        <h3>{section.title}</h3>{section.paragraphs.map(text => <p key={text}>{text}</p>)}
      </section>)}
    </div>
    <div className="form-actions"><button type="button" className="button button-primary" onClick={onClose}>关闭隐私政策</button></div>
  </Modal>;
}
