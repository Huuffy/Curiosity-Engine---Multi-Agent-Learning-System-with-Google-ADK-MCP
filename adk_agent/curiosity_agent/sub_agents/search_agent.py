"""
SearchAgent — uses MCP tools (Wikipedia + DuckDuckGo) to gather research.
Writes consolidated JSON to state key 'research'.
"""

import os
from pathlib import Path
from google.adk.agents import LlmAgent
from google.adk.tools.mcp_tool.mcp_toolset import MCPToolset, StdioConnectionParams
from mcp.client.stdio import StdioServerParameters

from ..prompts.search_prompt import SEARCH_PROMPT

_MODEL = os.getenv("GEMINI_MODEL", "gemini-3.1-flash-lite-preview")

MCP_SERVER_PATH = Path(__file__).parent.parent.parent / "knowledge_mcp_server" / "server.py"

search_agent = LlmAgent(
    name="search_agent",
    model=_MODEL,
    instruction=SEARCH_PROMPT,
    tools=[
        MCPToolset(
            connection_params=StdioConnectionParams(
                server_params=StdioServerParameters(
                    command="python",
                    args=[str(MCP_SERVER_PATH)],
                ),
            )
        )
    ],
    output_key="research",
)
