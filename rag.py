import json
import math
import os
import re
from collections import Counter
from dataclasses import dataclass
from functools import lru_cache
from pathlib import Path
from threading import Lock

from langchain.tools import tool

SUPPORTED_KNOWLEDGE_EXTENSIONS = {
    ".md",
    ".markdown",
    ".txt",
    ".rst",
    ".json",
    ".csv",
}
TOKEN_PATTERN = re.compile(r"[A-Za-z0-9_]+|[\u4e00-\u9fff]+")


@dataclass(slots=True)
class KnowledgeChunk:
    chunk_id: str
    source: str
    title: str
    content: str
    token_counts: Counter[str]
    token_length: int


@dataclass(slots=True)
class SearchResult:
    source: str
    title: str
    content: str
    score: float


def tokenize(text: str) -> list[str]:
    tokens: list[str] = []
    for match in TOKEN_PATTERN.finditer(text.lower()):
        value = match.group(0)
        if re.fullmatch(r"[\u4e00-\u9fff]+", value):
            tokens.extend(list(value))
            if len(value) > 1:
                tokens.extend(value[idx : idx + 2] for idx in range(len(value) - 1))
            continue
        tokens.append(value)
    return tokens


def split_text(text: str, chunk_size: int, overlap: int) -> list[str]:
    normalized = text.replace("\r\n", "\n").strip()
    if not normalized:
        return []

    chunks: list[str] = []
    cursor = 0

    while cursor < len(normalized):
        end = min(len(normalized), cursor + chunk_size)
        if end < len(normalized):
            paragraph_break = normalized.rfind("\n\n", cursor, end)
            line_break = normalized.rfind("\n", cursor, end)
            sentence_break = max(
                normalized.rfind("。", cursor, end),
                normalized.rfind("！", cursor, end),
                normalized.rfind("？", cursor, end),
                normalized.rfind(".", cursor, end),
            )
            best_break = max(paragraph_break, line_break, sentence_break)
            if best_break > cursor + chunk_size // 2:
                end = best_break

        chunk = normalized[cursor:end].strip()
        if chunk:
            chunks.append(chunk)
        if end >= len(normalized):
            break
        cursor = max(cursor + 1, end - overlap)

    return chunks


def extract_title(text: str, fallback: str) -> str:
    for raw_line in text.splitlines():
        line = raw_line.strip()
        if not line:
            continue
        if line.startswith("#"):
            return line.lstrip("#").strip() or fallback
        return line[:80]
    return fallback


