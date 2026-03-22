/**
 * Curiosity Engine - Main App
 *
 * Three-panel layout: Sessions/Hierarchy | Chat | 3D Knowledge Graph
 * Left panel shows all public sessions when no chat is active,
 * and the hierarchy tree when a session is open.
 */

import { useState, useCallback, useEffect, useRef } from 'react';
import ChatInterface from './components/ChatInterface';
import HierarchyTreePanel from './components/HierarchyTreePanel';
import KnowledgeGraph3D from './components/KnowledgeGraph3D';
import ParticlesBackground from './components/ParticlesBackground';
import SessionsPanel from './components/SessionsPanel';
import ToastContainer from './components/ToastContainer';
import { Sparkles, ArrowLeft } from 'lucide-react';
import { jumpToNode, getQuota } from './services/api';
import type { Toast } from './types';
import './App.css';

export default function App() {
    const [sessionId, setSessionId] = useState<string | null>(null);
    const [topic, setTopic] = useState<string>('');
    const [currentNodeId, setCurrentNodeId] = useState<string | null>(null);
    const [refreshCounter, setRefreshCounter] = useState(0);
    const [chatRefreshCounter, setChatRefreshCounter] = useState(0);
    const [toasts, setToasts] = useState<Toast[]>([]);
    const [joinRequest, setJoinRequest] = useState<{ sessionId: string; topic: string } | null>(null);
    const shownQuotaWarnings = useRef<Set<string>>(new Set());

    // ── Toast helpers ────────────────────────────────────────────────
    const addToast = useCallback((message: string, type: Toast['type']) => {
        const id = `${Date.now()}-${Math.random()}`;
        setToasts(prev => {
            const next = [...prev, { id, message, type }];
            return next.slice(-3); // max 3 toasts
        });
    }, []);

    const dismissToast = useCallback((id: string) => {
        setToasts(prev => prev.filter(t => t.id !== id));
    }, []);

    // ── Session callbacks ─────────────────────────────────────────────
    const handleSessionStart = useCallback((sid: string, t: string) => {
        setSessionId(sid);
        setTopic(t);
        setJoinRequest(null);
    }, []);

    const handleJoinSession = useCallback((sid: string, t: string) => {
        setJoinRequest({ sessionId: sid, topic: t });
        setSessionId(sid);
        setTopic(t);
        setCurrentNodeId(null);
        setChatRefreshCounter(c => c + 1);
    }, []);

    const handleBackToSessions = useCallback(() => {
        setSessionId(null);
        setTopic('');
        setJoinRequest(null);
        setCurrentNodeId(null);
    }, []);

    const handleNewChat = useCallback(() => {
        setSessionId(null);
        setTopic('');
        setJoinRequest(null);
        setCurrentNodeId(null);
    }, []);

    const handleDeleteSession = useCallback((deletedId: string) => {
        setSessionId(prev => {
            if (prev === deletedId) {
                setTopic('');
                setJoinRequest(null);
                setCurrentNodeId(null);
                return null;
            }
            return prev;
        });
    }, []);

    // ── Quota polling ─────────────────────────────────────────────────
    useEffect(() => {
        const checkQuota = async () => {
            try {
                const { warnings } = await getQuota();
                for (const w of warnings) {
                    if (!shownQuotaWarnings.current.has(w.type + w.level)) {
                        shownQuotaWarnings.current.add(w.type + w.level);
                        addToast(w.message, w.level === 'critical' ? 'error' : 'warning');
                    }
                }
            } catch {
                // ignore transient errors
            }
        };
        checkQuota();
        const interval = setInterval(checkQuota, 60_000);
        return () => clearInterval(interval);
    }, [addToast]);

    const triggerRefresh = useCallback(() => {
        setRefreshCounter(c => c + 1);
    }, []);

    const handleNodeChange = useCallback((nodeId: string | null) => {
        setCurrentNodeId(nodeId);
    }, []);

    const handleGraphNodeSelect = useCallback(async (nodeId: string) => {
        if (!sessionId) return;
        try {
            await jumpToNode(sessionId, nodeId);
            setCurrentNodeId(nodeId);
            setRefreshCounter(c => c + 1);
            setChatRefreshCounter(c => c + 1);
        } catch {
            // ignore
        }
    }, [sessionId]);

    return (
        <>
            <ParticlesBackground />

            <div className={`app-layout ${sessionId ? 'has-session' : 'minimal'}`}>
                {/* Header */}
                <header className="app-header">
                    <div className="header-left">
                        <Sparkles className="header-icon" size={22} />
                        <span className="header-title">Curiosity Engine</span>
                        {topic && <span className="header-topic">/ {topic}</span>}
                    </div>
                    {sessionId && (
                        <button
                            onClick={handleBackToSessions}
                            style={{
                                display: 'flex',
                                alignItems: 'center',
                                gap: '6px',
                                padding: '5px 12px',
                                borderRadius: '8px',
                                border: '1px solid var(--border)',
                                background: 'rgba(255,255,255,0.05)',
                                color: 'var(--text-muted)',
                                fontSize: '12px',
                                cursor: 'pointer',
                            }}
                        >
                            <ArrowLeft size={14} />
                            All Chats
                        </button>
                    )}
                </header>

                {/* Main Content */}
                <main className={`app-main ${sessionId ? 'three-panel' : 'chat-only'}`}>
                    {/* Left Sidebar */}
                    <aside className="sidebar-left">
                        {sessionId ? (
                            <HierarchyTreePanel
                                sessionId={sessionId}
                                currentNodeId={currentNodeId}
                                refreshTrigger={refreshCounter}
                            />
                        ) : (
                            <SessionsPanel
                                onJoinSession={handleJoinSession}
                                onNewChat={handleNewChat}
                                onDeleteSession={handleDeleteSession}
                            />
                        )}
                    </aside>

                    {/* Center: Chat */}
                    <div className={`chat-panel ${sessionId ? '' : 'full-width'}`}>
                        <ChatInterface
                            onSessionStart={handleSessionStart}
                            onGraphUpdate={triggerRefresh}
                            onNodeChange={handleNodeChange}
                            chatRefreshTrigger={chatRefreshCounter}
                            addToast={addToast}
                            joinRequest={joinRequest}
                        />
                    </div>

                    {/* Right Sidebar: 3D Knowledge Graph */}
                    {sessionId && (
                        <aside className="sidebar-right">
                            <KnowledgeGraph3D
                                sessionId={sessionId}
                                refreshTrigger={refreshCounter}
                                onNodeSelect={handleGraphNodeSelect}
                            />
                        </aside>
                    )}
                </main>
            </div>

            <ToastContainer toasts={toasts} onDismiss={dismissToast} />
        </>
    );
}
