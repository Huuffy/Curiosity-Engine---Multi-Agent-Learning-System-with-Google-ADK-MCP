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
from datetime import datetime, timezone

from dotenv import load_dotenv
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
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

app = FastAPI(title="Curiosity Engine (ADK)")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173", "http://localhost:4173"],
    allow_methods=["*"],
    allow_headers=["*"],
)

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
            if ("429" in str(exc) or "RESOURCE" in str(exc)) and attempt < 2:
                await asyncio.sleep(15 * (2 ** attempt))
                continue
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
        s["messages"].append(_msg("assistant", response))

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
    except Exception as exc:
        s["messages"].append(_msg("assistant", _friendly_error(exc)))
        s["status"] = "failed"
        s["error"] = _friendly_error(exc)


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
    sid = str(uuid.uuid4())
    uid = f"u_{sid[:8]}"
    adk_sid = f"a_{sid[:8]}"

    ss = InMemorySessionService()
    await ss.create_session(app_name=APP, user_id=uid, session_id=adk_sid)

    sessions[sid] = {
        "topic": body.topic, "status": "processing", "messages": [],
        "user_id": uid, "adk_sid": adk_sid, "session_service": ss,
        "research_runner": Runner(agent=root_agent, app_name=APP, session_service=ss),
        "conv_runner": Runner(agent=conversation_agent, app_name=APP, session_service=ss),
        "hierarchy": None, "node_map": {}, "visit_stack": [],
        "visited": set(), "review_queue": [],
    }
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

    nid = _cur_node(s)
    nm = s.get("node_map", {})
    if nid and nid in nm:
        nm[nid]["mastery"] = "partial"
        nm[nid]["times_assessed"] += 1

    s["messages"].append(_msg("user", body.answer))
    try:
        resp = await _run_agent(
            s["conv_runner"], s["user_id"], s["adk_sid"], body.answer,
        )
        s["messages"].append(_msg("assistant", resp))
        return _chat_resp(body.session_id, [_msg("assistant", resp)], s)
    except Exception as exc:
        raise HTTPException(502, _friendly_error(exc))


@app.post("/api/chat/idk")
async def idk(body: SidReq):
    s = sessions.get(body.session_id)
    if not s:
        raise HTTPException(404)

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

    # Dynamic expansion: if leaf, generate 3-5 sub-concepts first
    expanded_names = []
    if nid and _is_leaf(nm, nid):
        new_ids = await _expand_node(s, nid)
        expanded_names = [nm[x]["name"] for x in new_ids if x in nm]

    # Always push children into visit_stack (existing or newly expanded)
    if nid:
        _push_children(s, nid)

    s["messages"].append(_msg("user", "I don't know about this yet."))

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

    idk_text = (
        f"The student does not know '{concept}'. "
        "Teach this concept from scratch: use a real-world analogy, walk through the "
        "mechanics step by step, show a concrete example, and explain why it matters. "
        f"Be detailed (400-600 words). {expand_info}"
    )
    try:
        resp = await _run_agent(
            s["conv_runner"], s["user_id"], s["adk_sid"], idk_text,
        )
        s["messages"].append(_msg("assistant", resp))
        return _chat_resp(body.session_id, [_msg("assistant", resp)], s)
    except Exception as exc:
        raise HTTPException(502, _friendly_error(exc))


@app.post("/api/chat/iknow")
async def iknow(body: SidReq):
    s = sessions.get(body.session_id)
    if not s:
        raise HTTPException(404)

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

    s["messages"].append(_msg("user", "I already know this — skip ahead."))

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
        s["messages"].append(_msg("assistant", resp))
        return _chat_resp(body.session_id, [_msg("assistant", resp)], s)
    except Exception as exc:
        raise HTTPException(502, _friendly_error(exc))


@app.post("/api/chat/jump")
async def jump(body: JumpReq):
    s = sessions.get(body.session_id)
    if not s:
        raise HTTPException(404)
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
    s["messages"].append(_msg("user", f"Jump to: {concept}"))
    prompt = f"The student wants to jump to '{concept}'. Teach it now."
    try:
        resp = await _run_agent(
            s["conv_runner"], s["user_id"], s["adk_sid"], prompt,
        )
        s["messages"].append(_msg("assistant", resp))
        return _chat_resp(body.session_id, [_msg("assistant", resp)], s)
    except Exception as exc:
        raise HTTPException(502, _friendly_error(exc))


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
