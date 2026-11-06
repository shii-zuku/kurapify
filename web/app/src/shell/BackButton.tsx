import { ChevronLeft } from 'lucide-react';
import { useLocation, useNavigate } from 'react-router';

/** Back, on every page: one step in this tab's history, and disabled when there is nowhere to go. */
export function BackButton({ className = '' }: { className?: string }) {
  const navigate = useNavigate();
  // Read on each navigation: react-router keeps the position in the history entry.
  useLocation();
  const canGoBack = ((window.history.state as { idx?: number } | null)?.idx ?? 0) > 0;
  return (
    <button
      className={`grid size-8 flex-none place-items-center rounded-full bg-quinary text-primary transition-[background-color,opacity] duration-200 [-webkit-app-region:no-drag] enabled:hover:bg-quaternary disabled:opacity-30 ${className}`}
      aria-label="Back"
      title="Back"
      disabled={!canGoBack}
      onClick={() => navigate(-1)}
    >
      <ChevronLeft size={20} strokeWidth={2.4} />
    </button>
  );
}
