"""
Curiosity Engine — CLI entry point.

Usage:
    python main.py                   # interactive multi-turn session
    python main.py "binary search"   # single-shot query
"""

import asyncio
import json
import os
import sys
from pathlib import Path

from dotenv import load_dotenv

load_dotenv(Path(__file__).parent / ".env")

# Validate API key early
if not os.getenv("GOOGLE_API_KEY"):
    sys.exit(
        "ERROR: GOOGLE_API_KEY is not set.\n"
        "Get a free key at https://aistudio.google.com/app/apikey\n"
        "Then add it to adk_agent/.env  (copy from .env.example)"
    )

from google.adk.runners import Runner
from google.adk.sessions import InMemorySessionService
from google.genai import types as genai_types

from curiosity_agent import root_agent

APP_NAME = "curiosity_engine"
SESSION_ID = "cli_session"
USER_ID = "cli_user"


async def run_query(runner: Runner, query: str) -> str:
    """Send a single query and return the teaching_response text."""
    message = genai_types.Content(
        role="user",
        parts=[genai_types.Part(text=query)],
    )
    full_response = ""
    async for event in runner.run_async(
        user_id=USER_ID,
        session_id=SESSION_ID,
        new_message=message,
    ):
        if event.is_final_response() and event.content and event.content.parts:
            full_response = "".join(p.text for p in event.content.parts if p.text)
    return full_response


async def main() -> None:
    session_service = InMemorySessionService()
    await session_service.create_session(
        app_name=APP_NAME,
        user_id=USER_ID,
        session_id=SESSION_ID,
    )

    runner = Runner(
        agent=root_agent,
        app_name=APP_NAME,
        session_service=session_service,
    )

    # Single-shot mode
    if len(sys.argv) > 1:
        topic = " ".join(sys.argv[1:])
        print(f"\nCuriosity Engine — researching: {topic!r}\n")
        response = await run_query(runner, topic)
        print(response)
        _print_generated_files()
        return

    # Interactive multi-turn mode
    print("Curiosity Engine — type a topic to learn about it.")
    print("Commands: 'quit' or Ctrl+C to exit.\n")

    while True:
        try:
            topic = input("Topic> ").strip()
        except (EOFError, KeyboardInterrupt):
            print("\nGoodbye!")
            break

        if not topic:
            continue
        if topic.lower() in {"quit", "exit", "q"}:
            print("Goodbye!")
            break

        print(f"\nResearching {topic!r} …\n")
        try:
            response = await run_query(runner, topic)
            print(response)
            _print_generated_files()
            print()
        except Exception as exc:
            print(f"[ERROR] {exc}\n")


def _print_generated_files() -> None:
    """Print paths of any newly generated code files."""
    generated = Path(__file__).parent / "generated"
    if not generated.exists():
        return
    files = sorted(generated.rglob("*.py"))
    if files:
        print("\n--- Generated files ---")
        for f in files:
            print(f"  {f.relative_to(Path(__file__).parent)}")


if __name__ == "__main__":
    asyncio.run(main())
