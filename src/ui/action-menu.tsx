import React, { useEffect, useRef, useState } from 'react';

export function ActionMenu({ label, children, disabled, upward = false, compact = false }: {
  label: string; children: React.ReactNode; disabled?: boolean; upward?: boolean; compact?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (!open) return;
    const doc = root.current!.ownerDocument;
    const outside = (event: PointerEvent) => { if (!root.current?.contains(event.target as Node)) setOpen(false); };
    const blur = () => setOpen(false);
    doc.addEventListener('pointerdown', outside);
    doc.defaultView?.addEventListener('blur', blur);
    root.current?.querySelector<HTMLButtonElement>('.action-menu-panel button:not(:disabled)')?.focus();
    return () => { doc.removeEventListener('pointerdown', outside); doc.defaultView?.removeEventListener('blur', blur); };
  }, [open]);
  useEffect(() => { if (disabled) setOpen(false); }, [disabled]);
  return <div className={`action-menu${upward ? ' action-menu-up' : ''}`} ref={root}
    onBlur={event => { if (event.relatedTarget && !event.currentTarget.contains(event.relatedTarget as Node)) setOpen(false); }}
    onKeyDown={event => { if (event.key === 'Escape') { event.preventDefault(); setOpen(false); trigger.current?.focus(); } }}>
    <button ref={trigger} className={compact ? 'icon-button' : 'attachment-trigger'} aria-label={label} title={label}
      disabled={disabled} aria-expanded={open} onClick={() => setOpen(!open)}>
      <span aria-hidden="true">{compact ? '⋯' : '+'}</span>{!compact && <span className="attachment-label">添加图片</span>}
    </button>
    {open && <div className="action-menu-panel" aria-label={label} onClick={event => {
      if ((event.target as Element).closest('button')) setOpen(false);
    }}>{children}</div>}
  </div>;
}
