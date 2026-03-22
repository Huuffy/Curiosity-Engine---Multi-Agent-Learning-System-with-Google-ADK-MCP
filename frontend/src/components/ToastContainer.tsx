/**
 * Curiosity Engine - In-App Toast Notifications
 *
 * Fixed bottom-center notification stack. No browser alerts.
 * Auto-dismisses after 6 seconds, supports manual close.
 */

import { useEffect } from 'react';
import { AlertTriangle, AlertCircle, Info, X } from 'lucide-react';
import type { Toast } from '../types';

interface Props {
    toasts: Toast[];
    onDismiss: (id: string) => void;
}

const COLORS = {
    error:   { border: '#ef4444', bg: 'rgba(239,68,68,0.12)',   icon: '#ef4444' },
    warning: { border: '#f59e0b', bg: 'rgba(245,158,11,0.12)',  icon: '#f59e0b' },
    info:    { border: '#3b82f6', bg: 'rgba(59,130,246,0.12)',  icon: '#3b82f6' },
};

function ToastItem({ toast, onDismiss }: { toast: Toast; onDismiss: (id: string) => void }) {
    useEffect(() => {
        const t = setTimeout(() => onDismiss(toast.id), 6000);
        return () => clearTimeout(t);
    }, [toast.id, onDismiss]);

    const c = COLORS[toast.type];
    const Icon = toast.type === 'error' ? AlertCircle : toast.type === 'warning' ? AlertTriangle : Info;

    return (
        <div style={{
            display: 'flex',
            alignItems: 'flex-start',
            gap: '10px',
            padding: '12px 16px',
            borderRadius: '12px',
            border: `1px solid ${c.border}`,
            background: c.bg,
            backdropFilter: 'blur(20px)',
            boxShadow: '0 4px 24px rgba(0,0,0,0.5)',
            maxWidth: '500px',
            minWidth: '300px',
            color: '#e2e8f0',
            fontSize: '13px',
            lineHeight: '1.6',
            pointerEvents: 'auto',
        }}>
            <Icon size={17} color={c.icon} style={{ flexShrink: 0, marginTop: '2px' }} />
            <span style={{ flex: 1 }}>{toast.message}</span>
            <button
                onClick={() => onDismiss(toast.id)}
                style={{
                    background: 'none',
                    border: 'none',
                    cursor: 'pointer',
                    color: '#94a3b8',
                    padding: 0,
                    flexShrink: 0,
                    marginTop: '1px',
                    display: 'flex',
                    alignItems: 'center',
                }}
            >
                <X size={15} />
            </button>
        </div>
    );
}

export default function ToastContainer({ toasts, onDismiss }: Props) {
    if (toasts.length === 0) return null;

    return (
        <div style={{
            position: 'fixed',
            bottom: '24px',
            left: '50%',
            transform: 'translateX(-50%)',
            zIndex: 9999,
            display: 'flex',
            flexDirection: 'column-reverse',
            gap: '8px',
            alignItems: 'center',
            pointerEvents: 'none',
        }}>
            {toasts.map(toast => (
                <ToastItem key={toast.id} toast={toast} onDismiss={onDismiss} />
            ))}
        </div>
    );
}
