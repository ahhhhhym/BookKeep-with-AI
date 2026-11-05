import {useState,type JSX} from 'react';
import { PRIVACY_TITLE, PRIVACY_EFFECTIVE_DATE, PRIVACY_SECTIONS, PRIVACY_VERSION } from '../../shared/privacy';
import {call} from '../lib/bridge';
import { Modal } from './Modal';

export function PrivacyPolicy({ onClose }: { onClose: () => void }): JSX.Element {
  const [copied,setCopied]=useState('');
  return <Modal title={PRIVACY_TITLE} onClose={onClose}>
    <p className="tiny">版本 {PRIVACY_VERSION} · {PRIVACY_EFFECTIVE_DATE?'生效 '+PRIVACY_EFFECTIVE_DATE:'0.2.0 待发行，生效日期将在发行时确定'}</p>
    <div className="privacy-body" tabIndex={0} aria-label="隐私政策正文">
      {PRIVACY_SECTIONS.map(section => <section key={section.title}>
        <h3>{section.title}</h3>{section.paragraphs.map(text => <p key={text}>{text}</p>)}
      </section>)}
    </div>
    {copied?<p role="status">{copied}</p>:null}<div className="form-actions"><button className="button" onClick={()=>void call(a=>a.privacy.copy()).then(()=>setCopied('全文已复制')).catch(()=>setCopied('复制失败，可选择正文后按Ctrl+C。'))}>复制全文</button><button type="button" className="button button-primary" onClick={onClose}>关闭隐私政策</button></div>
  </Modal>;
}
