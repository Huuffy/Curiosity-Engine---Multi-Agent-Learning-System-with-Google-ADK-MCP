/**
 * Curiosity Engine - Progress Panel
 *
 * Right sidebar showing session progress stats and mastery breakdown.
 */

import { useState, useEffect, useCallback } from 'react';
import { getProgress } from '../services/api';
import type { ProgressData } from '../types';

interface Props {
    sessionId: string;
    refreshTrigger: number;
}

const STAT_CONFIG = [
    { key: 'mastered', label: 'Mastered', color: 'var(--accent-green)' },
    { key: 'partial', label: 'Partial', color: 'var(--accent-yellow)' },
    { key: 'unknown', label: 'Unknown', color: 'var(--accent-red)' },
    { key: 'skipped', label: 'Skipped', color: 'var(--text-muted)' },
    { key: 'not_covered', label: 'Remaining', color: 'var(--accent-blue)' },
] as const;

export default function ProgressPanel({ sessionId, refreshTrigger }: Props) {
    const [progress, setProgress] = useState<ProgressData | null>(null);

    const fetchProgress = useCallback(async () => {
        try {
            const data = await getProgress(sessionId);
            setProgress(data);
        } catch {
            // ignore errors during pipeline
        }
    }, [sessionId]);

    useEffect(() => {
        fetchProgress();
    }, [fetchProgress, refreshTrigger]);

    if (!progress) {
        return (
            <div className="progress-panel">
                <h3 className="panel-title">Progress</h3>
                <p className="panel-empty">Waiting for data...</p>
            </div>
        );
    }

    const pct = progress.pct_complete;
    const circumference = 2 * Math.PI * 40;
    const offset = circumference - (pct / 100) * circumference;

    return (
        <div className="progress-panel">
            <h3 className="panel-title">Progress</h3>

            {/* Circular progress */}
            <div className="progress-circle-container">
                <svg className="progress-circle" viewBox="0 0 100 100">
                    <circle
                        className="progress-circle-bg"
                        cx="50" cy="50" r="40"
                        strokeWidth="6"
                        fill="none"
                    />
                    <circle
                        className="progress-circle-fill"
                        cx="50" cy="50" r="40"
                        strokeWidth="6"
                        fill="none"
                        strokeDasharray={circumference}
                        strokeDashoffset={offset}
                        strokeLinecap="round"
                        transform="rotate(-90 50 50)"
                    />
                </svg>
                <div className="progress-circle-text">
                    <span className="progress-pct">{Math.round(pct)}%</span>
                    <span className="progress-label">complete</span>
                </div>
            </div>

            {/* Stats */}
            <div className="stats-list">
                {STAT_CONFIG.map(({ key, label, color }) => (
                    <div key={key} className="stat-row">
                        <span className="stat-dot" style={{ background: color }} />
                        <span className="stat-label">{label}</span>
                        <span className="stat-count">{progress[key]}</span>
                    </div>
                ))}
                <div className="stat-row stat-total">
                    <span className="stat-dot" style={{ background: 'var(--accent-cyan)' }} />
                    <span className="stat-label">Total</span>
                    <span className="stat-count">{progress.total}</span>
                </div>
            </div>

            {/* Current branch breadcrumb */}
            {progress.current_branch && progress.current_branch.length > 0 && (
                <div className="progress-breadcrumb">
                    <span className="breadcrumb-label">Current path:</span>
                    <span className="breadcrumb-path">
                        {progress.current_branch.join(' > ')}
                    </span>
                </div>
            )}
        </div>
    );
}
