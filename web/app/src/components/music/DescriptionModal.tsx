import { X } from 'lucide-react';
import { useEffect, type ReactNode } from 'react';
import { createPortal } from 'react-dom';

/** Apple's "MORE" card: the title and byline, then the whole text, over a dimmed page. Escape or a click outside closes it. */
export function DescriptionModal({ title, subtitle, onClose, children }: { title: string; subtitle?: string; onClose: () => void; children: ReactNode }) {
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => event.key === 'Escape' && onClose();
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);
  return createPortal(
    <div className="fixed inset-0 z-[calc(var(--z-contextual-menus)+1)] grid animate-fade place-items-center bg-scrim p-6" onMouseDown={onClose} role="presentation">
      <div
        className="relative max-h-[min(80vh,720px)] w-[min(720px,100%)] animate-menu-in overflow-y-auto rounded-[14px] bg-thick-material p-8 shadow-[0_10px_60px_var(--glassMaterialShadowColor)] [backdrop-filter:saturate(2.2)_blur(32px)]"
        role="dialog"
        aria-modal="true"
        aria-label={title}
        onMouseDown={(event) => event.stopPropagation()}
      >
        <button className="absolute top-4 left-4 grid size-8 place-items-center rounded-full text-secondary hover:bg-quinary hover:text-primary" aria-label="Close" onClick={onClose}>
          <X size={20} />
        </button>
        <h2 className="mt-8 type-large-title-emphasized leading-[30px]">{title}</h2>
        {subtitle && <p className="mt-1 type-callout-emphasized text-secondary">{subtitle}</p>}
        <div className="mt-5 type-body-tall whitespace-pre-line text-primary">{children}</div>
      </div>
    </div>,
    document.body,
  );
}
