import { useEffect, useRef, type MouseEvent, type ReactNode, type JSX } from 'react';

/** 原生模态框提供焦点限制；禁止 Esc 或遮罩点击 假取消已经提交的写入。 */
export function Modal({ title, children, onClose, busy = false, motion }: {
  title: string; children: ReactNode; onClose: () => void; busy?: boolean; motion?: 'expense';
}): JSX.Element {
  const ref = useRef<HTMLDialogElement>(null);
  const backdropPressed = useRef(false);
  const isBackdrop = (event: MouseEvent<HTMLDialogElement>): boolean => {
    if (event.target !== event.currentTarget) return false;
    const { left, right, top, bottom } = event.currentTarget.getBoundingClientRect();
    return event.clientX < left || event.clientX >= right || event.clientY < top || event.clientY >= bottom;
  };
  useEffect(() => {
    const trigger = document.activeElement as HTMLElement | null;
    const dialog = ref.current;
    dialog?.showModal();
    return () => { dialog?.close(); if (trigger?.isConnected) trigger.focus(); };
  }, []);
  return <dialog ref={ref} className="expense-dialog" data-motion={motion} aria-label={title}
    onCancel={(event) => { event.preventDefault(); if (!busy) onClose(); }}
    onPointerDown={(event) => { backdropPressed.current = event.button === 0 && isBackdrop(event); }}
    onPointerCancel={() => { backdropPressed.current = false; }}
    onClick={(event) => {
      const pressed = backdropPressed.current;
      backdropPressed.current = false;
      if (pressed && !busy && isBackdrop(event)) onClose();
    }}>
    <div className="modal-header">
      <h2>{title}</h2>
      {!busy ? <button type="button" className="modal-close" aria-label="关闭窗口" onClick={onClose}>×</button> : null}
    </div>
    {children}
  </dialog>;
}
