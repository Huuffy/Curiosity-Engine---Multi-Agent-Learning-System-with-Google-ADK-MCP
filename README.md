<div align="center">

![header](https://capsule-render.vercel.app/api?type=waving&color=gradient&customColorList=6,11,20&height=200&section=header&text=Curiosity%20Engine&fontSize=60&fontColor=fff&animation=fadeIn&fontAlignY=38&desc=ADK%20Multi-Agent%20Socratic%20Teaching%20System&descAlignY=60&descAlign=50)

<a href="https://git.io/typing-svg"><img src="https://readme-typing-svg.demolab.com?font=Fira+Code&weight=600&size=20&pause=1000&color=06B6D4&center=true&vCenter=true&width=700&lines=Live+at+curiosity-engine-490919.web.app;ADK+Multi-Agent+Pipeline+%E2%80%94+Sequential+%2B+Conversational;MCP+Server+%E2%80%94+Wikipedia+API+%2B+DuckDuckGo;SearchAgent+%7C+TeachAgent+%7C+ConversationAgent;Deployed+on+Google+Cloud+Run+%2B+Firebase+Hosting" alt="Typing SVG" /></a>

<br/>

[![Live Demo](https://img.shields.io/badge/Live_Demo-curiosity--engine.web.app-06B6D4?style=for-the-badge&logo=firebase&logoColor=white)](https://curiosity-engine-490919.web.app)
![Google ADK](https://img.shields.io/badge/Google_ADK-1.27.2-4285F4?style=for-the-badge&logo=google&logoColor=white)
![MCP](https://img.shields.io/badge/MCP-1.26.0_FastMCP-blueviolet?style=for-the-badge)
![Gemini](https://img.shields.io/badge/Gemini_API-AI_Studio_Free_Tier-34A853?style=for-the-badge&logo=google&logoColor=white)
![Cloud Run](https://img.shields.io/badge/Cloud_Run-Docker_·_3_instances-4285F4?style=for-the-badge&logo=googlecloud&logoColor=white)
![Firestore](https://img.shields.io/badge/Firestore-REST_persistence-FF6F00?style=for-the-badge&logo=firebase&logoColor=white)
![Firebase Hosting](https://img.shields.io/badge/Firebase_Hosting-CDN-FFCA28?style=for-the-badge&logo=firebase&logoColor=black)
![React](https://img.shields.io/badge/React_+_TypeScript-61DAFB?style=for-the-badge&logo=react&logoColor=black)

</div>

---

## Live Demo

**https://curiosity-engine-490919.web.app**

Open it, type any topic ("binary search", "how vaccines work", "the French Revolution"), and the system will search Wikipedia and the web, build a knowledge hierarchy in real time, and teach you Socratically — asking what you know, skipping what you already understand, and expanding concepts you don't.

---

## What Is This?

Curiosity Engine is a fully deployed, multi-agent AI teaching system built with **Google ADK 1.27.2** and the **Gemini API** (free AI Studio key — no billing required). It teaches any topic Socratically — by first going out and retrieving real information, building a structured knowledge tree from it, then walking you through concepts from beginner to advanced, assessing what you know and skipping what you already understand.

When you enter a topic, a **SearchAgent** connects through a custom **MCP server** to Wikipedia's API and DuckDuckGo, retrieves structured article summaries, section content, and live web snippets, then passes that research into ADK session state. A **TeachAgent** synthesises it into a structured lesson grounded entirely in retrieved data. After that, a **ConversationAgent** drives every follow-up turn — teaching what you don't know in depth (with inline code examples for technical topics), expanding leaf nodes into sub-topics on IDK, and skipping entire subtrees when you already know something.

Every chat session is **persisted in Google Firestore** — so sessions survive server restarts, and anyone can browse and join ongoing chats from the public sessions panel. The backend is **containerised with Docker** and deployed on **Google Cloud Run**. The React frontend is deployed on **Firebase Hosting** for global CDN delivery. Rate limiting is handled server-side so the free Gemini quota is never exceeded, and all quota errors surface as in-app toast notifications — not browser alerts.

---

## MCP Integration

The MCP server (`knowledge_mcp_server/server.py`) is a **FastMCP 1.26.0** server running over **stdio transport**. ADK's `MCPToolset` spawns it as a subprocess inside the container — no external HTTP service, no extra API key, no extra deployment.

| Tool | Data Source | Returns |
|---|---|---|
| `search_wikipedia` | Wikipedia OpenSearch API | `{results: [{title, description, url}]}` |
| `get_article_summary` | `wikipedia-api` library | `{title, summary, sections[], url}` |
| `get_section_content` | `wikipedia-api` library | `{section, content, subsections[]}` |
| `search_web` | DuckDuckGo HTML scraping (no key) | `{results: [{title, snippet, url}]}` |

The SearchAgent always calls all four tools in sequence and writes a consolidated JSON object into ADK session state under `research`. The TeachAgent reads that key directly — every section heading, concept bullet, and web insight in the lesson is sourced from retrieved data, not generated from model weights.

> **Cloud Run compatibility fix:** Firestore's gRPC client caused MCP subprocess spawning to deadlock on Cloud Run (`fork_posix.cc` skipping fork handlers). Fixed by initialising Firestore with `prefer_rest=True`, eliminating gRPC threads from the process entirely.

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
  │    MCPToolset (stdio) → FastMCP subprocess       │
  │      search_wikipedia + get_article_summary      │
  │      get_section_content + search_web            │
  │    → state["research"]  (structured JSON)        │
  │                                                  │
  │  Stage 2 — TeachAgent                            │
  │    reads state["research"]                       │
  │    → OVERVIEW / KEY CONCEPTS / WEB INSIGHTS /    │
  │      LEARNING PATH (grounded markdown)           │
  └──────────────────────────────────────────────────┘
           │ overview stored + sent to frontend
           ▼
  ┌──────────────────────────────────────────────────┐
  │  FastAPI bridge (server.py)                      │
  │  · Builds 3-level hierarchical knowledge tree    │
  │    (wiki_sections + key_points, beginner →       │
  │     intermediate → advanced via DFS order)       │
  │  · visit_stack drives DFS traversal              │
  │  · Mastery tracking per node (5 states)          │
  │  · Token-bucket rate limiter (4 cap, 1/4.5s)    │
  │  · X-App-Key middleware — blocks direct API      │
  │    access from unknown callers                   │
  │  · Firestore AsyncClient (REST, prefer_rest=True)│
  │    saves every state change; restores on restart │
  └──────────────────────────────────────────────────┘
           │ follow-up turns
           ▼
  ┌──────────────────────────────────────────────────┐
  │  ConversationAgent (LlmAgent, ADK)               │
  │  · IDK → 500-800 word teaching + code example    │
  │         (only for technical/CS topics)           │
  │         + expands leaf into 3-5 sub-topics       │
  │  · IKnow → marks subtree skipped, advances DFS  │
  │  · Answers → evaluate understanding + fill gaps  │
  └──────────────────────────────────────────────────┘
           │
  ┌──────────────────────────────────────────────────┐
  │  Deployment                                      │
  │  Backend  → Docker → Google Cloud Run            │
  │             (max 3 instances, concurrency 10)    │
  │  Frontend → Firebase Hosting (CDN)               │
  │  Storage  → Google Firestore (sessions + history)│
  └──────────────────────────────────────────────────┘
           │
  React frontend — 3 panels
    SessionsPanel · ChatInterface · HierarchyTreePanel
```

Two Gemini API calls per new session (SearchAgent + TeachAgent), one per follow-up turn. At 1,500 RPD free tier that supports ~750 fresh sessions or ~1,500 follow-up exchanges per day.

---

## Agents

| Agent | Type | Trigger | Task |
|---|---|---|---|
| **SearchAgent** | `LlmAgent` (ADK) | Every new topic | Calls all 4 MCP tools, consolidates Wikipedia + web data into `state["research"]` |
| **TeachAgent** | `LlmAgent` (ADK) | Every new topic | Reads `state["research"]`, synthesises into structured Socratic overview with OVERVIEW / KEY CONCEPTS / WEB INSIGHTS / LEARNING PATH |
| **ConversationAgent** | `LlmAgent` (ADK) | Every follow-up turn | IDK → deep explanation + inline code (CS topics only) + node expansion; IKnow → skip subtree; answers → evaluate + continue |

All three agents call the **Gemini API** via a free **Google AI Studio** key (`gemini-3.1-flash-lite-preview`) — the highest free-tier daily quota available. No billing required, no credit card needed for the API.

---

## Rate Limits & Quota

| Metric | Limit |
|---|---|
| Requests per minute (RPM) | 15 |
| Requests per day (RPD) | 1,500 (AI Studio free tier) |
| Gemini API calls / new session | 2 (SearchAgent + TeachAgent) |
| Gemini API calls / follow-up turn | 1 (ConversationAgent) |
| Approx. new sessions per day | ~750 |
| Approx. follow-up turns per day | ~1,500 |
| Max Cloud Run instances | 3 |
| Concurrency per instance | 10 |

Rate limiting is enforced with a **token bucket** (capacity 4, refill 1 token per 4.5 s ≈ 13.3 RPM ceiling) behind an `asyncio.Lock`. All Gemini calls pass through this gate — burst requests queue rather than fail. Automatic exponential backoff (15 s → 30 s → 60 s) handles transient 429s. When all retries are exhausted, the server returns HTTP 429 and the frontend shows an **in-app amber toast notification** — no browser alerts.

**Firestore quota guard:** Daily Firestore operation counts are tracked in memory (reset at UTC midnight). At 80% of the free tier limit an amber toast is shown; at 95% all writes stop and the system degrades to in-memory only — protecting the free tier automatically.

---

## Security

| Layer | Implementation |
|---|---|
| **X-App-Key middleware** | All non-OPTIONS API requests require a secret header. 403 returned without it — blocks bots and direct backend access |
| **CORS** | Only the two Firebase Hosting domains are whitelisted — no other origins can call the API from a browser |
| **API key isolation** | `GOOGLE_API_KEY` lives only in Cloud Run environment variables — never in code or git history |
| **Instance cap** | `maxScale=3`, `concurrency=10` — limits blast radius from traffic spikes or abuse |
| **Firestore access** | Only the Cloud Run service account can read/write Firestore — no client-side database access |
| **Rate limiting** | Server-side token bucket + per-session message limits prevent quota exhaustion |

---

## Cloud Deployment

The backend is packaged as a **Docker image** (Python 3.13-slim base, built by Cloud Build) and deployed to **Google Cloud Run** (max 3 instances, concurrency 10). The Gemini API key and app secret are injected as Cloud Run environment variables. The MCP subprocess runs inside the same container — no extra services needed.

The React frontend is built with Vite (`VITE_API_BASE_URL` + `VITE_APP_SECRET_KEY` baked in at build time), then deployed to **Firebase Hosting** for global CDN delivery. CORS on the backend is configured via the `ALLOWED_ORIGINS` environment variable.

**Session persistence** is handled by **Google Firestore** (same GCP project, free tier, REST transport). Every state change — session created, hierarchy built, message sent, IDK expanded, IKnow skip — is written to Firestore asynchronously. On server startup, all `ready` sessions are loaded back from Firestore and their ADK runners recreated, so no chat history is lost across deploys or restarts.

---

## Pricing

Everything runs on free tiers. **Expected cost: $0/month** for personal or demo-scale usage.

| Service | Free Tier | Actual Usage | Cost |
|---|---|---|---|
| **Cloud Run** | 2M requests, 360K GB-seconds/month | Light — well within free tier | $0 |
| **Firestore** | 50K reads, 20K writes/day, 1GB storage | Light — quota guard prevents overrun | $0 |
| **Firebase Hosting** | 10GB storage, 360MB/day transfer | 4 files, ~1.8MB bundle | $0 |
| **Gemini API** | 1,500 req/day (Google AI Studio key) | Personal use — within free tier | $0 |
| **Cloud Build** | 120 min/day | ~5–10 min per deploy | $0 |
| **Artifact Registry** | 0.5GB free | One Docker image | $0 |

Costs only kick in if Gemini exceeds 1,500 requests/day (Flash Lite: ~$0.075 per 1M input tokens) or Cloud Run exceeds 2M requests/month. Set a $5 budget alert to be safe:

```bash
gcloud billing budgets create ^
  --billing-account=$(gcloud billing accounts list --format="value(name)") ^
  --display-name="Curiosity Engine Budget" ^
  --budget-amount=5USD ^
  --threshold-rule=percent=50 ^
  --threshold-rule=percent=100
```

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
├── server.py                      # FastAPI bridge — hierarchy, DFS, Firestore, rate gate, X-App-Key
├── Dockerfile                     # python:3.13-slim, uvicorn entry point
└── requirements.txt               # Pinned exact versions (ADK 1.27.2, MCP 1.26.0)

frontend/
├── src/
│   ├── App.tsx                    # 3-panel layout + toast state + quota polling
│   ├── components/
│   │   ├── ChatInterface.tsx      # Chat, IDK/IKnow, rate-limit toast handler
│   │   ├── SessionsPanel.tsx      # Public sessions browser + delete button
│   │   ├── HierarchyTreePanel.tsx # Knowledge tree (left panel, active session)
│   │   ├── KnowledgeGraph3D.tsx   # 3D force graph (right panel)
│   │   └── ToastContainer.tsx     # Fixed bottom-centre in-app notifications
│   └── services/api.ts            # Typed API client — X-App-Key header on all requests
└── vite.config.ts
```

---

## Getting Started Locally

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
copy .env.example .env              # open .env and paste your Gemini key

# 4. Authenticate for Firestore (local dev only)
gcloud auth application-default login
```

**Terminal 1 — Backend**
```bash
cd adk_agent
python server.py
```

**Terminal 2 — Frontend**
```bash
cd frontend && npm install && npm run dev
# open http://localhost:5173
```

---

## Updating the Deployment

### Backend changes (any file under `adk_agent/`)

```bash
# 1. Deploy new Docker image to Cloud Run
gcloud run deploy curiosity-engine ^
  --source adk_agent ^
  --region us-central1 ^
  --project curiosity-engine-490919 ^
  --allow-unauthenticated

# 2. Re-apply env vars (deploy resets them)
gcloud run services update curiosity-engine ^
  --env-vars-file env.yaml ^
  --region us-central1 ^
  --project curiosity-engine-490919
```

### Frontend changes (any file under `frontend/src/`)

```bash
cd frontend
npm run build
firebase deploy --only hosting --project curiosity-engine-490919
```

> `env.yaml` (contains API keys) and `frontend/.env.production` (contains the app secret + backend URL) are gitignored. Keep local copies — you need them for every deploy.

---

## Assignment Criteria

| Requirement | Implementation |
|---|---|
| Built with ADK | `SequentialAgent` → `SearchAgent` + `TeachAgent`; `ConversationAgent` for all follow-up turns |
| Uses MCP | `MCPToolset(StdioConnectionParams(...))` spawns FastMCP 1.26.0 server over stdio; 4 retrieval tools |
| Retrieves structured data | `get_article_summary` → `{title, summary, sections[], url}` + `search_web` → `{results[]}` written to `state["research"]` |
| Retrieved data drives response | TeachAgent reads `state["research"]` — every KEY CONCEPT maps to a real wiki section; WEB INSIGHTS cite retrieved snippets |
| Beyond minimum | Hierarchical knowledge tree, DFS traversal, dynamic node expansion on IDK, subtree mastery cascade, Firestore persistence (REST transport), Docker + Cloud Run (max 3 instances), Firebase Hosting CDN, public session browser with delete, in-app quota notifications, X-App-Key security middleware, gRPC fork fix for Cloud Run compatibility |

---

<div align="center">

**Built with curiosity**

![footer](https://capsule-render.vercel.app/api?type=waving&color=gradient&customColorList=6,11,20&height=120&section=footer)

</div>
