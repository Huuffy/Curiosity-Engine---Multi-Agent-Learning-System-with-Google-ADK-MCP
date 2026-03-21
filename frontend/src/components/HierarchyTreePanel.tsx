/**
 * Curiosity Engine - Hierarchy Tree Panel
 *
 * Left sidebar showing a collapsible tree view of the concept hierarchy.
 * Color-coded by mastery level, highlights the current concept.
 * Includes compact progress summary at the bottom.
 */

import { useState, useEffect, useRef, useCallback } from 'react';
import { ChevronRight } from 'lucide-react';
import { getHierarchy, getProgress } from '../services/api';
import type { HierarchyTreeNode, MasteryLevel, ProgressData } from '../types';

interface Props {
    sessionId: string;
    currentNodeId: string | null;
    refreshTrigger: number;
}

const MASTERY_COLORS: Record<MasteryLevel, string> = {
    mastered: 'var(--accent-green)',
    partial: 'var(--accent-yellow)',
    unknown: 'var(--accent-red)',
    not_covered: 'var(--accent-blue)',
    skipped: 'var(--text-muted)',
};

function TreeNode({
    node,
    depth,
    currentNodeId,
}: {
    node: HierarchyTreeNode;
    depth: number;
    currentNodeId: string | null;
}) {
    const [expanded, setExpanded] = useState(depth < 2);
    const hasChildren = node.children && node.children.length > 0;
    const isCurrent = node.id === currentNodeId;
    const nodeRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        if (isCurrent && nodeRef.current) {
            nodeRef.current.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
        }
    }, [isCurrent]);

    // Auto-expand parent of current node
    useEffect(() => {
        if (currentNodeId && hasChildren) {
            const hasCurrent = findNodeInTree(node, currentNodeId);
            if (hasCurrent) setExpanded(true);
        }
    }, [currentNodeId, node, hasChildren]);

    const isCategory = depth === 0 && hasChildren;

    return (
        <div className="tree-node">
            <div
                ref={nodeRef}
                className={`tree-node-row ${isCurrent ? 'tree-node-current' : ''} ${node.mastery === 'skipped' ? 'tree-node-skipped' : ''} ${isCategory ? 'tree-node-category' : ''}`}
                style={{ paddingLeft: `${depth * 18 + 8}px` }}
                onClick={() => hasChildren && setExpanded(!expanded)}
            >
                {hasChildren ? (
                    <ChevronRight
                        className={`tree-chevron ${expanded ? 'tree-chevron-expanded' : ''}`}
                        size={14}
                    />
                ) : (
                    <span className="tree-chevron-spacer" />
                )}
                {!isCategory && (
                    <span
                        className="mastery-dot"
                        style={{ background: MASTERY_COLORS[node.mastery] }}
                    />
                )}
                <span className={`tree-node-name ${isCategory ? 'tree-category-name' : ''}`}>{node.name}</span>
                {isCategory && (
                    <span className="category-count">{node.children?.length || 0}</span>
                )}
                {node.mastery === 'skipped' && !isCategory && (
                    <span className="skip-badge">skipped</span>
                )}
            </div>
            {expanded && hasChildren && (
                <div className="tree-node-children">
                    {node.children.map((child) => (
                        <TreeNode
                            key={child.id}
                            node={child}
                            depth={depth + 1}
                            currentNodeId={currentNodeId}
                        />
                    ))}
                </div>
            )}
        </div>
    );
}

function findNodeInTree(node: HierarchyTreeNode, targetId: string): boolean {
    if (node.id === targetId) return true;
    return node.children?.some((c) => findNodeInTree(c, targetId)) ?? false;
}

export default function HierarchyTreePanel({ sessionId, currentNodeId, refreshTrigger }: Props) {
    const [tree, setTree] = useState<HierarchyTreeNode | null>(null);
    const [progress, setProgress] = useState<ProgressData | null>(null);

    const fetchTree = useCallback(async () => {
        try {
            const data = await getHierarchy(sessionId);
            if (data && data.id) setTree(data);
        } catch {
            // ignore fetch errors during pipeline
        }
    }, [sessionId]);

    const fetchProgress = useCallback(async () => {
        try {
            const data = await getProgress(sessionId);
            setProgress(data);
        } catch {
            // ignore
        }
    }, [sessionId]);

    useEffect(() => {
        fetchTree();
        fetchProgress();
    }, [fetchTree, fetchProgress, refreshTrigger]);

    const covered = progress ? progress.mastered + progress.skipped + progress.partial + progress.unknown : 0;
    const total = progress ? progress.total : 0;
    const pct = total > 0 ? Math.round((covered / total) * 100) : 0;

    if (!tree) {
        return (
            <div className="hierarchy-panel">
                <h3 className="panel-title">Learning Path</h3>
                <p className="panel-empty">Building hierarchy...</p>
            </div>
        );
    }

    return (
        <div className="hierarchy-panel">
            <h3 className="panel-title">Learning Path</h3>
            <div className="tree-scroll">
                {tree.children && tree.children.length > 0 ? (
                    tree.children.map((child) => (
                        <TreeNode
                            key={child.id}
                            node={child}
                            depth={0}
                            currentNodeId={currentNodeId}
                        />
                    ))
                ) : (
                    <p className="panel-empty">No concepts yet</p>
                )}
            </div>
            {progress && total > 0 && (
                <div className="tree-progress-summary">
                    <div className="tree-progress-bar-wrapper">
                        <div className="tree-progress-bar">
                            <div
                                className="tree-progress-fill"
                                style={{ width: `${pct}%` }}
                            />
                        </div>
                    </div>
                    <span className="tree-progress-text">
                        {covered}/{total} concepts covered ({pct}%)
                    </span>
                </div>
            )}
        </div>
    );
}
