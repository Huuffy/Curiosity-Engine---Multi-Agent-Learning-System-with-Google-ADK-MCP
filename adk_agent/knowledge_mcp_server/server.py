"""
KnowledgeServer — FastMCP server exposing 4 search tools:
  1. search_wikipedia   — OpenSearch API, returns top 5 matches
  2. get_article_summary — full summary + section list via wikipedia-api
  3. get_section_content — pull a named section from an article
  4. search_web          — DuckDuckGo HTML scrape, no API key required
"""

import json
import httpx
import wikipediaapi
from bs4 import BeautifulSoup
from mcp.server.fastmcp import FastMCP

mcp = FastMCP("KnowledgeServer")

wiki = wikipediaapi.Wikipedia(
    user_agent="CuriosityEngine/1.0 (contact@curiosity.ai)",
    language="en",
)

WIKI_API = "https://en.wikipedia.org/w/api.php"
DDG_HTML  = "https://html.duckduckgo.com/html/"
HEADERS   = {"User-Agent": "CuriosityEngine/1.0 (contact@curiosity.ai)"}


# ─── Tool 1 ───────────────────────────────────────────────────────────────────

@mcp.tool()
def search_wikipedia(query: str) -> dict:
    """Search Wikipedia and return the top 5 matching article titles.

    Args:
        query: The search term to look up on Wikipedia.

    Returns:
        A dict with a 'results' list where each item has 'title', 'description', and 'url'.
    """
    try:
        resp = httpx.get(
            WIKI_API,
            params={"action": "opensearch", "search": query, "limit": 5, "format": "json"},
            headers=HEADERS,
            timeout=10,
        )
        resp.raise_for_status()
        titles, descriptions, urls = resp.json()[1], resp.json()[2], resp.json()[3]
        results = [
            {"title": t, "description": d, "url": u}
            for t, d, u in zip(titles, descriptions, urls)
        ]
        return {"results": results}
    except Exception as exc:
        return {"results": [], "error": str(exc)}


# ─── Tool 2 ───────────────────────────────────────────────────────────────────

@mcp.tool()
def get_article_summary(title: str) -> dict:
    """Fetch a Wikipedia article's summary and section list.

    Args:
        title: The exact Wikipedia article title (e.g. 'Binary search algorithm').

    Returns:
        A dict with 'title', 'summary', 'sections' (list of section names), 'url', and 'exists'.
    """
    page = wiki.page(title)
    if not page.exists():
        return {"title": title, "summary": "", "sections": [], "url": "", "exists": False}

    def _collect_section_titles(sections, depth=0):
        names = []
        for s in sections:
            names.append(s.title)
            names.extend(_collect_section_titles(s.sections, depth + 1))
        return names

    return {
        "title": page.title,
        "summary": page.summary[:2000],  # cap at 2 000 chars
        "sections": _collect_section_titles(page.sections),
        "url": page.fullurl,
        "exists": True,
    }


# ─── Tool 3 ───────────────────────────────────────────────────────────────────

@mcp.tool()
def get_section_content(title: str, section_title: str) -> dict:
    """Retrieve the text content of a specific section within a Wikipedia article.

    Args:
        title: The Wikipedia article title.
        section_title: The name of the section to retrieve.

    Returns:
        A dict with 'section', 'content', and 'subsections'.
        On failure: a dict with 'error' and 'available_sections'.
    """
    page = wiki.page(title)
    if not page.exists():
        return {"error": f"Page '{title}' not found.", "available_sections": []}

    def _find_section(sections, target):
        for s in sections:
            if s.title.lower() == target.lower():
                return s
            found = _find_section(s.sections, target)
            if found:
                return found
        return None

    def _collect_names(sections):
        names = []
        for s in sections:
            names.append(s.title)
            names.extend(_collect_names(s.sections))
        return names

    section = _find_section(page.sections, section_title)
    if section is None:
        return {
            "error": f"Section '{section_title}' not found.",
            "available_sections": _collect_names(page.sections),
        }

    return {
        "section": section.title,
        "content": section.text[:3000],
        "subsections": [s.title for s in section.sections],
    }


# ─── Tool 4 ───────────────────────────────────────────────────────────────────

@mcp.tool()
def search_web(query: str) -> dict:
    """Search DuckDuckGo and return the top results (no API key required).

    Args:
        query: The search query string.

    Returns:
        A dict with a 'results' list where each item has 'title', 'snippet', and 'url'.
    """
    try:
        resp = httpx.post(
            DDG_HTML,
            data={"q": query},
            headers={**HEADERS, "Content-Type": "application/x-www-form-urlencoded"},
            timeout=10,
            follow_redirects=True,
        )
        resp.raise_for_status()
        soup = BeautifulSoup(resp.text, "html.parser")
        results = []
        for result in soup.select(".result")[:8]:
            title_tag = result.select_one(".result__title a")
            snippet_tag = result.select_one(".result__snippet")
            if title_tag:
                results.append({
                    "title": title_tag.get_text(strip=True),
                    "snippet": snippet_tag.get_text(strip=True) if snippet_tag else "",
                    "url": title_tag.get("href", ""),
                })
        return {"results": results}
    except Exception as exc:
        return {"results": [], "error": str(exc)}


# ─── Entry point ──────────────────────────────────────────────────────────────

if __name__ == "__main__":
    mcp.run(transport="stdio")
