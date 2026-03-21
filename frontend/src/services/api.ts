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
    SessionStatus,
    StartSessionResponse,
    TeachingPlan,
} from '../types';

const API_BASE = '/api';

async function request<T>(path: string, options?: RequestInit): Promise<T> {
    const res = await fetch(`${API_BASE}${path}`, {
        headers: { 'Content-Type': 'application/json' },
        ...options,
    });
    if (!res.ok) {
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

// ── Health ───────────────────────────────────────────────────────

export async function healthCheck(): Promise<{ status: string; app: string }> {
    return request('/health');
}
