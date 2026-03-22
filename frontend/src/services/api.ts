/**
 * Curiosity Engine - API Service
 *
 * Handles all communication with the FastAPI backend.
 */

import type {
    ChatResponse,
    CurrentState,
    HierarchyTreeNode,
    KnowledgeGraphData,
    ProgressData,
    SessionListItem,
    SessionStatus,
    StartSessionResponse,
    TeachingPlan,
} from '../types';

const API_BASE = (import.meta.env.VITE_API_BASE_URL ?? '') + '/api';
const APP_KEY = import.meta.env.VITE_APP_SECRET_KEY ?? '';

export class RateLimitError extends Error {
    constructor() {
        super('rate_limited');
        this.name = 'RateLimitError';
    }
}

export class SessionLimitError extends Error {
    constructor() {
        super('session_limit');
        this.name = 'SessionLimitError';
    }
}

export class MessageLimitError extends Error {
    constructor() {
        super('message_limit');
        this.name = 'MessageLimitError';
    }
}

async function request<T>(path: string, options?: RequestInit): Promise<T> {
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (APP_KEY) headers['X-App-Key'] = APP_KEY;
    const res = await fetch(`${API_BASE}${path}`, {
        ...options,
        headers,
    });
    if (!res.ok) {
        if (res.status === 429) {
            const body = await res.json().catch(() => ({ detail: 'rate_limited' }));
            if (body.detail === 'session_limit') throw new SessionLimitError();
            if (body.detail === 'message_limit') throw new MessageLimitError();
            throw new RateLimitError();
        }
        const err = await res.json().catch(() => ({ detail: res.statusText }));
        throw new Error(err.detail || 'API request failed');
    }
    return res.json();
}

// ── Chat ─────────────────────────────────────────────────────────

export async function startSession(topic: string): Promise<StartSessionResponse> {
    return request('/chat/start', {
        method: 'POST',
        body: JSON.stringify({ topic }),
    });
}

export async function sendMessage(sessionId: string, answer: string): Promise<ChatResponse> {
    return request('/chat/message', {
        method: 'POST',
        body: JSON.stringify({ session_id: sessionId, answer }),
    });
}

export async function sendIDontKnow(sessionId: string): Promise<ChatResponse> {
    return request('/chat/idk', {
        method: 'POST',
        body: JSON.stringify({ session_id: sessionId }),
    });
}

export async function sendIKnowThis(sessionId: string): Promise<ChatResponse> {
    return request('/chat/iknow', {
        method: 'POST',
        body: JSON.stringify({ session_id: sessionId }),
    });
}

export async function getSessionStatus(sessionId: string): Promise<SessionStatus> {
    return request(`/chat/status/${sessionId}`);
}

export async function getChatHistory(sessionId: string): Promise<{ messages: ChatResponse['messages'] }> {
    return request(`/chat/history/${sessionId}`);
}

export async function getCurrentState(sessionId: string): Promise<CurrentState> {
    return request(`/chat/current/${sessionId}`);
}

// ── Hierarchy & Progress ────────────────────────────────────────

export async function getHierarchy(sessionId: string): Promise<HierarchyTreeNode> {
    return request(`/graph/hierarchy/${sessionId}`);
}

export async function getProgress(sessionId: string): Promise<ProgressData> {
    return request(`/graph/progress/${sessionId}`);
}

// ── Topics ───────────────────────────────────────────────────────

export async function searchTopic(topic: string) {
    return request('/topics/search', {
        method: 'POST',
        body: JSON.stringify({ topic }),
    });
}

export async function getTeachingPlan(sessionId: string): Promise<TeachingPlan> {
    return request(`/topics/plan/${sessionId}`);
}

// ── Jump to Node ────────────────────────────────────────────────

export async function jumpToNode(sessionId: string, nodeId: string): Promise<ChatResponse> {
    return request('/chat/jump', {
        method: 'POST',
        body: JSON.stringify({ session_id: sessionId, node_id: nodeId }),
    });
}

// ── Graph (legacy) ──────────────────────────────────────────────

export async function getGraphData(sessionId: string): Promise<KnowledgeGraphData> {
    return request(`/graph/nodes/${sessionId}`);
}

export async function getGraphProgress(sessionId: string) {
    return request(`/graph/progress/${sessionId}`);
}

// ── Sessions List ────────────────────────────────────────────────

export async function listSessions(): Promise<{ sessions: SessionListItem[] }> {
    return request('/chat/sessions');
}

export async function deleteSession(sessionId: string): Promise<{ deleted: string }> {
    return request(`/chat/${sessionId}`, { method: 'DELETE' });
}

// ── Quota ─────────────────────────────────────────────────────────

export interface QuotaWarning { type: string; level: string; message: string; }

export async function getQuota(): Promise<{ warnings: QuotaWarning[]; usage: Record<string, number> }> {
    return request('/quota');
}

// ── Health ───────────────────────────────────────────────────────

export async function healthCheck(): Promise<{ status: string; app: string }> {
    return request('/health');
}
