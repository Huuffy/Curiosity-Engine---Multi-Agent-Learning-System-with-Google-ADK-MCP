/**
 * Curiosity Engine - Global Sessions Panel
 *
 * Left sidebar showing all public chat sessions.
 * Anyone can join any session or start a new one.
 * Polls every 8 seconds for live updates.
 */

import { useState, useEffect, useCallback } from 'react';
import { MessageSquare, Users, Plus, Clock, BookOpen, Trash2 } from 'lucide-react';
import { listSessions, deleteSession } from '../services/api';
import type { SessionListItem } from '../types';

interface Props {
    onJoinSession: (sessionId: string, topic: string) => void;
    onNewChat: () => void;
    onDeleteSession?: (sessionId: string) => void;
}

function timeAgo(iso: string): string {
    if (!iso) return '';
    const diff = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
    if (diff < 60) return `${diff}s ago`;
    if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
    if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
    return `${Math.floor(diff / 86400)}d ago`;
}

function StatusBadge({ status }: { status: string }) {
    const cfg = status === 'ready'
        ? { label: 'Active', color: 'var(--accent-green)' }
        : status === 'processing'
        ? { label: 'Loading...', color: 'var(--accent-yellow)' }
        : { label: 'Failed', color: 'var(--accent-red)' };

    return (
        <span style={{
            fontSize: '10px',
            padding: '2px 7px',
            borderRadius: '10px',
            border: `1px solid ${cfg.color}`,
            color: cfg.color,
            fontWeight: 600,
            letterSpacing: '0.03em',
        }}>
            {cfg.label}
        </span>
    );
}

export default function SessionsPanel({ onJoinSession, onNewChat, onDeleteSession }: Props) {
    const [sessions, setSessions] = useState<SessionListItem[]>([]);
    const [loading, setLoading] = useState(true);
    const [hoveredId, setHoveredId] = useState<string | null>(null);

    const handleDelete = useCallback(async (e: React.MouseEvent, sid: string) => {
        e.stopPropagation();
        setSessions(prev => prev.filter(s => s.session_id !== sid));
        try {
            await deleteSession(sid);
            onDeleteSession?.(sid);
        } catch {
            // ignore — optimistic update already removed it
        }
    }, [onDeleteSession]);

    const fetchSessions = useCallback(async () => {
        try {
            const data = await listSessions();
            setSessions(data.sessions);
        } catch {
            // ignore transient errors
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => {
        fetchSessions();
        const interval = setInterval(fetchSessions, 8000);
        return () => clearInterval(interval);
    }, [fetchSessions]);

    return (
        <div className="hierarchy-panel" style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '12px' }}>
                <h3 className="panel-title" style={{ margin: 0 }}>
                    <Users size={14} style={{ display: 'inline', marginRight: '6px', verticalAlign: 'middle' }} />
                    All Chats
                </h3>
                <button
                    onClick={onNewChat}
                    style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: '5px',
                        padding: '5px 10px',
                        borderRadius: '8px',
                        border: '1px solid var(--border)',
                        background: 'rgba(99,102,241,0.15)',
                        color: 'var(--accent-blue)',
                        fontSize: '12px',
                        fontWeight: 600,
                        cursor: 'pointer',
                    }}
                >
                    <Plus size={13} />
                    New
                </button>
            </div>

            <div className="tree-scroll" style={{ flex: 1 }}>
                {loading && (
                    <p className="panel-empty">Loading sessions...</p>
                )}
                {!loading && sessions.length === 0 && (
                    <div style={{ textAlign: 'center', padding: '24px 8px' }}>
                        <BookOpen size={28} color="var(--text-muted)" style={{ marginBottom: '8px' }} />
                        <p className="panel-empty" style={{ margin: 0 }}>No chats yet.</p>
                        <p style={{ fontSize: '11px', color: 'var(--text-muted)', marginTop: '4px' }}>
                            Start a new one!
                        </p>
                    </div>
                )}
                {sessions.map(s => (
                    <div
                        key={s.session_id}
                        style={{
                            padding: '10px 12px',
                            marginBottom: '8px',
                            borderRadius: '10px',
                            border: '1px solid var(--border)',
                            background: hoveredId === s.session_id ? 'rgba(255,255,255,0.07)' : 'rgba(255,255,255,0.03)',
                            cursor: 'pointer',
                            transition: 'background 0.15s',
                            position: 'relative',
                        }}
                        onMouseEnter={() => setHoveredId(s.session_id)}
                        onMouseLeave={() => setHoveredId(null)}
                    >
                        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: '6px', marginBottom: '6px' }}>
                            <span style={{
                                fontSize: '13px',
                                fontWeight: 600,
                                color: 'var(--text-primary)',
                                flex: 1,
                                lineHeight: '1.3',
                            }}>
                                {s.topic}
                            </span>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '6px', flexShrink: 0 }}>
                                <StatusBadge status={s.status} />
                                {hoveredId === s.session_id && (
                                    <button
                                        onClick={e => handleDelete(e, s.session_id)}
                                        title="Delete chat"
                                        style={{
                                            background: 'none',
                                            border: 'none',
                                            cursor: 'pointer',
                                            color: '#ef4444',
                                            padding: '2px',
                                            display: 'flex',
                                            alignItems: 'center',
                                            opacity: 0.8,
                                        }}
                                    >
                                        <Trash2 size={13} />
                                    </button>
                                )}
                            </div>
                        </div>

                        <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '8px' }}>
                            <span style={{ display: 'flex', alignItems: 'center', gap: '4px', fontSize: '11px', color: 'var(--text-muted)' }}>
                                <MessageSquare size={11} />
                                {s.message_count}
                            </span>
                            {s.status === 'ready' && s.progress_pct > 0 && (
                                <span style={{ fontSize: '11px', color: 'var(--text-muted)' }}>
                                    {s.progress_pct}% complete
                                </span>
                            )}
                            <span style={{ display: 'flex', alignItems: 'center', gap: '4px', fontSize: '11px', color: 'var(--text-muted)', marginLeft: 'auto' }}>
                                <Clock size={11} />
                                {timeAgo(s.created_at)}
                            </span>
                        </div>

                        {s.status === 'ready' && s.progress_pct > 0 && (
                            <div style={{
                                height: '3px',
                                borderRadius: '2px',
                                background: 'rgba(255,255,255,0.1)',
                                marginBottom: '8px',
                                overflow: 'hidden',
                            }}>
                                <div style={{
                                    height: '100%',
                                    width: `${s.progress_pct}%`,
                                    background: 'var(--accent-green)',
                                    borderRadius: '2px',
                                    transition: 'width 0.3s',
                                }} />
                            </div>
                        )}

                        <button
                            onClick={() => onJoinSession(s.session_id, s.topic)}
                            disabled={s.status === 'failed'}
                            style={{
                                width: '100%',
                                padding: '5px',
                                borderRadius: '7px',
                                border: '1px solid var(--border)',
                                background: s.status === 'failed' ? 'transparent' : 'rgba(99,102,241,0.1)',
                                color: s.status === 'failed' ? 'var(--text-muted)' : 'var(--accent-blue)',
                                fontSize: '12px',
                                fontWeight: 600,
                                cursor: s.status === 'failed' ? 'default' : 'pointer',
                            }}
                        >
                            {s.status === 'processing' ? 'Watch' : s.status === 'failed' ? 'Failed' : 'Join Chat'}
                        </button>
                    </div>
                ))}
            </div>
        </div>
    );
}
