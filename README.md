<div align="center">

![header](https://capsule-render.vercel.app/api?type=waving&color=gradient&customColorList=6,11,20&height=200&section=header&text=Curiosity%20Engine&fontSize=60&fontColor=fff&animation=fadeIn&fontAlignY=38&desc=ADK%20Multi-Agent%20Teaching%20Pipeline%20%2B%20MCP&descAlignY=60&descAlign=50)

<a href="https://git.io/typing-svg"><img src="https://readme-typing-svg.demolab.com?font=Fira+Code&weight=600&size=20&pause=1000&color=06B6D4&center=true&vCenter=true&width=700&lines=ADK+Multi-Agent+Pipeline+%E2%80%94+Sequential+%2B+Conversational;MCP+Server+%E2%80%94+Wikipedia+API+%2B+DuckDuckGo;SearchAgent+%7C+TeachAgent+%7C+ConversationAgent;Assess+First%2C+Teach+What+You+Don't+Know" alt="Typing SVG" /></a>

<br/>

![Google ADK](https://img.shields.io/badge/Google_ADK-1.0-4285F4?style=for-the-badge&logo=google&logoColor=white)
![MCP](https://img.shields.io/badge/MCP-FastMCP-blueviolet?style=for-the-badge)
![Gemini](https://img.shields.io/badge/gemini--3.1--flash--lite--preview-free_tier-34A853?style=for-the-badge&logo=google&logoColor=white)
![Python](https://img.shields.io/badge/Python-3.11+-3776AB?style=for-the-badge&logo=python&logoColor=white)
![React](https://img.shields.io/badge/React_+_TypeScript-61DAFB?style=for-the-badge&logo=react&logoColor=black)

</div>

---

## What Is This?

Curiosity Engine is an AI teaching agent built with **Google ADK** that grounds every lesson in real retrieved data — not hallucinated from training weights. When you enter a topic, a **SearchAgent** connects through a custom **MCP server** (stdio transport, no external service) to Wikipedia's API and DuckDuckGo, retrieves structured article summaries, section lists, and live web snippets, then passes that state to a **TeachAgent** which synthesises it into a structured Socratic overview. From there, a **ConversationAgent** handles every follow-up turn — teaching IDK concepts in depth (with inline code examples), skipping IKnow subtrees, and guiding you through a hierarchical knowledge tree built from the retrieved article structure.

The entire pipeline runs on **gemini-3.1-flash-lite-preview** — the highest daily-quota model on the free Gemini AI Studio tier (15 RPM, 500 RPD). No billing, no credit card required. A FastAPI bridge on port 8000 exposes the same REST API the React frontend already expects.

---

## MCP Integration

The MCP server (`knowledge_mcp_server/server.py`) is a **FastMCP** server running over **stdio transport**. ADK's `MCPToolset` spawns it as a subprocess — no HTTP port, no external service needed.

| Tool | Data Source | Returns |
|---|---|---|
| `search_wikipedia` | Wikipedia OpenSearch API | `{results: [{title, description, url}]}` |
| `get_article_summary` | `wikipedia-api` library | `{title, summary, sections[], url}` |
| `get_section_content` | `wikipedia-api` library | `{section, content, subsections[]}` |
| `search_web` | DuckDuckGo HTML (no API key) | `{results: [{title, snippet, url}]}` |

The SearchAgent always calls all four retrieval tools in sequence, writes a consolidated JSON object into ADK session state under the key `research`, and the TeachAgent reads that key directly — every section heading, concept bullet, and web insight in the response is grounded in retrieved data, not generated from model weights.

---

## Architecture

```
User: "Teach me binary search"
           │
           ▼
  ┌──────────────────────────────────────────────────┐
  │  SequentialAgent: curiosity_pipeline             │  ← root_agent (ADK)
  │                                                  │
  │  Stage 1 — SearchAgent                           │
  │    MCPToolset (stdio) → FastMCP server           │
  │      search_wikipedia + get_article_summary      │
  │      get_section_content + search_web            │
  │    → state["research"]  (structured JSON)        │
  │                                                  │
  │  Stage 2 — TeachAgent                            │
  │    reads state["research"]                       │
  │    → structured markdown overview (OVERVIEW,     │
  │      KEY CONCEPTS, WEB INSIGHTS, LEARNING PATH)  │
  └──────────────────────────────────────────────────┘
           │ overview sent to frontend
           ▼
  ┌──────────────────────────────────────────────────┐
  │  FastAPI bridge (server.py, port 8000)           │
  │  · Builds hierarchical knowledge tree            │
  │    (wiki_sections + key_points, 3 levels,        │
  │     beginner → intermediate → advanced)          │
  │  · DFS traversal — visit_stack drives teaching   │
  │  · Mastery tracking per node                     │
  │  · Rate limiter: token bucket (4 cap, 1/4.5s)    │
  └──────────────────────────────────────────────────┘
           │ follow-up turns
           ▼
  ┌──────────────────────────────────────────────────┐
  │  ConversationAgent (LlmAgent, ADK)               │
  │  · IDK → 500-800 word explanation + code example │
  │         + expands leaf node into 3-5 sub-topics  │
  │  · IKnow → marks subtree as skipped, advances    │
  │  · Follow-up questions → precise answers         │
  └──────────────────────────────────────────────────┘
           │
  React frontend (port 5173)
    HierarchyTreePanel · ChatInterface · KnowledgeGraph3D
```

Two LLM calls per session start (SearchAgent + TeachAgent), one call per follow-up turn. At 500 RPD that supports ~250 fresh topic sessions or ~500 follow-up exchanges per day on the free tier.

---

## Agents

| Agent | Type | Trigger | Task |
|---|---|---|---|
| **SearchAgent** | `LlmAgent` (ADK) | Every new topic | Calls MCP server tools — `search_wikipedia`, `get_article_summary`, `get_section_content`, `search_web` — returns consolidated JSON into `state["research"]` |
| **TeachAgent** | `LlmAgent` (ADK) | Every new topic | Reads `state["research"]`, synthesises into OVERVIEW / KEY CONCEPTS / WEB INSIGHTS / LEARNING PATH markdown |
| **ConversationAgent** | `LlmAgent` (ADK) | Every follow-up turn | IDK → deep 500-800 word teaching + inline code example + node expansion; IKnow → skip subtree; answers → evaluate + fill gaps |

All three agents use **gemini-3.1-flash-lite-preview** — chosen for the highest free-tier daily quota (500 RPD vs 20 RPD for gemini-2.5-flash).

---

## Rate Limits & Quota

| Metric | Limit |
|---|---|
| Requests per minute (RPM) | 15 |
| Requests per day (RPD) | 500 |
| Effective pipeline calls / new topic | 2 (SearchAgent + TeachAgent) |
| Effective calls / follow-up turn | 1 (ConversationAgent) |
| Approx. new sessions per day | ~250 |
| Approx. follow-up turns per day | ~500 |

Rate limiting is enforced server-side with a **token bucket** (capacity 4, refill rate 1 token per 4.5 s ≈ 13.3 RPM ceiling) protected by an `asyncio.Lock`. All Gemini calls go through this gate — burst requests queue instead of hitting 429. Automatic exponential backoff (15 s → 30 s → 60 s) handles transient quota errors.

---

## File Structure

```
adk_agent/
├── curiosity_agent/
│   ├── agent.py                   # SequentialAgent pipeline definition
│   ├── sub_agents/
│   │   ├── search_agent.py        # LlmAgent + MCPToolset (Wikipedia + DDG)
│   │   ├── teach_agent.py         # LlmAgent — synthesises research state
│   │   └── conversation_agent.py  # LlmAgent — all follow-up turns
│   └── prompts/                   # Tuned system instructions per agent
├── knowledge_mcp_server/
│   └── server.py                  # FastMCP — 4 tools, stdio transport
├── server.py                      # FastAPI bridge — REST API + hierarchy tree
├── main.py                        # CLI entry point
└── requirements.txt

frontend/
├── src/
│   ├── App.tsx                    # 3-panel layout
│   ├── components/
│   │   ├── ChatInterface.tsx      # Chat + IDK/IKnow buttons
│   │   ├── HierarchyTreePanel.tsx # Knowledge tree (left panel)
│   │   └── KnowledgeGraph3D.tsx   # 3D force graph (right panel)
│   └── services/api.ts            # Proxies /api → localhost:8000
└── vite.config.ts
```

---

## Getting Started

**Prerequisites:** Python 3.11+, Node 18+, and a free Gemini API key from [aistudio.google.com/app/apikey](https://aistudio.google.com/app/apikey) — no billing required.

```bash
# 1. Clone and enter the agent directory
git clone https://github.com/Huuffy/miniproject.git
cd miniproject/adk_agent

# 2. Create virtualenv and install
python -m venv venv
source venv/Scripts/activate        # Windows
# source venv/bin/activate          # macOS / Linux
pip install -r requirements.txt

# 3. Configure API key
copy .env.example .env              # then open .env and paste your key
```

**Terminal 1 — ADK bridge server**
```bash
python server.py
```

**Terminal 2 — React frontend**
```bash
cd ../frontend && npm install && npm run dev
# open http://localhost:5173
```

**Alternative — ADK Web UI**
```bash
adk web curiosity_agent
```

---

## Assignment Criteria

| Requirement | Implementation |
|---|---|
| Built with ADK | `SequentialAgent` → two `LlmAgent` instances (SearchAgent, TeachAgent); `ConversationAgent` for follow-ups |
| Uses MCP | `MCPToolset(StdioConnectionParams(...))` in SearchAgent spawns the FastMCP server over stdio |
| Retrieves structured data | `get_article_summary` → `{title, summary, sections[], url}` + `search_web` → `{results[]}` written to `state["research"]` |
| Retrieved data drives response | TeachAgent reads `state["research"]` — every bullet in KEY CONCEPTS maps to a real wiki section; WEB INSIGHTS cite retrieved snippets directly |
| Beyond minimum | Hierarchical knowledge tree with DFS traversal, dynamic node expansion on IDK, mastery tracking per node, subtree skip on IKnow, 3-panel React UI with 3D knowledge graph |

---

<div align="center">

**Built with curiosity**

![footer](https://capsule-render.vercel.app/api?type=waving&color=gradient&customColorList=6,11,20&height=120&section=footer)

</div>
