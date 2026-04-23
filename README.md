# Learn-about-AI

一个基于 LangChain 的小型 Agent 示例项目，支持：
- OpenAI / Anthropic 双模型切换
- 天气工具调用（`main.py`）
- Tavily 实时网页搜索（`main.py`）
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

USE_MOCK_SEARCH=true
TAVILY_API_KEY=
AGENT_MEMORY_FILE=.agent_memory.json
AGENT_MEMORY_MAX_MESSAGES=40
AGENT_DEBUG=false

USER_QUERY=北京今天天气如何？
```

## 运行方式

### 运行主脚本（天气与网页搜索 Agent）

```bash
uv run python main.py
```

行为说明：
- 设置 `TAVILY_API_KEY` 后，`main.py` 会启用 Tavily 实时网页搜索工具
- 若设置了 `USER_QUERY`，会执行一次问答后退出
- 若没有设置 `USER_QUERY`，会进入交互模式（输入 `exit` 或 `quit` 退出）
- 交互模式会自动记录对话记忆到 `AGENT_MEMORY_FILE`（默认 `.agent_memory.json`）
- 可通过 `AGENT_MEMORY_MAX_MESSAGES` 控制保留的历史消息条数（默认 `40`）
- 在交互模式输入 `/memory clear` 可清空记忆
- 设置 `AGENT_DEBUG=true` 可打印工具加载、调用消息数量与返回消息摘要，便于排查 Tavily/网关问题

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

## 常见问题

`OPENAI_API_KEY is not set`：
- 当 `MODEL_PROVIDER=openai` 时必须设置 `OPENAI_API_KEY`

`ANTHROPIC_API_KEY is not set`：
- 当 `MODEL_PROVIDER=anthropic` 时必须设置 `ANTHROPIC_API_KEY`

`TAVILY_API_KEY is not set`：
- 若希望 `main.py` 启用实时网页搜索，请设置 `TAVILY_API_KEY`
- 运行 `main copy.py` 且 `USE_MOCK_SEARCH=false` 时也需要设置 `TAVILY_API_KEY`