class LocalKnowledgeBase:
    def __init__(
        self,
        root: Path,
        *,
        chunk_size: int = 700,
        chunk_overlap: int = 120,
        top_k: int = 4,
        min_score: float = 1.2,
    ) -> None:
        self.root = root
        self.chunk_size = chunk_size
        self.chunk_overlap = chunk_overlap
        self.top_k = top_k
        self.min_score = min_score
        self._signature: tuple[tuple[str, int, int], ...] = ()
        self._chunks: list[KnowledgeChunk] = []
        self._doc_freq: Counter[str] = Counter()
        self._avg_chunk_length = 1.0
        self._lock = Lock()

    @property
    def is_enabled(self) -> bool:
        return self.root.exists() and self.root.is_dir()

    def has_documents(self) -> bool:
        self._ensure_index()
        return bool(self._chunks)

    def search(self, query: str) -> list[SearchResult]:
        self._ensure_index()
        if not query.strip() or not self._chunks:
            return []

        query_tokens = tokenize(query)
        if not query_tokens:
            return []

        query_terms = Counter(query_tokens)
        total_chunks = len(self._chunks)
        scored_results: list[SearchResult] = []

        for chunk in self._chunks:
            score = self._score_chunk(chunk, query_terms, total_chunks)
            if query.strip().lower() in chunk.content.lower():
                score += 1.5
            if any(term in chunk.title.lower() for term in query_terms):
                score += 0.4
            if score >= self.min_score:
                scored_results.append(
                    SearchResult(
                        source=chunk.source,
                        title=chunk.title,
                        content=chunk.content,
                        score=score,
                    )
                )

        scored_results.sort(key=lambda item: item.score, reverse=True)
        return scored_results[: self.top_k]

    def as_tool(self):
        if not self.is_enabled:
            return None

        @tool("search_knowledge_base")
        def search_knowledge_base(query: str) -> str:
            """Search the local knowledge base for internal documents, project rules, product docs, or private notes."""
            matches = self.search(query)
            if not matches:
                return (
                    "No relevant passages were found in the local knowledge base. "
                    "If needed, answer from general knowledge or use other tools."
                )

            parts = [
                "Retrieved passages from the local knowledge base. "
                "Base the answer on these passages and cite the source path when relevant."
            ]
            for index, match in enumerate(matches, start=1):
                parts.append(
                    "\n".join(
                        [
                            f"[{index}] Source: {match.source}",
                            f"Title: {match.title}",
                            f"Relevance score: {match.score:.2f}",
                            "Content:",
                            match.content,
                        ]
                    )
                )
            return "\n\n".join(parts)

        return search_knowledge_base

    def _ensure_index(self) -> None:
        if not self.is_enabled:
            self._chunks = []
            self._doc_freq = Counter()
            self._avg_chunk_length = 1.0
            self._signature = ()
            return

        signature = self._build_signature()
        if signature == self._signature:
            return

        with self._lock:
            signature = self._build_signature()
            if signature == self._signature:
                return
            self._rebuild_index(signature)

    def _build_signature(self) -> tuple[tuple[str, int, int], ...]:
        records: list[tuple[str, int, int]] = []
        for path in self._iter_files():
            stat = path.stat()
            relative_path = str(path.relative_to(self.root))
            records.append((relative_path, stat.st_mtime_ns, stat.st_size))
        return tuple(records)

    def _iter_files(self):
        for path in sorted(self.root.rglob("*")):
            if not path.is_file():
                continue
            if path.suffix.lower() not in SUPPORTED_KNOWLEDGE_EXTENSIONS:
                continue
            yield path

    def _rebuild_index(self, signature: tuple[tuple[str, int, int], ...]) -> None:
        chunks: list[KnowledgeChunk] = []
        doc_freq: Counter[str] = Counter()

        for file_index, path in enumerate(self._iter_files()):
            text = self._read_text(path)
            if not text.strip():
                continue

            relative_path = str(path.relative_to(self.root))
            title = extract_title(text, path.stem)
            for chunk_index, chunk_text in enumerate(
                split_text(text, self.chunk_size, self.chunk_overlap)
            ):
                tokens = tokenize(chunk_text)
                if not tokens:
                    continue
                token_counts = Counter(tokens)
                chunks.append(
                    KnowledgeChunk(
                        chunk_id=f"{file_index}-{chunk_index}",
                        source=relative_path,
                        title=title,
                        content=chunk_text,
                        token_counts=token_counts,
                        token_length=len(tokens),
                    )
                )
                doc_freq.update(token_counts.keys())

        self._chunks = chunks
        self._doc_freq = doc_freq
        self._avg_chunk_length = (
            sum(chunk.token_length for chunk in chunks) / len(chunks) if chunks else 1.0
        )
        self._signature = signature

    def _read_text(self, path: Path) -> str:
        try:
            raw_text = path.read_text(encoding="utf-8")
        except OSError:
            return ""
        except UnicodeDecodeError:
            raw_text = path.read_text(encoding="utf-8", errors="ignore")

        if path.suffix.lower() == ".json":
            try:
                return json.dumps(json.loads(raw_text), ensure_ascii=False, indent=2)
            except json.JSONDecodeError:
                return raw_text
        return raw_text

    def _score_chunk(
        self,
        chunk: KnowledgeChunk,
        query_terms: Counter[str],
        total_chunks: int,
    ) -> float:
        score = 0.0
        k1 = 1.5
        b = 0.75

        for term, query_tf in query_terms.items():
            tf = chunk.token_counts.get(term, 0)
            if tf == 0:
                continue

            df = self._doc_freq.get(term, 0)
            idf = math.log(1 + (total_chunks - df + 0.5) / (df + 0.5))
            denominator = tf + k1 * (
                1 - b + b * (chunk.token_length / max(self._avg_chunk_length, 1.0))
            )
            score += query_tf * idf * ((tf * (k1 + 1)) / denominator)

        return score


@lru_cache(maxsize=1)
def get_default_knowledge_base() -> LocalKnowledgeBase:
    root = Path(os.getenv("RAG_KNOWLEDGE_DIR", "knowledge_base"))
    chunk_size = int(os.getenv("RAG_CHUNK_SIZE", "700"))
    chunk_overlap = int(os.getenv("RAG_CHUNK_OVERLAP", "120"))
    top_k = int(os.getenv("RAG_TOP_K", "4"))
    min_score = float(os.getenv("RAG_MIN_SCORE", "1.2"))
    return LocalKnowledgeBase(
        root=root,
        chunk_size=chunk_size,
        chunk_overlap=chunk_overlap,
        top_k=top_k,
        min_score=min_score,
    )
