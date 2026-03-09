import { create } from "zustand";

export type Toast = { id: string; kind: "success" | "info" | "error" | "warning"; msg: string; };

interface ToastState {
  toasts: Toast[];
  push: (t: Toast) => void;
  remove: (id: string) => void;
  // Backward compatibility alias
  addToast: (msg: string, kind?: Toast['kind']) => void;
  removeToast: (id: string) => void;
}

export const useToast = create<ToastState>((set) => ({
  toasts: [],
  push: (t) => {
      set((s) => ({ toasts: [...s.toasts, t].slice(-2) }));
      setTimeout(() => set((s) => ({ toasts: s.toasts.filter(x => x.id !== t.id) })), 3000);
  },
  remove: (id) => set((s) => ({ toasts: s.toasts.filter(x => x.id !== id) })),
  
  // Compatibility
  addToast: (msg, kind = 'info') => {
      const id = crypto.randomUUID();
      const t: Toast = { id, kind, msg };
      set((s) => ({ toasts: [...s.toasts, t].slice(-2) }));
      setTimeout(() => set((s) => ({ toasts: s.toasts.filter(x => x.id !== id) })), 3000);
  },
  removeToast: (id) => set((s) => ({ toasts: s.toasts.filter(x => x.id !== id) }))
}));

// Export as useToastStore for compatibility with existing imports
export const useToastStore = useToast;

export function ToastHost() {
  const { toasts, remove } = useToast();

  return (
    <div aria-live="polite" aria-atomic="true" className="toast-host" style={{
        position: 'fixed',
        bottom: '48px',
        right: '20px',
        display: 'flex',
        flexDirection: 'column',
        gap: '10px',
        zIndex: 9999,
        pointerEvents: 'none'
    }}>
      {toasts.map(t => (
        <div 
            key={t.id} 
            className={`toast ${t.kind}`} 
            onAnimationEnd={() => {}}
            style={{
                background: 'var(--bg-panel)',
                border: '1px solid var(--border-color)', 
                borderLeft: `4px solid ${getColor(t.kind)}`,
                color: 'var(--text-primary)',
                padding: '12px 16px',
                borderRadius: 'var(--radius-sm)',
                boxShadow: 'var(--shadow-elev1)',
                display: 'flex', 
                alignItems: 'center', 
                gap: '12px',
                pointerEvents: 'auto',
                minWidth: '240px',
                animation: 'slideIn 0.3s ease'
            }}
        >
            <span style={{color: getColor(t.kind)}}>{getIcon(t.kind)}</span>
            <span style={{flex: 1, fontSize: 'var(--font-size-md)'}}>{t.msg}</span>
            <button 
                onClick={() => remove(t.id)}
                style={{
                    background: 'none', 
                    border: 'none', 
                    color: 'var(--text-secondary)', 
                    cursor: 'pointer',
                    fontSize: '16px'
                }}
            >
                ×
            </button>
        </div>
      ))}
      <style>{`
        @keyframes slideIn {
            from { transform: translateX(100%); opacity: 0; }
            to { transform: translateX(0); opacity: 1; }
        }
      `}</style>
    </div>
  );
}

function getColor(kind: string) {
    switch(kind) {
        case 'success': return 'var(--brand-success, #6BE18D)';
        case 'error': return 'var(--brand-error, #FF6B6B)';
        case 'warning': return 'var(--brand-warning, #F6C945)';
        default: return 'var(--brand-primary, #7EF1C6)';
    }
}

function getIcon(kind: string) {
     switch(kind) {
        case 'success': return '✓';
        case 'error': return '!';
        case 'warning': return '⚠';
        default: return 'i';
    }
}

