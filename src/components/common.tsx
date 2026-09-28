import { useEffect, useId, useRef, type ButtonHTMLAttributes, type PropsWithChildren, type ReactNode } from 'react';

export function Button({ children, kind = 'default', ...props }: PropsWithChildren<ButtonHTMLAttributes<HTMLButtonElement> & { kind?: 'default' | 'primary' | 'success' | 'danger' | 'ghost' }>) {
  return <button className={`btn btn-${kind}`} {...props}>{children}</button>;
}

export function Badge({ children, tone = 'neutral' }: PropsWithChildren<{ tone?: 'neutral' | 'success' | 'warning' | 'danger' | 'info' }>) {
  return <span className={`badge badge-${tone}`}>{children}</span>;
}

export function Card({ title, action, children, className = '' }: PropsWithChildren<{ title?: ReactNode; action?: ReactNode; className?: string }>) {
  return <section className={`card ${className}`}>{(title || action) && <header className="card-head"><div>{title}</div><div>{action}</div></header>}<div className="card-body">{children}</div></section>;
}

export function Modal({ title, children, onClose, wide = false }: PropsWithChildren<{ title: ReactNode; onClose: () => void; wide?: boolean }>) {
  const titleId = useId();
  const dialogRef = useRef<HTMLDivElement>(null);
  const previouslyFocused = useRef<HTMLElement | null>(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useEffect(() => {
    previouslyFocused.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const dialog = dialogRef.current;
    const focusables = () => Array.from(dialog?.querySelectorAll<HTMLElement>('button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [href], [tabindex]:not([tabindex="-1"])') || []);
    (focusables()[0] || dialog)?.focus();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { event.preventDefault(); onCloseRef.current(); return; }
      if (event.key !== 'Tab') return;
      const items = focusables();
      if (!items.length) { event.preventDefault(); dialog?.focus(); return; }
      const first = items[0], last = items[items.length - 1];
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    };
    document.addEventListener('keydown', onKeyDown);
    return () => { document.removeEventListener('keydown', onKeyDown); previouslyFocused.current?.focus(); };
  }, []);

  return <div className="modal-backdrop" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
    <div ref={dialogRef} role="dialog" aria-modal="true" aria-labelledby={titleId} tabIndex={-1} className={`modal ${wide ? 'modal-wide' : ''}`}>
      <header className="modal-head"><h2 id={titleId}>{title}</h2><button className="icon-btn" onClick={onClose} aria-label="Затвори диалога">×</button></header>
      <div className="modal-body">{children}</div>
    </div>
  </div>;
}

export function Field({ label, children, hint }: PropsWithChildren<{ label: string; hint?: string }>) {
  return <label className="field"><span className="field-label">{label}</span>{children}{hint && <small>{hint}</small>}</label>;
}
export function Empty({ children = 'Няма данни.' }: PropsWithChildren) { return <div className="empty">{children}</div>; }
export function CodeView({ text, placeholder = 'Няма генерирано съдържание.' }: { text: string; placeholder?: string }) { return <pre className="code-view">{text || placeholder}</pre>; }

// ComboField: free-text input with a suggestion dropdown (native <datalist>).
// Same contract as a plain input — any typed value passes; the dropdown only suggests.
export function ComboField({ label, value, onChange, options, placeholder, hint }: { label: string; value: string; onChange: (v: string) => void; options: import('../refs').ComboOptions; placeholder?: string; hint?: string }) {
  const listId = useId();
  return (
    <Field label={label} hint={hint}>
      <input list={listId} value={value} placeholder={placeholder} onChange={(e) => onChange(e.target.value)} autoComplete="off" />
      <datalist id={listId}>{options.map(([v, l]) => <option key={v} value={v}>{l === v ? v : `${v} — ${l}`}</option>)}</datalist>
    </Field>
  );
}
