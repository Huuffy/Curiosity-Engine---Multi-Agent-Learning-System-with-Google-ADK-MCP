/**
 * Curiosity Engine - Main App
 *
 * Three-panel layout: Hierarchy Tree | Chat | 3D Knowledge Graph
 * Panels appear after a session starts.
 */

import { useState, useCallback } from 'react';
import ChatInterface from './components/ChatInterface';
import HierarchyTreePanel from './components/HierarchyTreePanel';
import KnowledgeGraph3D from './components/KnowledgeGraph3D';
import ParticlesBackground from './components/ParticlesBackground';
import { Sparkles } from 'lucide-react';
import { jumpToNode, getChatHistory } from './services/api';
import './App.css';

export default function App() {
    const [sessionId, setSessionId] = useState<string | null>(null);
    const [topic, setTopic] = useState<string>('');
    const [currentNodeId, setCurrentNodeId] = useState<string | null>(null);
    const [refreshCounter, setRefreshCounter] = useState(0);
    const [chatRefreshCounter, setChatRefreshCounter] = useState(0);

    const handleSessionStart = useCallback((sid: string, t: string) => {
        setSessionId(sid);
        setTopic(t);
    }, []);

    const triggerRefresh = useCallback(() => {
        setRefreshCounter((c) => c + 1);
    }, []);

    const handleNodeChange = useCallback((nodeId: string | null) => {
        setCurrentNodeId(nodeId);
    }, []);

    const handleGraphNodeSelect = useCallback(async (nodeId: string) => {
        if (!sessionId) return;
        try {
            await jumpToNode(sessionId, nodeId);
            setCurrentNodeId(nodeId);
            setRefreshCounter((c) => c + 1);
            setChatRefreshCounter((c) => c + 1);
        } catch {
            // ignore errors
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
                </header>

                {/* Main Content */}
                <main className={`app-main ${sessionId ? 'three-panel' : 'chat-only'}`}>
                    {/* Left Sidebar: Hierarchy Tree */}
                    {sessionId && (
                        <aside className="sidebar-left">
                            <HierarchyTreePanel
                                sessionId={sessionId}
                                currentNodeId={currentNodeId}
                                refreshTrigger={refreshCounter}
                            />
                        </aside>
                    )}

                    {/* Center: Chat */}
                    <div className={`chat-panel ${sessionId ? '' : 'full-width'}`}>
                        <ChatInterface
                            onSessionStart={handleSessionStart}
                            onGraphUpdate={triggerRefresh}
                            onNodeChange={handleNodeChange}
                            chatRefreshTrigger={chatRefreshCounter}
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
        </>
    );
}
