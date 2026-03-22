"""
Curiosity Engine — FastAPI bridge server (port 8000)

Builds a hierarchical knowledge tree from Wikipedia section data retrieved via
MCP. When a user clicks "I Don't Know" on a leaf node, the system dynamically
expands it into 3-5 sub-concepts via Gemini, adds them to the tree, and
traverses depth-first — assessing before teaching.

Implements the full graph lifecycle:
  - Build hierarchy from wiki_sections + key_points after ADK pipeline
  - DFS traversal via visit_stack (children pushed to front)
  - Dynamic expansion of leaf nodes on IDK
  - Subtree mastery cascade on IKnow
  - Review queue for partially understood concepts
"""

import asyncio
import json
import os
import re
import time
import uuid
from contextlib import asynccontextmanager
from datetime import date, datetime, timezone

from dotenv import load_dotenv
from fastapi import FastAPI, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from starlette.middleware.base import BaseHTTPMiddleware
from starlette.responses import JSONResponse
from google.adk.runners import Runner
from google.adk.sessions import InMemorySessionService
from google.genai import types as genai_types
from pydantic import BaseModel
import google.genai as genai

load_dotenv()

from curiosity_agent import root_agent
from curiosity_agent.sub_agents.conversation_agent import conversation_agent

_MODEL = os.getenv("GEMINI_MODEL", "gemini-3.1-flash-lite-preview")
_client = genai.Client()

# ── Firestore persistence ──────────────────────────────────────────────────────

_db = None
if os.getenv("FIRESTORE_DISABLED", "").lower() != "true":
    try:
        from google.cloud import firestore as _fs
        _db = _fs.AsyncClient(prefer_rest=True)
    except Exception as _e:
        print(f"[Firestore] Not available: {_e}. Running in-memory only.")


# ── Firestore quota tracker ────────────────────────────────────────────────────

_fs_quota: dict = {"day": None, "reads": 0, "writes": 0, "deletes": 0}
_FS_LIMITS = {"reads": 50000, "writes": 20000, "deletes": 20000}
_FS_WARN  = 0.80   # 80%  → warning toast
_FS_BLOCK = 0.95   # 95%  → stop writing to protect free tier


def _fs_check(op: str) -> str:
    """Increment daily counter for op. Returns 'ok', 'warn', or 'block'."""
    today = date.today().isoformat()
    if _fs_quota["day"] != today:
        _fs_quota.update({"day": today, "reads": 0, "writes": 0, "deletes": 0})
    _fs_quota[op] = _fs_quota.get(op, 0) + 1
    ratio = _fs_quota[op] / _FS_LIMITS[op]
    if ratio >= _FS_BLOCK:
        return "block"
    if ratio >= _FS_WARN:
        return "warn"
    return "ok"


def _flatten_for_firestore(node_map: dict) -> dict:
    """Strip nested children lists before saving — reconstruct from children_ids on load."""
    return {nid: {k: v for k, v in n.items() if k != "children"} for nid, n in node_map.items()}


def _restore_children(node_map: dict) -> dict:
    """Rebuild children lists from children_ids after loading from Firestore."""
    for n in node_map.values():
        n["children"] = [node_map[cid] for cid in n.get("children_ids", []) if cid in node_map]
    return node_map


async def _save_session(sid: str):
    if _db is None:
        return
    s = sessions.get(sid)
    if not s:
        return
    status = _fs_check("writes")
    if status == "block":
        print(f"[Firestore] Write quota at 95% — skipping save for {sid}")
        return
    try:
        doc = {
            "topic": s["topic"],
            "status": s["status"],
            "created_at": s.get("created_at", ""),
            "message_count": s.get("message_count", 0),
            "messages": s.get("messages", []),
            "node_map": _flatten_for_firestore(s.get("node_map", {})),
            "visit_stack": s.get("visit_stack", []),
            "visited": list(s.get("visited", set())),
            "stats": s.get("stats", {}),
        }
        await _db.collection("sessions").document(sid).set(doc)
    except Exception as e:
        print(f"[Firestore] Save error for {sid}: {e}")


