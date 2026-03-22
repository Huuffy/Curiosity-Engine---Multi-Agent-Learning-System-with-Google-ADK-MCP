/**
 * Curiosity Engine - TypeScript Types
 */

// ── Enums ────────────────────────────────────────────────────────

export type DifficultyLevel = 1 | 2 | 3;
export type ConceptType = 'THEORY' | 'TOOL' | 'PRACTICE' | 'PRINCIPLE' | 'EXAMPLE';
export type RelationType = 'REQUIRES' | 'PART_OF' | 'RELATED_TO' | 'EXAMPLE_OF' | 'IMPLEMENTS' | 'ALTERNATIVE_TO';
export type MasteryLevel = 'not_covered' | 'unknown' | 'partial' | 'mastered' | 'skipped';
export type PipelineStage = 'scraping' | 'preprocessing' | 'chunking' | 'extracting' | 'consolidating' | 'building_graph' | 'planning' | 'ready' | 'failed';
export type MessageRole = 'user' | 'system' | 'assistant';

// ── Chat ─────────────────────────────────────────────────────────

export interface ChatMessage {
  id?: string;
  role: MessageRole;
  content: string;
  timestamp: string;
  metadata?: Record<string, unknown>;
}

export interface ChatResponse {
  messages: ChatMessage[];
  session_id: string;
  current_concept?: string;
  current_node_id?: string;
  current_branch?: string[];
  is_question: boolean;
  requires_answer: boolean;
}

export interface StartSessionResponse {
  session_id: string;
  topic: string;
  status: PipelineStage;
  message: string;
}

export interface PipelineStats {
  pages_scraped?: number;
  documents_cleaned?: number;
  chunks_created?: number;
  raw_concepts?: number;
  concepts_extracted?: number;
  relationships_found?: number;
  graph_nodes?: number;
  graph_edges?: number;
  teaching_concepts?: number;
}

export interface SessionStatus {
  session_id: string;
  topic: string;
  stage: PipelineStage;
  progress_pct: number;
  message: string;
  stats?: PipelineStats;
}

// ── Hierarchy Tree ──────────────────────────────────────────────

export interface HierarchyTreeNode {
  id: string;
  name: string;
  definition: string;
  difficulty: DifficultyLevel;
  concept_type: string;
  depth: number;
  mastery: MasteryLevel;
  parent_id: string | null;
  children_ids: string[];
  times_assessed: number;
  last_score: number;
  is_current: boolean;
  children: HierarchyTreeNode[];
}

// ── Progress ────────────────────────────────────────────────────

export interface ProgressData {
  total: number;
  mastered: number;
  partial: number;
  unknown: number;
  skipped: number;
  not_covered: number;
  pct_complete: number;
  current_node_id?: string;
  current_branch?: string[];
}

// ── Current State ───────────────────────────────────────────────

export interface CurrentState {
  node_id: string | null;
  current_branch: string[];
  phase: string;
  is_complete: boolean;
}

// ── Knowledge Graph (legacy) ────────────────────────────────────

export interface KnowledgeNode {
  id: string;
  name: string;
  definition: string;
  difficulty: number;
  type: ConceptType;
  depth_level: number;
  mastery: MasteryLevel;
}

export interface KnowledgeEdge {
  source: string;
  target: string;
  relation: RelationType;
}

export interface KnowledgeGraphData {
  nodes: KnowledgeNode[];
  edges: KnowledgeEdge[];
}

// ── Sessions List ────────────────────────────────────────────────

export interface SessionListItem {
  session_id: string;
  topic: string;
  status: string;
  created_at: string;
  message_count: number;
  progress_pct: number;
}

// ── Toast Notifications ──────────────────────────────────────────

export interface Toast {
  id: string;
  message: string;
  type: 'error' | 'warning' | 'info';
}

// ── Teaching ──────────────────────────────────────────────────────

export interface TeachingPlanNode {
  concept_id: string;
  concept_name: string;
  depth_level: number;
  mastery: MasteryLevel;
  children: string[];
}

export interface TeachingPlan {
  topic: string;
  total_concepts: number;
  covered_concepts: number;
  plan: TeachingPlanNode[];
}
