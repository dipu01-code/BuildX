"""Deterministic bounded chunking and lexical retrieval for local project files."""

from __future__ import annotations

import hashlib
import re
import unicodedata
from bisect import bisect_right

CHUNK_SIZE = 1400
CHUNK_OVERLAP = 180
MAX_CHUNK_SIZE = 2048
MAX_RESULTS = 20
MAX_QUERY_LENGTH = 300
_TOKEN = re.compile(r"[\w.-]+", re.UNICODE)
_STOP_WORDS = {
    "about", "after", "also", "and", "are", "been", "before", "being", "but", "can", "could",
    "does", "for", "from", "have", "into", "its", "not", "our", "that", "the", "their", "then",
    "there", "these", "this", "those", "was", "were", "what", "when", "where", "which", "with",
    "you", "your",
}


def sha256_text(value: str) -> str:
    return hashlib.sha256(value.encode("utf-8")).hexdigest()


def normalize_text(value: str) -> str:
    return value.replace("\r\n", "\n").replace("\r", "\n")


def chunk_text(value: str, *, chunk_size: int = CHUNK_SIZE, overlap: int = CHUNK_OVERLAP) -> list[dict[str, int | str]]:
    """Split normalized text into stable bounded windows, preferring line endings."""
    if not 128 <= chunk_size <= MAX_CHUNK_SIZE or not 0 <= overlap < chunk_size:
        raise ValueError("Chunk settings are outside the supported bounds")
    text = normalize_text(value)
    if not text:
        return []

    line_starts = [0]
    line_starts.extend(index + 1 for index, char in enumerate(text) if char == "\n")
    chunks: list[dict[str, int | str]] = []
    start = 0
    while start < len(text):
        hard_end = min(start + chunk_size, len(text))
        end = hard_end
        if hard_end < len(text):
            newline = text.rfind("\n", start + chunk_size // 2, hard_end)
            if newline >= 0:
                end = newline + 1
        if end <= start:
            end = min(start + chunk_size, len(text))
        content = text[start:end]
        if content:
            start_line = bisect_right(line_starts, start)
            end_line = max(start_line, bisect_right(line_starts, max(start, end - 1)))
            chunks.append({"content": content, "start_line": start_line, "end_line": end_line})
        if end >= len(text):
            break
        start = max(start + 1, end - overlap)
    return chunks


def query_terms(query: str) -> list[str]:
    if len(query) > MAX_QUERY_LENGTH:
        raise ValueError("Search query is too long")
    normalized = unicodedata.normalize("NFKC", query).casefold()
    terms = list(dict.fromkeys(term for term in _TOKEN.findall(normalized) if len(term) > 1 and term not in _STOP_WORDS))
    if not terms:
        raise ValueError("Enter at least one searchable word")
    if len(terms) > 12:
        raise ValueError("Search query has too many distinct terms")
    return terms


def score_chunk(content: str, query: str, terms: list[str], relative_path: str = "") -> float:
    normalized = unicodedata.normalize("NFKC", content).casefold()
    counts = {term: len(re.findall(rf"(?<!\w){re.escape(term)}(?!\w)", normalized)) for term in terms}
    present = sum(count > 0 for count in counts.values())
    if present != len(terms):
        return 0.0
    length_penalty = max(1.0, len(normalized) / 700)
    score = sum(min(count, 4) * (1.0 + 1.0 / (1.0 + len(term))) for term, count in counts.items()) / length_penalty
    score += 2.5
    normalized_query = unicodedata.normalize("NFKC", query).casefold().strip()
    if len(normalized_query) > 2 and normalized_query in normalized:
        score += 3.0
    path = unicodedata.normalize("NFKC", relative_path).casefold()
    score += 0.4 * sum(term in path for term in terms)
    return round(score, 6)


def make_excerpt(content: str, terms: list[str], limit: int = 600) -> str:
    text = content.strip()
    if len(text) <= limit:
        return text
    folded = text.casefold()
    positions = [folded.find(term.casefold()) for term in terms]
    positions = [position for position in positions if position >= 0]
    center = min(positions) if positions else 0
    start = max(0, min(center - limit // 3, len(text) - limit))
    excerpt = text[start:start + limit]
    return ("…" if start else "") + excerpt + ("…" if start + limit < len(text) else "")
