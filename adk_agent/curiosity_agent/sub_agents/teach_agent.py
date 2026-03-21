"""
TeachAgent — reads {research} and {code_demo} from session state,
synthesizes a structured Markdown educational response.
Writes result to state key 'teaching_response'.
"""

import os
from google.adk.agents import LlmAgent
from ..prompts.teach_prompt import TEACH_PROMPT

_MODEL = os.getenv("GEMINI_MODEL", "gemini-3.1-flash-lite-preview")

teach_agent = LlmAgent(
    name="teach_agent",
    model=_MODEL,
    instruction=TEACH_PROMPT,
    output_key="teaching_response",
)
