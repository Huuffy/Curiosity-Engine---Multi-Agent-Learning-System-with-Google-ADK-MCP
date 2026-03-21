"""
Root pipeline: SearchAgent retrieves data via MCP, then TeachAgent synthesises.

    curiosity_pipeline (SequentialAgent)
    ├── search_agent   → state["research"]  (Wikipedia + DuckDuckGo via MCP)
    └── teach_agent    → state["teaching_response"]

Code examples are generated inline during teaching (as markdown code blocks)
by the ConversationAgent — not as separate files upfront. This matches the
old system's approach where code is part of the teaching response.
"""

from google.adk.agents import SequentialAgent

from .sub_agents.search_agent import search_agent
from .sub_agents.teach_agent import teach_agent

root_agent = SequentialAgent(
    name="curiosity_pipeline",
    sub_agents=[search_agent, teach_agent],
)
