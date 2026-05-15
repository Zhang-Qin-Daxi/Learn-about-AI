# Python 标准库，解析和格式化 JSON 文件内容。
import json
# Python 标准库，用来计算 BM25 打分中的对数 idf。
import math
# Python 标准库，用来读取环境变量配置。
import os
# re：Python 标准库，用来用正则表达式做分词和中文判断。
import re
# Counter：标准库 collections 中的计数器，用来统计 token 词频和文档频率。
from collections import Counter
# dataclass：标准库 dataclasses 中的装饰器，用来快速定义只存数据的类。
from dataclasses import dataclass
# lru_cache：标准库 functools 中的缓存装饰器，用来复用默认知识库实例。
from functools import lru_cache
# pathlib 中的路径对象，比字符串路径更方便安全。
from pathlib import Path
# 线程锁，用来避免并发重复重建索引。
from threading import Lock

# tool：LangChain 提供的装饰器，用来把函数包装成可被 Agent 调用的工具。
from langchain.tools import tool

# 执行顺序总览：
# 1. 应用调用 get_default_knowledge_base()，读取环境变量并创建 LocalKnowledgeBase。
# 2. 应用调用 knowledge_base.as_tool()，把 search_knowledge_base 暴露给 LangChain Agent。
# 3. Agent 调用 search_knowledge_base(query)，内部进入 LocalKnowledgeBase.search(query)。
# 4. search() 先调用 _ensure_index()，必要时扫描知识库并重建索引。
# 5. _rebuild_index() 读取文件、提取标题、切分 chunk、分词并统计词频。
# 6. search() 对 query 分词，然后用 _score_chunk() 给每个 chunk 打分。
# 7. search() 按分数排序返回 top_k，search_knowledge_base() 再格式化成工具输出。

SUPPORTED_KNOWLEDGE_EXTENSIONS = {
    ".md",
    ".markdown",
    ".txt",
    ".rst",
    ".json",
    ".csv",
}
# 同时支持英文/数字词和连续中文字符，方便对中英文资料做统一检索。
TOKEN_PATTERN = re.compile(r"[A-Za-z0-9_]+|[\u4e00-\u9fff]+")

# KnowledgeChunk 是一个可以创建对象的类 @dataclass 根据这些字段生成构造函数  slots=True 固定字段
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
    """把文本切成用于检索的 token，中文额外加入单字和二字词。"""
    tokens: list[str] = []
    for match in TOKEN_PATTERN.finditer(text.lower()):
        value = match.group(0)
        if re.fullmatch(r"[\u4e00-\u9fff]+", value):
            # 中文没有天然空格，这里同时保留单字和 双字母组，提高短查询命中率。
            tokens.extend(list(value))
            if len(value) > 1:
                tokens.extend(value[idx : idx + 2] for idx in range(len(value) - 1))
            continue
        tokens.append(value)
    return tokens


def split_text(text: str, chunk_size: int, overlap: int) -> list[str]:
    """按固定大小切分文本，并尽量在段落、换行或句号处断开。"""
    normalized = text.replace("\r\n", "\n").strip()
    if not normalized:
        return []

    chunks: list[str] = []
    cursor = 0

    while cursor < len(normalized):
        end = min(len(normalized), cursor + chunk_size)
        if end < len(normalized):
            # 优先选择自然边界，减少把一段语义切断在中间的概率。
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
        # 保留部分重叠内容，让跨 chunk 的上下文仍有机会被检索到。
        cursor = max(cursor + 1, end - overlap)

    return chunks


