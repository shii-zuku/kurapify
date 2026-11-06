import { useToast } from '@/state/toast';

/** The line [toast] shows, floating above the player pill. */
export function Toaster() {
  const message = useToast((s) => s.message);
  const id = useToast((s) => s.id);
  if (!message) return null;
  return (
    <div
      key={id}
      className="pointer-events-none fixed bottom-[calc(var(--player-bottom-offset)+var(--player-pill-height)+16px)] left-1/2 z-[calc(var(--z-contextual-menus)+2)] -translate-x-1/2 animate-menu-in rounded-pill bg-thick-material px-4 py-2 type-callout-emphasized text-primary shadow-[0_0_0_0.5px_var(--vibrantDivider),0_10px_30px_var(--glassMaterialShadowColor)] [backdrop-filter:saturate(2.2)_blur(24px)]"
      role="status"
      aria-live="polite"
    >
      {message}
    </div>
  );
}
