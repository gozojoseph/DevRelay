import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react';
import { AlertTriangle, CheckCircle2, Info, X } from 'lucide-react';

type Tone = 'success' | 'error' | 'info';
interface Item { id: number; message: string; tone: Tone }
interface ToastValue { toast: (message: string, tone?: Tone) => void }
const ToastContext = createContext<ToastValue | null>(null);

const icons = { success: CheckCircle2, error: AlertTriangle, info: Info };
const tones = {
  success: 'text-brand-700 dark:text-brand-300',
  error: 'text-rose-600 dark:text-rose-400',
  info: 'text-sky-600 dark:text-sky-400',
};

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<Item[]>([]);
  const remove = useCallback((id: number) => setItems(current => current.filter(item => item.id !== id)), []);
  const toast = useCallback((message: string, tone: Tone = 'info') => {
    const id = Date.now() + Math.floor(Math.random() * 1000);
    setItems(current => [...current.slice(-3), { id, message, tone }]);
    window.setTimeout(() => remove(id), 5200);
  }, [remove]);
  const value = useMemo(() => ({ toast }), [toast]);
  return (
    <ToastContext.Provider value={value}>
      {children}
      <div className="pointer-events-none fixed inset-x-0 bottom-4 z-[100] flex flex-col items-center gap-2 px-4 sm:bottom-6" aria-live="polite">
        {items.map(item => {
          const Icon = icons[item.tone];
          return (
            <div key={item.id} className="pointer-events-auto flex w-full max-w-md animate-slide-up items-start gap-3 rounded-xl border border-line bg-surface px-4 py-3 shadow-lift">
              <Icon className={`mt-0.5 h-5 w-5 shrink-0 ${tones[item.tone]}`} />
              <p className="flex-1 text-sm leading-5 text-ink">{item.message}</p>
              <button type="button" onClick={() => remove(item.id)} className="rounded-md p-1 text-muted hover:bg-elevated hover:text-ink" aria-label="Dismiss notification">
                <X className="h-4 w-4" />
              </button>
            </div>
          );
        })}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast() {
  const value = useContext(ToastContext);
  if (!value) throw new Error('useToast must be used inside ToastProvider');
  return value;
}