def extract_title(text: str, fallback: str) -> str:
    """从文档第一行或 Markdown 标题中提取展示标题。"""
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
        # top_k：搜索时最多返回多少条最相关的结果。
        top_k: int = 4,
        # min_score：相关性分数低于这个值的结果会被过滤掉。
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
        # 索引可能在多次 tool 调用中被懒加载，锁用于避免并发重复重建。
        self._lock = Lock()

    @property
    def is_enabled(self) -> bool:
        return self.root.exists() and self.root.is_dir()

    def has_documents(self) -> bool:
        # 执行顺序 4 的轻量入口：先确保索引可用，再判断是否有文档。
        self._ensure_index()
        return bool(self._chunks)

    def search(self, query: str) -> list[SearchResult]:
        # 执行顺序 3：真正处理一次用户查询的入口。
        """在本地知识库中搜索最相关的文本片段。"""
        # 执行顺序 4：检索前先确认索引是最新的。
        self._ensure_index()
        if not query.strip() or not self._chunks:
            return []

        # 执行顺序 6.1：把用户查询转成 token，并统计查询词频。
        query_tokens = tokenize(query)
        if not query_tokens:
            return []

        query_terms = Counter(query_tokens)
        total_chunks = len(self._chunks)
        scored_results: list[SearchResult] = []

        for chunk in self._chunks:
            # 执行顺序 6.2：逐个 chunk 计算相关性分数。
            score = self._score_chunk(chunk, query_terms, total_chunks)
            # 对完整短语和标题命中做轻量加分，弥补纯 token 打分的不足。
            if query.strip().lower() in chunk.content.lower():
                score += 1.5
            if any(term in chunk.title.lower() for term in query_terms):
                score += 0.4
            if score >= self.min_score:
                # 只有超过最低相关性门槛的 chunk 才会进入候选结果。
                scored_results.append(
                    SearchResult(
                        source=chunk.source,
                        title=chunk.title,
                        content=chunk.content,
                        score=score,
                    )
                )

        # 执行顺序 7：按相关性排序，只返回前 top_k 条，避免输出过多上下文。
        scored_results.sort(key=lambda item: item.score, reverse=True)
        return scored_results[: self.top_k]

    def as_tool(self):
        # 执行顺序 2：把本地搜索函数注册成 Agent 可调用的工具。
        """把知识库搜索能力包装成 LangChain tool。"""
        if not self.is_enabled:
            return None

        @tool("search_knowledge_base")
        def search_knowledge_base(query: str) -> str:
            # 执行顺序 3：Agent 调用工具时，会从这里进入 search()。
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
                # 执行顺序 7：把检索结果整理成大模型容易引用的文本格式。
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
        # 执行顺序 4：检查知识库是否存在、文件是否变化，以及是否需要重建索引。
        """在知识库文件变化时重建索引，否则复用已有索引。"""
        if not self.is_enabled:
            self._chunks = []
            self._doc_freq = Counter()
            self._avg_chunk_length = 1.0
            self._signature = ()
            return

        signature = self._build_signature()
        if signature == self._signature:
            # 文件签名没变化，说明已有索引仍可复用。
            return

        with self._lock:
            # 进入锁后再次检查，避免其他线程已经完成重建。
            signature = self._build_signature()
            if signature == self._signature:
                return
            # 文件签名变化，进入完整索引重建流程。
            self._rebuild_index(signature)

    def _build_signature(self) -> tuple[tuple[str, int, int], ...]:
        # 执行顺序 4.1：生成当前知识库文件状态的快照。
        """用相对路径、修改时间和文件大小判断知识库是否变化。"""
        records: list[tuple[str, int, int]] = []
        for path in self._iter_files():
            stat = path.stat()
            relative_path = str(path.relative_to(self.root))
            records.append((relative_path, stat.st_mtime_ns, stat.st_size))
        return tuple(records)

    def _iter_files(self):
        # 执行顺序 4.2 / 5.1：为签名生成和索引重建提供文件列表。
        """遍历所有支持格式的知识库文件。"""
        for path in sorted(self.root.rglob("*")):
            if not path.is_file():
                continue
            if path.suffix.lower() not in SUPPORTED_KNOWLEDGE_EXTENSIONS:
                continue
            yield path

    def _rebuild_index(self, signature: tuple[tuple[str, int, int], ...]) -> None:
        # 执行顺序 5：重建索引的核心流程。
        """读取知识库文件，切成 chunk，并统计 BM25 所需的词频信息。"""
        chunks: list[KnowledgeChunk] = []
        doc_freq: Counter[str] = Counter()

        for file_index, path in enumerate(self._iter_files()):
            # 执行顺序 5.2：读取每个知识库文件。
            text = self._read_text(path)
            if not text.strip():
                continue

            relative_path = str(path.relative_to(self.root))
            # 执行顺序 5.3：提取这个文件的展示标题。
            title = extract_title(text, path.stem)
            for chunk_index, chunk_text in enumerate(
                # 执行顺序 5.4：把长文档切成可检索的小片段。
                split_text(text, self.chunk_size, self.chunk_overlap)
            ):
                # 执行顺序 5.5：给每个 chunk 分词并统计词频。
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

        # 执行顺序 5.6：把新索引一次性替换到实例上。
        self._chunks = chunks
        self._doc_freq = doc_freq
        self._avg_chunk_length = (
            sum(chunk.token_length for chunk in chunks) / len(chunks) if chunks else 1.0
        )
        self._signature = signature

    def _read_text(self, path: Path) -> str:
        # 执行顺序 5.2 的细节：把单个文件读成字符串。
        """读取文本文件；JSON 会格式化后再进入索引，便于检索结构化内容。"""
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
        # 执行顺序 6.2 的细节：BM25 负责给 query 和 chunk 的匹配程度打分。
        """使用 BM25 思路计算 query 与单个 chunk 的相关性。"""
        score = 0.0
        k1 = 1.5
        b = 0.75

        for term, query_tf in query_terms.items():
            tf = chunk.token_counts.get(term, 0)
            if tf == 0:
                continue

            df = self._doc_freq.get(term, 0)
            # idf 越高，说明词越稀有，对相关性的贡献越大。
            idf = math.log(1 + (total_chunks - df + 0.5) / (df + 0.5))
            # BM25 会根据 chunk 长度做归一化，避免长文本天然占优势。
            denominator = tf + k1 * (
                1 - b + b * (chunk.token_length / max(self._avg_chunk_length, 1.0))
            )
            score += query_tf * idf * ((tf * (k1 + 1)) / denominator)

        return score


# lru_cache(maxsize=1)：第一次执行时会真正创建一个 LocalKnowledgeBase 对象；之后再调用这个函数，不会重新创建，而是直接返回第一次创建好的那个对象。
# maxsize=1 表示最多只缓存 1 个结果。因为这个函数没有参数，所以刚好只需要缓存一个默认知识库实例。
@lru_cache(maxsize=1)
def get_default_knowledge_base() -> LocalKnowledgeBase:
    # 执行顺序 1：应用启动或需要 RAG 时，通常先调用这个函数拿到知识库实例。
    """从环境变量创建默认知识库实例，并缓存起来供应用复用。"""
    root = Path(os.getenv("RAG_KNOWLEDGE_DIR", "knowledge_base"))
    chunk_size = int(os.getenv("RAG_CHUNK_SIZE", "700"))
    chunk_overlap = int(os.getenv("RAG_CHUNK_OVERLAP", "120"))
    # RAG_TOP_K：控制一次搜索最多返回几条结果。
    top_k = int(os.getenv("RAG_TOP_K", "4"))
    # RAG_MIN_SCORE：控制结果进入候选列表的最低相关性分数，太不相关的不要给我。
    min_score = float(os.getenv("RAG_MIN_SCORE", "1.2"))
    return LocalKnowledgeBase(
        root=root,
        chunk_size=chunk_size,
        chunk_overlap=chunk_overlap,
        top_k=top_k,
        min_score=min_score,
    )
