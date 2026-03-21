/**
 * Curiosity Engine - Chat Interface
 *
 * Drives the ADK multi-agent pipeline via the bridge server.
 * Supports IDK (expands sub-topics), IKnow (skip subtree), free-text answers.
 */

import { useState, useRef, useEffect, useCallback } from 'react';
import { Send, HelpCircle, CheckCircle, Loader2, Sparkles } from 'lucide-react';
import type { ChatMessage, PipelineStage, PipelineStats } from '../types';
import MarkdownMessage from './MarkdownMessage';
import BranchBreadcrumb from './BranchBreadcrumb';
import RoadmapLoading from './RoadmapLoading';
import {
    startSession,
    sendMessage,
    sendIDontKnow,
    sendIKnowThis,
    getSessionStatus,
    getChatHistory,
} from '../services/api';

interface Props {
    onSessionStart?: (sessionId: string, topic: string) => void;
    onGraphUpdate?: () => void;
    onNodeChange?: (nodeId: string | null) => void;
    chatRefreshTrigger?: number;
}

const STAGE_LABELS: Record<string, string> = {
    planning: 'ADK agents researching + building knowledge tree...',
    ready:    'Ready!',
    failed:   'Something went wrong.',
};

export default function ChatInterface({ onSessionStart, onGraphUpdate, onNodeChange, chatRefreshTrigger }: Props) {
    const [messages, setMessages] = useState<ChatMessage[]>([]);
    const [input, setInput] = useState('');
    const [topic, setTopic] = useState('');
    const [sessionId, setSessionId] = useState<string | null>(null);
    const [loading, setLoading] = useState(false);
    const [isResearching, setIsResearching] = useState(false);
    const [requiresAnswer, setRequiresAnswer] = useState(false);
    const [pipelineMsg, setPipelineMsg] = useState('');
    const [pipelinePct, setPipelinePct] = useState(0);
    const [pipelineStage, setPipelineStage] = useState<PipelineStage>('planning');
    const [pipelineStats, setPipelineStats] = useState<PipelineStats>({});
    const [currentBranch, setCurrentBranch] = useState<string[]>([]);
    const messagesEndRef = useRef<HTMLDivElement>(null);
    const pollingRef = useRef<ReturnType<typeof setInterval> | null>(null);

    const scrollToBottom = () => {
        messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    };

    useEffect(scrollToBottom, [messages]);

    useEffect(() => {
        return () => {
            if (pollingRef.current) clearInterval(pollingRef.current);
        };
    }, []);

    // Refresh chat history when chatRefreshTrigger changes (e.g. after jump)
    useEffect(() => {
        if (!sessionId || !chatRefreshTrigger) return;
        (async () => {
            try {
                const history = await getChatHistory(sessionId);
                if (history.messages && history.messages.length > 0) {
                    setMessages(history.messages);
                    setRequiresAnswer(true);
                }
            } catch {
                // ignore
            }
        })();
    }, [chatRefreshTrigger, sessionId]);

    // ── Poll status ─────────────────────────────────────────────────────────

    const startPolling = useCallback((sid: string) => {
        if (pollingRef.current) clearInterval(pollingRef.current);
        pollingRef.current = setInterval(async () => {
            try {
                const status = await getSessionStatus(sid);
                setPipelineMsg(STAGE_LABELS[status.stage] ?? status.message);
                setPipelinePct(status.progress_pct);
                setPipelineStage(status.stage as PipelineStage);
                if (status.stats) setPipelineStats(status.stats);

                if (status.stage === 'ready') {
                    clearInterval(pollingRef.current!);
                    pollingRef.current = null;
                    setIsResearching(false);
                    const history = await getChatHistory(sid);
                    if (history.messages?.length) {
                        setMessages(history.messages);
                        setRequiresAnswer(true);
                    }
                    onGraphUpdate?.();
                } else if (status.stage === 'failed') {
                    clearInterval(pollingRef.current!);
                    pollingRef.current = null;
                    setIsResearching(false);
                    setMessages([{
                        role: 'assistant',
                        content: `**Error:** ${status.message || 'Pipeline failed.'}`,
                        timestamp: new Date().toISOString(),
                    }]);
                }
            } catch {
                // transient
            }
        }, 2000);
    }, [onGraphUpdate]);

    // ── Start session ───────────────────────────────────────────────────────

    const handleStartSession = async () => {
        if (!topic.trim()) return;
        setLoading(true);
        setIsResearching(true);
        setPipelineMsg(STAGE_LABELS.planning);
        setPipelinePct(10);
        try {
            const res = await startSession(topic.trim());
            setSessionId(res.session_id);
            onSessionStart?.(res.session_id, topic);
            startPolling(res.session_id);
        } catch (err) {
            setIsResearching(false);
            setMessages([{
                role: 'assistant',
                content: `**Error:** ${err instanceof Error ? err.message : 'Failed'}. Is the server running on port 8000?`,
                timestamp: new Date().toISOString(),
            }]);
        } finally {
            setLoading(false);
        }
    };

    // ── Send message ────────────────────────────────────────────────────────

    const handleSendMessage = async () => {
        if (!sessionId || !input.trim()) return;
        const userMsg: ChatMessage = {
            role: 'user', content: input, timestamp: new Date().toISOString(),
        };
        setMessages((prev) => [...prev, userMsg]);
        setInput('');
        setLoading(true);
        setRequiresAnswer(false);
        try {
            const res = await sendMessage(sessionId, input);
            setMessages((prev) => [...prev, ...res.messages.filter((m) => m.role !== 'user')]);
            setRequiresAnswer(res.requires_answer);
            if (res.current_node_id) onNodeChange?.(res.current_node_id);
            if (res.current_branch) setCurrentBranch(res.current_branch);
            onGraphUpdate?.();
        } catch (err) {
            setMessages((prev) => [...prev, {
                role: 'assistant',
                content: `**Error:** ${err instanceof Error ? err.message : 'Failed'}`,
                timestamp: new Date().toISOString(),
            }]);
        } finally {
            setLoading(false);
        }
    };

    // ── IDK ─────────────────────────────────────────────────────────────────

    const handleIDontKnow = async () => {
        if (!sessionId) return;
        setLoading(true);
        setRequiresAnswer(false);
        setMessages((prev) => [...prev, {
            role: 'user', content: "I don't know about this yet.",
            timestamp: new Date().toISOString(),
        }]);
        try {
            const res = await sendIDontKnow(sessionId);
            setMessages((prev) => [...prev, ...res.messages]);
            setRequiresAnswer(res.requires_answer);
            if (res.current_node_id) onNodeChange?.(res.current_node_id);
            if (res.current_branch) setCurrentBranch(res.current_branch);
            onGraphUpdate?.();
        } catch (err) {
            setMessages((prev) => [...prev, {
                role: 'assistant',
                content: `**Error:** ${err instanceof Error ? err.message : 'Failed'}`,
                timestamp: new Date().toISOString(),
            }]);
        } finally {
            setLoading(false);
        }
    };

    // ── IKnow ───────────────────────────────────────────────────────────────

    const handleIKnowThis = async () => {
        if (!sessionId) return;
        setLoading(true);
        setRequiresAnswer(false);
        setMessages((prev) => [...prev, {
            role: 'user', content: 'I already know this — skip ahead.',
            timestamp: new Date().toISOString(),
        }]);
        try {
            const res = await sendIKnowThis(sessionId);
            setMessages((prev) => [...prev, ...res.messages]);
            setRequiresAnswer(res.requires_answer);
            if (res.current_node_id) onNodeChange?.(res.current_node_id);
            if (res.current_branch) setCurrentBranch(res.current_branch);
            onGraphUpdate?.();
        } catch (err) {
            setMessages((prev) => [...prev, {
                role: 'assistant',
                content: `**Error:** ${err instanceof Error ? err.message : 'Failed'}`,
                timestamp: new Date().toISOString(),
            }]);
        } finally {
            setLoading(false);
        }
    };

    // ── Render ──────────────────────────────────────────────────────────────

    return (
        <div className="chat-container">
            {/* Topic Search */}
            {!sessionId && (
                <div className="topic-search">
                    <div className="topic-search-inner">
                        <Sparkles className="topic-icon" size={28} />
                        <h1 className="topic-title">Curiosity Engine</h1>
                        <p className="topic-subtitle">
                            What do you want to learn today? Type any topic — the AI will
                            search Wikipedia and the web, build a knowledge tree, and teach
                            you adaptively.
                        </p>
                        <div className="topic-input-group">
                            <input
                                type="text"
                                id="topic-search"
                                name="topic"
                                className="topic-input"
                                placeholder='e.g. "binary search" or "photosynthesis"'
                                value={topic}
                                onChange={(e) => setTopic(e.target.value)}
                                onKeyDown={(e) => e.key === 'Enter' && handleStartSession()}
                                disabled={loading}
                            />
                            <button
                                className="topic-btn"
                                onClick={handleStartSession}
                                disabled={loading || !topic.trim()}
                            >
                                {loading ? <Loader2 className="spin" size={20} /> : <Send size={20} />}
                                <span>Start Learning</span>
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {/* Session active */}
            {sessionId && (
                <>
                    {isResearching && (
                        <RoadmapLoading
                            topic={topic}
                            stage={pipelineStage}
                            progressPct={pipelinePct}
                            message={pipelineMsg}
                            stats={pipelineStats}
                        />
                    )}

                    {!isResearching && currentBranch.length > 0 && (
                        <BranchBreadcrumb branch={currentBranch} />
                    )}

                    {!isResearching && (
                        <div className="messages-area">
                            {messages.map((msg, i) => (
                                <div key={i} className={`message message-${msg.role}`}>
                                    <div className={`bubble bubble-${msg.role}`}>
                                        <MarkdownMessage content={msg.content} role={msg.role} />
                                    </div>
                                </div>
                            ))}
                            {loading && (
                                <div className="message message-assistant">
                                    <div className="bubble bubble-assistant typing">
                                        <span className="dot" />
                                        <span className="dot" />
                                        <span className="dot" />
                                    </div>
                                </div>
                            )}
                            <div ref={messagesEndRef} />
                        </div>
                    )}

                    {!isResearching && (
                        <div className="input-area">
                            {requiresAnswer && (
                                <div className="action-buttons">
                                    <button className="idk-btn" onClick={handleIDontKnow} disabled={loading}>
                                        <HelpCircle size={16} />
                                        <span>I Don't Know</span>
                                    </button>
                                    <button className="iknow-btn" onClick={handleIKnowThis} disabled={loading}>
                                        <CheckCircle size={16} />
                                        <span>I Know This</span>
                                    </button>
                                </div>
                            )}
                            <div className="input-group">
                                <textarea
                                    id="answer-input"
                                    name="answer"
                                    className="answer-input"
                                    placeholder="Type your answer or ask a follow-up question..."
                                    value={input}
                                    onChange={(e) => setInput(e.target.value)}
                                    onKeyDown={(e) => {
                                        if (e.key === 'Enter' && !e.shiftKey && input.trim()) {
                                            e.preventDefault();
                                            handleSendMessage();
                                        }
                                    }}
                                    disabled={loading}
                                    rows={3}
                                />
                                <div className="input-footer">
                                    <span />
                                    <button
                                        className="send-btn"
                                        onClick={handleSendMessage}
                                        disabled={loading || !input.trim()}
                                    >
                                        <Send size={18} />
                                    </button>
                                </div>
                            </div>
                        </div>
                    )}
                </>
            )}
        </div>
    );
}