async def _load_sessions_from_firestore():
    if _db is None:
        return
    try:
        docs = await _db.collection("sessions").get()
        loaded = 0
        for doc in docs:
            data = doc.to_dict()
            sid = doc.id
            status = data.get("status", "failed")
            if status == "processing":
                await _db.collection("sessions").document(sid).update({"status": "failed"})
                continue
            if status != "ready":
                continue
            uid = f"u_{sid[:8]}"
            adk_sid = f"a_{sid[:8]}"
            ss = InMemorySessionService()
            await ss.create_session(app_name=APP, user_id=uid, session_id=adk_sid)
            node_map = _restore_children(data.get("node_map", {}))
            sessions[sid] = {
                "topic": data["topic"],
                "status": "ready",
                "created_at": data.get("created_at", ""),
                "message_count": data.get("message_count", 0),
                "messages": data.get("messages", []),
                "user_id": uid,
                "adk_sid": adk_sid,
                "session_service": ss,
                "research_runner": Runner(agent=root_agent, app_name=APP, session_service=ss),
                "conv_runner": Runner(agent=conversation_agent, app_name=APP, session_service=ss),
                "hierarchy": node_map.get("root"),
                "node_map": node_map,
                "visit_stack": data.get("visit_stack", []),
                "visited": set(data.get("visited", [])),
                "review_queue": [],
                "stats": data.get("stats", {}),
            }
            loaded += 1
        print(f"[Firestore] Loaded {loaded} sessions.")
    except Exception as e:
        print(f"[Firestore] Load error: {e}")


@asynccontextmanager
async def lifespan(app_: FastAPI):
    await _load_sessions_from_firestore()
    yield


app = FastAPI(title="Curiosity Engine (ADK)", lifespan=lifespan)
_origins_raw = os.getenv("ALLOWED_ORIGINS", "http://localhost:5173,http://localhost:4173")
_origins = [o.strip() for o in _origins_raw.split(",")]
app.add_middleware(
    CORSMiddleware,
    allow_origins=_origins,
    allow_methods=["*"],
    allow_headers=["*"],
)

# ── App-key guard ───────────────────────────────────────────────────────────────
# Rejects all non-OPTIONS requests that don't carry the correct X-App-Key header.
# This prevents direct backend access from anyone who doesn't have the key
# (bots, scrapers, quota abusers). The key is baked into the frontend bundle
# and set as APP_SECRET_KEY on Cloud Run.

_APP_KEY = os.getenv("APP_SECRET_KEY", "")


class _AppKeyMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request: Request, call_next):
        if _APP_KEY and request.method != "OPTIONS" and request.url.path != "/api/health":
            if request.headers.get("X-App-Key") != _APP_KEY:
                return JSONResponse({"detail": "Forbidden"}, status_code=403)
        return await call_next(request)


app.add_middleware(_AppKeyMiddleware)

# ── Rate limiting ──────────────────────────────────────────────────────────────

_rate_lock = asyncio.Lock()
_tokens: float = 4.0
_MAX_TOKENS: float = 4.0
_REFILL_RATE: float = 1 / 4.5
_last_refill: float = 0.0


async def _rate_gate():
    global _tokens, _last_refill
    async with _rate_lock:
        now = time.monotonic()
        if _last_refill == 0.0:
            _last_refill = now
        _tokens = min(_MAX_TOKENS, _tokens + (now - _last_refill) * _REFILL_RATE)
        _last_refill = now
        if _tokens >= 1.0:
            _tokens -= 1.0
            return
        wait = (1.0 - _tokens) / _REFILL_RATE
    await asyncio.sleep(wait)
    async with _rate_lock:
        _tokens = max(0.0, _tokens - 1.0)


# ── Hierarchy primitives ──────────────────────────────────────────────────────

def _make_node(nid, name, definition, depth, difficulty, parent_id,
               concept_type="THEORY"):
    return {
        "id": nid,
        "name": name[:80],
        "definition": definition[:400],
        "difficulty": min(max(difficulty, 1), 3),
        "concept_type": concept_type,
        "depth": depth,
        "mastery": "not_covered",
        "parent_id": parent_id,
        "children_ids": [],
        "times_assessed": 0,
        "last_score": 0.0,
        "is_current": False,
        "children": [],
    }


