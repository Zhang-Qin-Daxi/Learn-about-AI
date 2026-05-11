# Learn-about-AI

一个基于 LangChain 的小型 Agent 示例项目，支持：
- OpenAI / Anthropic 双模型切换
- 天气工具调用（`main.py`）
- Tavily 实时网页搜索（`main.py`）
- 本地知识库 RAG 检索（`rag.py` + `knowledge_base/`）
- Mock 搜索与 Tavily 搜索切换（`main copy.py`）

## 环境要求

- Python `>=3.14`（见 `pyproject.toml`）
- `uv`（推荐用来安装依赖和运行）

## 快速开始

1. 安装依赖

```bash
uv sync
```

2. 配置环境变量

项目根目录已提供 `.env` 模板，请至少填写一个可用 Key：

```env
MODEL_PROVIDER=anthropic

ANTHROPIC_API_KEY=
ANTHROPIC_MODEL=claude-sonnet-4-6

OPENAI_API_KEY=
OPENAI_MODEL=gpt-5.4
# 常见 OpenAI 兼容网关地址形态: http://host:port/v1
OPENAI_BASE_URL=
# 自定义 OpenAI 兼容网关推荐关闭 Responses API / 流式输出
OPENAI_USE_RESPONSES_API=false
OPENAI_DISABLE_STREAMING=true

USE_MOCK_SEARCH=true
TAVILY_API_KEY=
AGENT_MEMORY_FILE=.agent_memory.json
AGENT_MEMORY_MAX_MESSAGES=40
AGENT_DEBUG=false
RAG_KNOWLEDGE_DIR=knowledge_base
RAG_CHUNK_SIZE=700
RAG_CHUNK_OVERLAP=120
RAG_TOP_K=4
RAG_MIN_SCORE=1.2

USER_QUERY=北京今天天气如何？
```

## 运行方式

### 运行主脚本（天气与网页搜索 Agent）

```bash
uv run python main.py
```

行为说明：
- 若项目根目录存在 `knowledge_base/`，Agent 会自动启用本地知识库检索工具
- 设置 `TAVILY_API_KEY` 后，`main.py` 会启用 Tavily 实时网页搜索工具
- 若设置了 `USER_QUERY`，会执行一次问答后退出
- 若没有设置 `USER_QUERY`，会进入交互模式（输入 `exit` 或 `quit` 退出）
- 交互模式会自动记录对话记忆到 `AGENT_MEMORY_FILE`（默认 `.agent_memory.json`）
- 可通过 `AGENT_MEMORY_MAX_MESSAGES` 控制保留的历史消息条数（默认 `40`）
- 在交互模式输入 `/memory clear` 可清空记忆
- 设置 `AGENT_DEBUG=true` 可打印工具加载、调用消息数量与返回消息摘要，便于排查 Tavily/网关问题
- 当问题属于项目内部文档、私有资料、FAQ、规则说明等内容时，Agent 会优先检索本地知识库并在回答中引用来源路径

你也可以直接在命令行传入问题：

```bash
uv run python main.py "上海现在天气如何？"
```

### 运行备用脚本（搜索 Agent）

```bash
uv run python "main copy.py"
```

行为说明：
- `USE_MOCK_SEARCH=true` 时使用内置模拟搜索
- `USE_MOCK_SEARCH=false` 时需要设置 `TAVILY_API_KEY`

## 前端页面 + API（Next.js 交互）

### 启动 Python API

在项目根目录运行：

```bash
uv run python api_server.py
```

默认监听地址：

- `http://127.0.0.1:8000`
- 接口：`POST /api/chat`
- 请求体示例：`{"message":"北京今天天气如何？"}`
- 响应体示例：`{"answer":"..."}` 

可选环境变量：

- `AGENT_API_HOST`（默认 `127.0.0.1`）
- `AGENT_API_PORT`（默认 `8000`）

### 启动 Next.js 前端

```bash
cd next-ui
bun install
bun run dev
```

默认访问：

- `http://localhost:3001`

前端通过 `NEXT_PUBLIC_API_BASE_URL` 指向 Python API，示例见：

- `next-ui/.env.local.example`

## 知识库 RAG

项目根目录下的 `knowledge_base/` 会被自动扫描并作为本地知识库。

当前支持的文件类型：

- `md`
- `txt`
- `rst`
- `json`
- `csv`

推荐使用方式：

1. 把你的业务文档、FAQ、产品说明、部署说明等放进 `knowledge_base/`
2. 重新发起一次提问即可，无需手动建索引
3. 提问示例：`请根据知识库总结当前项目的后端结构`

实现说明：

- `rag.py` 会自动切分文档 chunk
- 使用轻量 BM25 风格的词法检索做召回
- Agent 通过 `search_knowledge_base` 工具拿到相关片段后再生成最终答案

## 常见问题

`OPENAI_API_KEY is not set`：
- 当 `MODEL_PROVIDER=openai` 时必须设置 `OPENAI_API_KEY`

`ANTHROPIC_API_KEY is not set`：
- 当 `MODEL_PROVIDER=anthropic` 时必须设置 `ANTHROPIC_API_KEY`

`TAVILY_API_KEY is not set`：
- 若希望 `main.py` 启用实时网页搜索，请设置 `TAVILY_API_KEY`
- 运行 `main copy.py` 且 `USE_MOCK_SEARCH=false` 时也需要设置 `TAVILY_API_KEY`

`OpenAI responses stream failed`：
- 如果你配置了 `OPENAI_BASE_URL` 指向第三方 OpenAI 兼容网关，这通常表示网关对 Responses API 流式协议支持不完整
- 优先设置 `OPENAI_USE_RESPONSES_API=false`
- 同时设置 `OPENAI_DISABLE_STREAMING=true`
- 多数兼容网关只对 `/chat/completions` 更稳定
