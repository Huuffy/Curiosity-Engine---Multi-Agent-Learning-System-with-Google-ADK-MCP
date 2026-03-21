/**
 * Curiosity Engine - 3D Knowledge Graph
 *
 * Interactive 3D force-directed graph using react-force-graph-3d.
 * Nodes are glowing spheres, color-coded by mastery level.
 * Designed to fit in the right sidebar panel.
 */

import { useRef, useCallback, useEffect, useState } from 'react';
import ForceGraph3D from 'react-force-graph-3d';
import type { KnowledgeNode, KnowledgeEdge, MasteryLevel } from '../types';
import { getGraphData } from '../services/api';

interface Props {
    sessionId: string | null;
    refreshTrigger?: number;
    onNodeSelect?: (nodeId: string) => void;
}

interface GraphNode {
    id: string;
    name: string;
    definition: string;
    mastery: MasteryLevel;
    depth_level: number;
    val: number; // size
    color: string;
}

interface GraphLink {
    source: string;
    target: string;
    relation: string;
}

const MASTERY_COLORS: Record<MasteryLevel, string> = {
    mastered: '#22c55e',    // green
    partial: '#eab308',     // yellow
    unknown: '#ef4444',     // red
    not_covered: '#3b82f6', // blue
    skipped: '#64748b',     // gray
};

function mapNodes(nodes: KnowledgeNode[]): GraphNode[] {
    return nodes.map((n) => ({
        id: n.id,
        name: n.name,
        definition: n.definition,
        mastery: n.mastery,
        depth_level: n.depth_level,
        val: Math.max(3, 10 - n.depth_level * 2), // bigger = higher level
        color: MASTERY_COLORS[n.mastery] || '#3b82f6',
    }));
}

function mapEdges(edges: KnowledgeEdge[]): GraphLink[] {
    return edges.map((e) => ({
        source: e.source,
        target: e.target,
        relation: e.relation,
    }));
}

export default function KnowledgeGraph3D({ sessionId, refreshTrigger, onNodeSelect }: Props) {
    const fgRef = useRef<any>(null);
    const containerRef = useRef<HTMLDivElement>(null);
    const [graphData, setGraphData] = useState<{ nodes: GraphNode[]; links: GraphLink[] }>({
        nodes: [],
        links: [],
    });
    const [selectedNode, setSelectedNode] = useState<GraphNode | null>(null);
    const [dimensions, setDimensions] = useState({ width: 300, height: 400 });

    // Fetch graph data
    useEffect(() => {
        if (!sessionId) return;
        (async () => {
            try {
                const data = await getGraphData(sessionId);
                setGraphData({
                    nodes: mapNodes(data.nodes),
                    links: mapEdges(data.edges),
                });
            } catch {
                // Graph not ready yet -- show empty
            }
        })();
    }, [sessionId, refreshTrigger]);

    // Resize handling
    useEffect(() => {
        const container = containerRef.current;
        if (!container) return;
        const observer = new ResizeObserver((entries) => {
            for (const entry of entries) {
                setDimensions({
                    width: entry.contentRect.width,
                    height: entry.contentRect.height,
                });
            }
        });
        observer.observe(container);
        return () => observer.disconnect();
    }, []);

    const handleNodeClick = useCallback((node: any) => {
        setSelectedNode(node as GraphNode);
        // Camera focus on clicked node
        if (fgRef.current) {
            const distance = 120;
            const distRatio = 1 + distance / Math.hypot(node.x, node.y, node.z);
            fgRef.current.cameraPosition(
                { x: node.x * distRatio, y: node.y * distRatio, z: node.z * distRatio },
                { x: node.x, y: node.y, z: node.z },
                1000,
            );
        }
    }, []);

    const handleFocusNode = useCallback(() => {
        if (selectedNode && onNodeSelect) {
            onNodeSelect(selectedNode.id);
            setSelectedNode(null);
        }
    }, [selectedNode, onNodeSelect]);

    if (!sessionId) {
        return (
            <div className="graph-empty">
                <p>Start a learning session to see your knowledge graph</p>
            </div>
        );
    }

    return (
        <div className="graph-content">
            <div className="graph-header">
                <h3>Knowledge Graph</h3>
                <div className="graph-legend">
                    <span className="legend-item"><span className="legend-dot" style={{ background: '#22c55e' }}></span>Mastered</span>
                    <span className="legend-item"><span className="legend-dot" style={{ background: '#eab308' }}></span>Partial</span>
                    <span className="legend-item"><span className="legend-dot" style={{ background: '#ef4444' }}></span>Unknown</span>
                    <span className="legend-item"><span className="legend-dot" style={{ background: '#3b82f6' }}></span>Not Covered</span>
                    <span className="legend-item"><span className="legend-dot" style={{ background: '#64748b' }}></span>Skipped</span>
                </div>
            </div>

            <div className="graph-canvas-wrapper" ref={containerRef}>
                {graphData.nodes.length > 0 ? (
                    <ForceGraph3D
                        ref={fgRef}
                        graphData={graphData}
                        width={dimensions.width}
                        height={dimensions.height}
                        backgroundColor="rgba(0,0,0,0)"
                        nodeLabel={(node: any) => `<div style="background:rgba(0,0,0,0.8);padding:6px 10px;border-radius:6px;color:white;font-size:11px;max-width:180px"><strong>${node.name}</strong><br/><small>${node.definition || ''}</small></div>`}
                        nodeColor={(node: any) => node.color}
                        nodeOpacity={0.9}
                        linkColor={() => 'rgba(100,150,255,0.3)'}
                        linkWidth={1}
                        linkDirectionalParticles={2}
                        linkDirectionalParticleWidth={2}
                        linkDirectionalParticleColor={() => '#00f5ff'}
                        onNodeClick={handleNodeClick}
                        enableNavigationControls
                        showNavInfo={false}
                    />
                ) : (
                    <div className="graph-empty-inner">
                        <p>Building knowledge graph...</p>
                    </div>
                )}
            </div>

            {selectedNode && (
                <div className="node-detail-panel">
                    <div className="node-detail-header">
                        <h4>{selectedNode.name}</h4>
                        <button className="close-detail" onClick={() => setSelectedNode(null)}>x</button>
                    </div>
                    <p className="node-detail-def">{selectedNode.definition}</p>
                    <div className="node-detail-meta">
                        <span className={`mastery-badge mastery-${selectedNode.mastery}`}>
                            {selectedNode.mastery.replace('_', ' ')}
                        </span>
                        <span className="node-depth">Depth: {selectedNode.depth_level}</span>
                    </div>
                    {onNodeSelect && (
                        <button className="focus-node-btn" onClick={handleFocusNode}>
                            Focus on this
                        </button>
                    )}
                </div>
            )}
        </div>
    );
}