def _build_hierarchy(topic, research_raw):
    """Build 3-level tree from SearchAgent's structured research JSON.

    Sections are taken from Wikipedia article order (which follows a natural
    basic-to-advanced flow). Each section gets up to 4 key_point children.
    Difficulty is assigned progressively: first third = beginner, middle =
    intermediate, last third = advanced. This ensures DFS traversal teaches
    from foundations to expert concepts.
    """
    try:
        clean = re.sub(r"```(?:json)?|```", "", research_raw).strip()
        research = json.loads(clean)
    except Exception:
        research = {}

    summary = research.get("wiki_summary", topic)
    # Take up to 10 sections for a richer tree
    sections = research.get("wiki_sections", [])[:10]
    key_points = research.get("key_points", [])

    root = _make_node("root", topic, summary[:300], 0, 1, None)
    n_sec = max(len(sections), 1)
    # Distribute key_points across sections, up to 4 per section
    kp_per = max(1, len(key_points) // n_sec)

    for i, sec in enumerate(sections):
        sid = f"s{i}"
        # Progressive difficulty: first third beginner, middle intermediate, last advanced
        frac = i / max(n_sec - 1, 1)
        diff = 1 if frac < 0.33 else (2 if frac < 0.66 else 3)
        sec_node = _make_node(sid, sec, f"Wikipedia section: {sec}", 1, diff, "root")

        kps = key_points[i * kp_per:(i + 1) * kp_per]
        for j, kp in enumerate(kps[:4]):
            kid = f"s{i}k{j}"
            kp_node = _make_node(kid, kp[:60], kp, 2, diff, sid, "PRINCIPLE")
            sec_node["children_ids"].append(kid)
            sec_node["children"].append(kp_node)

        root["children_ids"].append(sid)
        root["children"].append(sec_node)

    return root


def _build_maps(root):
    """Build node_map and dfs_order from root."""
    node_map = {}
    dfs = []

    def walk(n):
        node_map[n["id"]] = n
        dfs.append(n["id"])
        for c in n.get("children", []):
            walk(c)

    walk(root)
    return node_map, dfs


def _add_children(node_map, parent_id, children_data):
    """Dynamically add child nodes to an existing parent (IDK expansion)."""
    parent = node_map.get(parent_id)
    if not parent:
        return []
    new_ids = []
    for i, cd in enumerate(children_data):
        nid = f"{parent_id}_e{i}"
        if nid in node_map:
            continue
        child = _make_node(
            nid,
            cd.get("name", f"Concept {i}"),
            cd.get("definition", ""),
            parent["depth"] + 1,
            cd.get("difficulty", parent["difficulty"]),
            parent_id,
            cd.get("concept_type", "THEORY"),
        )
        node_map[nid] = child
        parent["children_ids"].append(nid)
        parent["children"].append(child)
        new_ids.append(nid)
    return new_ids


def _is_leaf(node_map, nid):
    n = node_map.get(nid)
    return n is not None and len(n.get("children_ids", [])) == 0


def _mark_subtree(node_map, nid, mastery):
    """Recursively mark all descendants with given mastery."""
    stack = [nid]
    while stack:
        cur = stack.pop()
        n = node_map.get(cur)
        if n:
            n["mastery"] = mastery
            stack.extend(n.get("children_ids", []))


def _branch_to(nid, node_map):
    path = []
    cur = nid
    while cur and cur in node_map:
        path.insert(0, node_map[cur]["name"])
        cur = node_map[cur].get("parent_id")
    return path


def _flatten_graph(node_map):
    nodes, edges = [], []
    for n in node_map.values():
        nodes.append({
            "id": n["id"], "name": n["name"], "definition": n["definition"],
            "difficulty": n["difficulty"], "type": n["concept_type"],
            "depth_level": n["depth"], "mastery": n["mastery"],
        })
        for cid in n.get("children_ids", []):
            edges.append({"source": n["id"], "target": cid, "relation": "PART_OF"})
    return {"nodes": nodes, "edges": edges}


def _progress(node_map):
    c = {"total": 0, "mastered": 0, "partial": 0, "unknown": 0,
         "not_covered": 0, "skipped": 0}
    for n in node_map.values():
        if n["id"] == "root":
            continue
        c["total"] += 1
        m = n.get("mastery", "not_covered")
        if m in c:
            c[m] += 1
    t = max(c["total"], 1)
    c["pct_complete"] = round((c["mastered"] + c["skipped"]) / t * 100)
    return c


# ── Dynamic expansion via Gemini ───────────────────────────────────────────────

EXPAND_PROMPT = """You are a curriculum designer. Given a concept that a student doesn't understand,
break it down into 3-5 simpler sub-concepts that build up to understanding the parent concept.

Parent concept: {name}
Definition: {definition}
Overall topic: {topic}

Return ONLY a JSON object with this exact structure (no markdown, no commentary):
{{"children": [
  {{"name": "sub-concept name", "definition": "1-2 sentence definition", "difficulty": 1, "concept_type": "THEORY"}},
  ...
]}}

Rules:
- Each sub-concept should be simpler than the parent
- Order from easiest to hardest
- difficulty: 1=beginner, 2=intermediate, 3=advanced
- concept_type: THEORY, PRACTICE, PRINCIPLE, or EXAMPLE
- Keep names concise (3-6 words)"""


async def _expand_node(session, node_id):
    """Call Gemini to generate 3-5 sub-concepts and add them to the tree."""
    nm = session["node_map"]
    node = nm.get(node_id)
    if not node or not _is_leaf(nm, node_id):
        return []

    await _rate_gate()
    prompt = EXPAND_PROMPT.format(
        name=node["name"],
        definition=node["definition"],
        topic=session["topic"],
    )
    try:
        resp = await _client.aio.models.generate_content(
            model=_MODEL,
            contents=prompt,
        )
        text = resp.text or ""
        clean = re.sub(r"```(?:json)?|```", "", text).strip()
        data = json.loads(clean)
        children_data = data.get("children", [])[:5]
    except Exception:
        children_data = []

    if children_data:
        new_ids = _add_children(nm, node_id, children_data)
        return new_ids
    return []


# ── ADK runner ─────────────────────────────────────────────────────────────────

async def _run_agent(runner, user_id, session_id, text):
    message = genai_types.Content(
        role="user", parts=[genai_types.Part(text=text)],
    )
    for attempt in range(3):
        await _rate_gate()
        try:
            response = ""
            async for event in runner.run_async(
                user_id=user_id, session_id=session_id, new_message=message,
            ):
                if event.is_final_response() and event.content and event.content.parts:
                    response = "".join(p.text for p in event.content.parts if p.text)
            return response or "_No response._"
        except Exception as exc:
            if "429" in str(exc) or "RESOURCE" in str(exc):
                if attempt < 2:
                    await asyncio.sleep(15 * (2 ** attempt))
                    continue
                raise HTTPException(429, detail="rate_limited")
            raise


def _friendly_error(exc):
    msg = str(exc)
    if "429" in msg or "RESOURCE" in msg:
        return "**Rate limit hit.** Wait a minute and retry."
    return f"**Error:** {msg}"


# ── Session state helpers ──────────────────────────────────────────────────────

def _now():
    return datetime.now(timezone.utc).isoformat()


def _msg(role, content):
    return {"role": role, "content": content, "timestamp": _now()}


def _append_msg(s: dict, role: str, content: str):
    """Append a message and increment message_count."""
    s["messages"].append(_msg(role, content))
    s["message_count"] = s.get("message_count", 0) + 1


def _cur_node(s):
    vs = s.get("visit_stack", [])
    return vs[0] if vs else None


def _advance(s):
    """Pop the current node and advance to next unmastered node."""
    vs = s.get("visit_stack", [])
    nm = s.get("node_map", {})
    vi = s.get("visited", set())
    if vs:
        old = vs.pop(0)
        nm.get(old, {})["is_current"] = False
        vi.add(old)
    # Skip already mastered/skipped/visited
    while vs and (vs[0] in vi or nm.get(vs[0], {}).get("mastery") in ("mastered", "skipped")):
        skipped = vs.pop(0)
        vi.add(skipped)
    if vs:
        nm.get(vs[0], {})["is_current"] = True
        if nm.get(vs[0], {}).get("mastery") == "not_covered":
            nm[vs[0]]["mastery"] = "unknown"


def _push_children(s, node_id):
    """Push children of node_id to front of visit_stack (DFS)."""
    nm = s.get("node_map", {})
    vs = s.get("visit_stack", [])
    vi = s.get("visited", set())
    node = nm.get(node_id)
    if not node:
        return
    children = [cid for cid in node.get("children_ids", []) if cid not in vi]
    s["visit_stack"] = children + vs


def _chat_resp(sid, msgs, s):
    nid = _cur_node(s)
    nm = s.get("node_map", {})
    return {
        "messages": msgs,
        "session_id": sid,
        "current_concept": nm[nid]["name"] if nid and nid in nm else None,
        "current_node_id": nid,
        "current_branch": _branch_to(nid, nm) if nid else [],
        "is_question": True,
        "requires_answer": True,
    }


# ── Background pipeline ───────────────────────────────────────────────────────

async def _research_bg(session_id, topic):
    s = sessions[session_id]
    try:
        response = await _run_agent(
            s["research_runner"], s["user_id"], s["adk_sid"],
            f"Teach me about: {topic}",
        )
        _append_msg(s, "assistant", response)

        # Build hierarchy from ADK state
        adk_sess = await s["session_service"].get_session(
            app_name=APP, user_id=s["user_id"], session_id=s["adk_sid"],
        )
        research_raw = (adk_sess.state or {}).get("research", "{}")
        root = _build_hierarchy(topic, research_raw)
        nm, dfs = _build_maps(root)

        # Count real sources from research data
        try:
            clean = re.sub(r"```(?:json)?|```", "", research_raw).strip()
            rdata = json.loads(clean)
        except Exception:
            rdata = {}
        wiki_count = 1 if rdata.get("wiki_summary") else 0
        web_count = len(rdata.get("web_snippets", []))
        concept_count = len(nm) - 1  # exclude root

        # Init traversal: children of root → visit_stack
        children = list(root.get("children_ids", []))
        visited = {"root"}

        s["hierarchy"] = root
        s["node_map"] = nm
        s["visit_stack"] = children
        s["visited"] = visited
        s["review_queue"] = []
        s["stats"] = {
            "sources": wiki_count + web_count,
            "web_results": web_count,
            "concepts": concept_count,
        }
        nm["root"]["mastery"] = "not_covered"

        # Set first child as current
        if children:
            nm[children[0]]["is_current"] = True
            nm[children[0]]["mastery"] = "unknown"

        s["status"] = "ready"

        # Auto-probe: after the overview, immediately ask about the first concept
        # so the student knows exactly where to start and the tree is in sync
        if children:
            first = nm[children[0]]
            probe_prompt = (
                f"The teaching overview for '{topic}' has just been delivered. "
                f"Now start the actual learning session. In one sentence introduce "
                f"'{first['name']}', then ask a single concise probing question "
                "to assess what the student already knows about it. "
                "Do NOT explain the concept yet — just ask."
            )
            try:
                probe_resp = await _run_agent(
                    s["conv_runner"], s["user_id"], s["adk_sid"], probe_prompt,
                )
                _append_msg(s, "assistant", probe_resp)
            except Exception:
                pass  # Don't fail the session if the probe call fails

        await _save_session(session_id)
    except HTTPException:
        _append_msg(s, "assistant", "**Rate limit hit.** Wait a minute and retry.")
        s["status"] = "failed"
        s["error"] = "Rate limited during research."
        await _save_session(session_id)
    except Exception as exc:
        import traceback
        traceback.print_exc()   # full stack trace visible in Cloud Run logs
        _append_msg(s, "assistant", _friendly_error(exc))
        s["status"] = "failed"
        s["error"] = _friendly_error(exc)
        await _save_session(session_id)


# ── App-level limits ───────────────────────────────────────────────────────────

_MAX_SESSIONS = 10           # total concurrent chat sessions
_MAX_MESSAGES  = 40          # follow-up messages per session


# ── Globals ────────────────────────────────────────────────────────────────────

sessions: dict = {}
APP = "curiosity_engine"


# ── Request models ─────────────────────────────────────────────────────────────

class TopicReq(BaseModel):
    topic: str

class AnswerReq(BaseModel):
    session_id: str
    answer: str

class SidReq(BaseModel):
    session_id: str

class JumpReq(BaseModel):
    session_id: str
    node_id: str


# ── Routes: Chat ───────────────────────────────────────────────────────────────

@app.get("/api/health")
async def health():
    return {"status": "ok", "app": "Curiosity Engine (ADK)"}


@app.post("/api/chat/start")
async def start_session(body: TopicReq):
    if len(sessions) >= _MAX_SESSIONS:
        raise HTTPException(429, detail="session_limit")
    sid = str(uuid.uuid4())
    uid = f"u_{sid[:8]}"
    adk_sid = f"a_{sid[:8]}"

    ss = InMemorySessionService()
    await ss.create_session(app_name=APP, user_id=uid, session_id=adk_sid)

    sessions[sid] = {
        "topic": body.topic, "status": "processing", "messages": [],
        "created_at": datetime.now(timezone.utc).isoformat(),
        "message_count": 0,
        "user_id": uid, "adk_sid": adk_sid, "session_service": ss,
        "research_runner": Runner(agent=root_agent, app_name=APP, session_service=ss),
        "conv_runner": Runner(agent=conversation_agent, app_name=APP, session_service=ss),
        "hierarchy": None, "node_map": {}, "visit_stack": [],
        "visited": set(), "review_queue": [],
    }
    asyncio.create_task(_save_session(sid))
    asyncio.create_task(_research_bg(sid, body.topic))
    return {"session_id": sid, "topic": body.topic, "status": "planning",
            "message": "Searching Wikipedia + web, building knowledge tree..."}


@app.get("/api/chat/status/{sid}")
async def status(sid: str):
    s = sessions.get(sid)
    if not s:
        raise HTTPException(404, "Session not found")
    m = {"processing": ("planning", 50, "Building knowledge tree..."),
         "ready": ("ready", 100, "Ready!"),
         "failed": ("failed", 0, s.get("error", "Failed."))}
    stage, pct, msg = m.get(s["status"], ("planning", 50, "Working..."))
    return {"session_id": sid, "topic": s["topic"], "stage": stage,
            "progress_pct": pct, "message": msg,
            "stats": s.get("stats", {})}


@app.get("/api/chat/history/{sid}")
async def history(sid: str):
    s = sessions.get(sid)
    if not s:
        raise HTTPException(404)
    return {"session_id": sid, "messages": s["messages"]}


@app.post("/api/chat/message")
async def message(body: AnswerReq):
    s = sessions.get(body.session_id)
    if not s:
        raise HTTPException(404)
    if s["status"] != "ready":
        raise HTTPException(400, "Not ready")
    if s.get("message_count", 0) >= _MAX_MESSAGES:
        raise HTTPException(429, detail="message_limit")

    nid = _cur_node(s)
    nm = s.get("node_map", {})
    concept = nm[nid]["name"] if nid and nid in nm else "the current topic"
    if nid and nid in nm:
        nm[nid]["mastery"] = "partial"
        nm[nid]["times_assessed"] += 1

    _append_msg(s, "user", body.answer)

    # Wrap the answer with concise-evaluation instructions so the agent
    # doesn't spiral into another full teaching cycle with more questions.
    eval_prompt = (
        f"[Evaluating student on: '{concept}']\n"
        f"Student's answer: {body.answer}\n\n"
        "Respond concisely (3–5 sentences max):\n"
        "1. Confirm what they got right (1–2 sentences).\n"
        "2. If there is a gap, correct it in one sentence.\n"
        "3. End with exactly one of these lines — do not ask another question:\n"
        "   • If they understood well → 'Click **I Know This** to advance to the next concept.'\n"
        "   • If they are still struggling → 'Click **I Don't Know** for a full walkthrough.'"
    )
    try:
        resp = await _run_agent(
            s["conv_runner"], s["user_id"], s["adk_sid"], eval_prompt,
        )
        _append_msg(s, "assistant", resp)
        asyncio.create_task(_save_session(body.session_id))
        return _chat_resp(body.session_id, [_msg("assistant", resp)], s)
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(502, _friendly_error(exc))


@app.post("/api/chat/idk")
async def idk(body: SidReq):
    s = sessions.get(body.session_id)
    if not s:
        raise HTTPException(404)
    if s.get("message_count", 0) >= _MAX_MESSAGES:
        raise HTTPException(429, detail="message_limit")

    nid = _cur_node(s)
    nm = s.get("node_map", {})
    concept = nm[nid]["name"] if nid and nid in nm else "this concept"

    # Mark as unknown
    if nid and nid in nm:
        nm[nid]["mastery"] = "unknown"
        nm[nid]["times_assessed"] += 1

    # Add to review queue
    rq = s.get("review_queue", [])
    if nid and nid not in rq:
        rq.append(nid)
        if len(rq) > 10:
            rq.pop(0)

    # Advance past current node BEFORE pushing children so the parent
    # is not re-visited once its children are exhausted
    vs = s.get("visit_stack", [])
    vi = s.get("visited", set())
    if nid and vs and vs[0] == nid:
        vs.pop(0)
    if nid:
        vi.add(nid)
        nm.get(nid, {})["is_current"] = False

    # Dynamic expansion: if leaf, generate 3-5 sub-concepts first
    expanded_names = []
    if nid and _is_leaf(nm, nid):
        new_ids = await _expand_node(s, nid)
        expanded_names = [nm[x]["name"] for x in new_ids if x in nm]

    # Push children to front of stack (existing or newly expanded)
    if nid:
        _push_children(s, nid)

    # Mark new current node
    new_vs = s.get("visit_stack", [])
    if new_vs:
        new_cur = new_vs[0]
        nm.get(new_cur, {})["is_current"] = True
        if nm.get(new_cur, {}).get("mastery") == "not_covered":
            nm[new_cur]["mastery"] = "unknown"

    _append_msg(s, "user", "I don't know about this yet.")

    # Build context-aware prompt
    if expanded_names:
        expand_info = (
            f"The concept '{concept}' has been broken down into these sub-topics: "
            + ", ".join(expanded_names)
            + ". Teach the parent concept thoroughly, then briefly introduce each sub-topic "
            "so the student knows what they'll learn next."
        )
    else:
        expand_info = ""

    # First child in stack = what gets assessed after this explanation
    first_child_name = nm.get(s.get("visit_stack", [None])[0], {}).get("name") \
        if s.get("visit_stack") else None
    next_probe = (
        f"\n\nClose with a single focused question specifically about "
        f"'{first_child_name}' — that is the first sub-concept the student "
        "will be assessed on immediately after this explanation."
        if first_child_name and first_child_name != concept else ""
    )

    idk_text = (
        f"The student does not know '{concept}'. "
        "Teach this concept from scratch: use a real-world analogy, walk through the "
        "mechanics step by step, show a concrete example, and explain why it matters. "
        f"Be detailed (400-600 words). {expand_info}{next_probe}"
    )
    try:
        resp = await _run_agent(
            s["conv_runner"], s["user_id"], s["adk_sid"], idk_text,
        )
        _append_msg(s, "assistant", resp)
        asyncio.create_task(_save_session(body.session_id))
        return _chat_resp(body.session_id, [_msg("assistant", resp)], s)
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(502, _friendly_error(exc))


@app.post("/api/chat/iknow")
async def iknow(body: SidReq):
    s = sessions.get(body.session_id)
    if not s:
        raise HTTPException(404)
    if s.get("message_count", 0) >= _MAX_MESSAGES:
        raise HTTPException(429, detail="message_limit")

    nid = _cur_node(s)
    nm = s.get("node_map", {})
    concept = nm[nid]["name"] if nid and nid in nm else "this concept"

    # Mark subtree as mastered/skipped
    if nid and nid in nm:
        nm[nid]["mastery"] = "mastered"
        for cid in nm[nid].get("children_ids", []):
            _mark_subtree(nm, cid, "skipped")

    # Advance DFS
    _advance(s)
    next_nid = _cur_node(s)
    next_name = nm[next_nid]["name"] if next_nid and next_nid in nm else None

    _append_msg(s, "user", "I already know this — skip ahead.")

    if next_name:
        prompt = (
            f"The student already knows '{concept}' — it's been marked mastered "
            f"and its subtree skipped. Move on to '{next_name}'. "
            "Start by briefly introducing it, then ask a probing question to assess "
            "the student's understanding."
        )
    else:
        prompt = (
            f"The student already knows '{concept}'. All topics in the learning "
            "tree have been covered! Congratulate them and give a brief summary "
            "of what was learned."
        )

    try:
        resp = await _run_agent(
            s["conv_runner"], s["user_id"], s["adk_sid"], prompt,
        )
        _append_msg(s, "assistant", resp)
        asyncio.create_task(_save_session(body.session_id))
        return _chat_resp(body.session_id, [_msg("assistant", resp)], s)
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(502, _friendly_error(exc))


@app.post("/api/chat/jump")
async def jump(body: JumpReq):
    s = sessions.get(body.session_id)
    if not s:
        raise HTTPException(404)
    if s.get("message_count", 0) >= _MAX_MESSAGES:
        raise HTTPException(429, detail="message_limit")
    nm = s.get("node_map", {})
    if body.node_id not in nm:
        raise HTTPException(404, "Node not found")

    # Update current pointer
    old = _cur_node(s)
    if old and old in nm:
        nm[old]["is_current"] = False

    vs = s.get("visit_stack", [])
    # Remove target from stack if present, put at front
    if body.node_id in vs:
        vs.remove(body.node_id)
    vs.insert(0, body.node_id)
    nm[body.node_id]["is_current"] = True
    if nm[body.node_id]["mastery"] == "not_covered":
        nm[body.node_id]["mastery"] = "unknown"

    concept = nm[body.node_id]["name"]
    _append_msg(s, "user", f"Jump to: {concept}")
    prompt = f"The student wants to jump to '{concept}'. Teach it now."
    try:
        resp = await _run_agent(
            s["conv_runner"], s["user_id"], s["adk_sid"], prompt,
        )
        _append_msg(s, "assistant", resp)
        asyncio.create_task(_save_session(body.session_id))
        return _chat_resp(body.session_id, [_msg("assistant", resp)], s)
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(502, _friendly_error(exc))


@app.get("/api/chat/sessions")
async def list_sessions():
    result = []
    for sid, s in sessions.items():
        p = _progress(s.get("node_map", {})) if s["status"] == "ready" else {}
        result.append({
            "session_id": sid,
            "topic": s["topic"],
            "status": s["status"],
            "created_at": s.get("created_at", ""),
            "message_count": s.get("message_count", 0),
            "progress_pct": p.get("pct_complete", 0),
        })
    return {"sessions": sorted(result, key=lambda x: x["created_at"], reverse=True)}


@app.delete("/api/chat/{sid}")
async def delete_session(sid: str):
    if sid not in sessions:
        raise HTTPException(404, "Session not found")
    sessions.pop(sid)
    if _db is not None:
        chk = _fs_check("deletes")
        if chk != "block":
            try:
                await _db.collection("sessions").document(sid).delete()
            except Exception as e:
                print(f"[Firestore] Delete error for {sid}: {e}")
    return {"deleted": sid}


@app.get("/api/quota")
async def quota_status():
    today = date.today().isoformat()
    if _fs_quota.get("day") != today:
        return {"warnings": [], "usage": {"reads": 0, "writes": 0, "deletes": 0}}
    warnings = []
    for op, limit in _FS_LIMITS.items():
        count = _fs_quota.get(op, 0)
        ratio = count / limit
        if ratio >= _FS_BLOCK:
            warnings.append({
                "type": f"firestore_{op}",
                "level": "critical",
                "message": (
                    f"Firestore {op} quota critical: {count}/{limit} per day ({int(ratio*100)}%) — "
                    "persistence paused to protect free tier. "
                    "Contact virajbhatia.personal@gmail.com"
                ),
            })
        elif ratio >= _FS_WARN:
            warnings.append({
                "type": f"firestore_{op}",
                "level": "warning",
                "message": (
                    f"Firestore {op} quota at {int(ratio*100)}% ({count}/{limit} per day). "
                    "Contact virajbhatia.personal@gmail.com if this continues."
                ),
            })
    return {"warnings": warnings, "usage": {k: _fs_quota.get(k, 0) for k in ("reads", "writes", "deletes")}}


# ── Routes: Graph ──────────────────────────────────────────────────────────────

@app.get("/api/graph/hierarchy/{sid}")
async def get_hierarchy(sid: str):
    s = sessions.get(sid)
    if not s or not s.get("hierarchy"):
        raise HTTPException(404, "Not ready")
    return s["hierarchy"]


@app.get("/api/graph/nodes/{sid}")
async def get_nodes(sid: str):
    s = sessions.get(sid)
    if not s or not s.get("node_map"):
        raise HTTPException(404, "Not ready")
    return _flatten_graph(s["node_map"])


@app.get("/api/graph/progress/{sid}")
async def get_progress(sid: str):
    s = sessions.get(sid)
    if not s:
        raise HTTPException(404)
    p = _progress(s.get("node_map", {}))
    nid = _cur_node(s)
    nm = s.get("node_map", {})
    p["current_node_id"] = nid
    p["current_branch"] = _branch_to(nid, nm) if nid else []
    return p


# ── Entry point ────────────────────────────────────────────────────────────────

if __name__ == "__main__":
    import uvicorn
    uvicorn.run("server:app", host="0.0.0.0", port=8000, reload=False)
