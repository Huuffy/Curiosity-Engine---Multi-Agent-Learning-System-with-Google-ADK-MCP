/**
 * Curiosity Engine - Roadmap Loading Screen
 *
 * Animated loading screen during ADK pipeline execution.
 * Shows simulated progress as ADK agents run in background.
 */

import { useState, useEffect, useRef } from 'react';
import { Search, Brain, Network, Sparkles, CheckCircle2 } from 'lucide-react';
import type { PipelineStage, PipelineStats } from '../types';

interface Props {
    topic: string;
    stage: PipelineStage;
    progressPct: number;
    message: string;
    stats?: PipelineStats;
}

const STAGES: { key: string; label: string; icon: React.ReactNode }[] = [
    { key: 'search', label: 'Searching Wikipedia + DuckDuckGo via MCP', icon: <Search size={16} /> },
    { key: 'extract', label: 'Extracting concepts from sources', icon: <Brain size={16} /> },
    { key: 'hierarchy', label: 'Building hierarchical knowledge tree', icon: <Network size={16} /> },
    { key: 'teach', label: 'Preparing your learning roadmap', icon: <Sparkles size={16} /> },
];

function AnimatedCounter({ target, duration = 2000, suffix = '' }: { target: number; duration?: number; suffix?: string }) {
    const [count, setCount] = useState(0);
    const prevTarget = useRef(0);

    useEffect(() => {
        if (target <= 0) return;
        const start = prevTarget.current;
        const diff = target - start;
        if (diff <= 0) return;

        const startTime = Date.now();
        const timer = setInterval(() => {
            const elapsed = Date.now() - startTime;
            const progress = Math.min(elapsed / duration, 1);
            const eased = 1 - Math.pow(1 - progress, 3);
            setCount(Math.floor(start + diff * eased));
            if (progress >= 1) {
                clearInterval(timer);
                setCount(target);
                prevTarget.current = target;
            }
        }, 16);

        return () => clearInterval(timer);
    }, [target, duration]);

    return <span className="counter-value">{count.toLocaleString()}{suffix}</span>;
}

export default function RoadmapLoading({ topic, stage, progressPct, message, stats }: Props) {
    // Animate stage progression over time while pipeline runs
    const [simStage, setSimStage] = useState(0);
    const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

    useEffect(() => {
        let step = 0;
        timerRef.current = setInterval(() => {
            step++;
            if (step <= 4) setSimStage(0);
            else if (step <= 7) setSimStage(1);
            else if (step <= 9) setSimStage(2);
            else setSimStage(3);
        }, 2500);
        return () => { if (timerRef.current) clearInterval(timerRef.current); };
    }, []);

    // Use real stats from server when available
    const realStats = stats as Record<string, number> | undefined;
    const sources = realStats?.sources || realStats?.web_results || 0;
    const concepts = realStats?.concepts || 0;
    const pct = progressPct > 10 ? progressPct : Math.min(15 + simStage * 22, 88);

    return (
        <div className="roadmap-loading">
            <div className="roadmap-inner">
                {/* Pulsing brain icon */}
                <div className="roadmap-icon-wrapper">
                    <div className="roadmap-icon-pulse" />
                    <Brain className="roadmap-icon" size={48} />
                </div>

                <h1 className="roadmap-title">Building Your Knowledge Tree</h1>
                <p className="roadmap-topic">{topic}</p>

                {/* Animated counters */}
                <div className="roadmap-counters">
                    <div className="counter-card">
                        <Search size={18} className="counter-icon" />
                        <AnimatedCounter target={sources} />
                        <span className="counter-label">Sources Searched</span>
                    </div>
                    <div className="counter-card">
                        <Brain size={18} className="counter-icon" />
                        <AnimatedCounter target={concepts} suffix="+" />
                        <span className="counter-label">Concepts Found</span>
                    </div>
                </div>

                {/* Progress bar */}
                <div className="roadmap-progress">
                    <div className="roadmap-progress-bar">
                        <div className="roadmap-progress-fill" style={{ width: `${pct}%` }} />
                    </div>
                    <span className="roadmap-progress-pct">{Math.round(pct)}%</span>
                </div>

                {/* Stage checklist */}
                <div className="roadmap-stages">
                    {STAGES.map((s, i) => {
                        const isDone = i < simStage;
                        const isActive = i === simStage;
                        return (
                            <div
                                key={s.key}
                                className={`roadmap-stage ${isDone ? 'stage-done' : ''} ${isActive ? 'stage-active' : ''}`}
                            >
                                <div className="stage-icon-wrapper">
                                    {isDone ? (
                                        <CheckCircle2 size={16} className="stage-check" />
                                    ) : isActive ? (
                                        <div className="stage-spinner" />
                                    ) : (
                                        <div className="stage-dot" />
                                    )}
                                </div>
                                <span className="stage-label">{s.label}</span>
                            </div>
                        );
                    })}
                </div>

                <p className="roadmap-message">{message}</p>
            </div>
        </div>
    );
}
