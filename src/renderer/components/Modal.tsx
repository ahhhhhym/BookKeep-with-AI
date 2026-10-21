import { useEffect, useRef, type ReactNode, type JSX } from 'react';

/** 原生模态框提供焦点限制；禁止 Esc 假取消已经提交的写入。 */
export function Modal({ title, children, onClose, busy = false }: {
  title: string; children: ReactNode; onClose: () => void; busy?: boolean;
}): JSX.Element {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const trigger = document.activeElement as HTMLElement | null;
    ref.current?.showModal();
    return () => { ref.current?.close(); if (trigger?.isConnected) trigger.focus(); };
  }, []);
  return <dialog ref={ref} className="expense-dialog" aria-label={title}
    onCancel={(event) => { event.preventDefault(); if (!busy) onClose(); }}>
    <h2>{title}</h2>{children}
  </dialog>;
}
