import json
import os
from binascii import Error as BinasciiError
from base64 import b64decode
from http import HTTPStatus
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from threading import Lock
from typing import Any

from langchain.agents import create_agent

from main import (
    build_model,
    build_tools,
    load_env_file,
    load_memory,
    pick_final_assistant_text,
    save_memory,
)

GENERAL_ASSISTANT_PROMPT = (
    "You are a helpful assistant. "
    "Use the weather tool for weather questions. "
    "When weather tool results are available, answer based on that data. "
    "Use Tavily search for questions that need current web information, recent facts, news, or source-backed answers. "
    "When search results are available, summarize them and include source URLs when helpful. "
    "For questions that do not need real-time external data, answer normally without using tools."
)

CHEF_ASSISTANT_PROMPT = """
你是一名私人厨师。收到用户提供的食材照片或清单后，请按以下流程操作：
1.识别和评估食材：若用户提供照片，首先辨识所有可见食材。基于食材的外观状态，评估其新鲜度与可用量，整理出一份“当前可用食材清单”。
2.智能食谱检索：优先调用 web_search 工具，以“可用食材清单”为核心关键词，查找可行菜谱。
3.多维度评估与排序：从营养价值和制作难度两个维度对检索到的候选食谱进行量化打分，并根据得分排序，制作简单且营养丰富的排名靠前。
4.结构化方案输出：把排序后的食谱整理为一份结构清晰的建议报告，要包含食谱信息、得分、推荐理由、食谱的参考图片，帮助用户快速做出决策。

请严格按照流程，优先调用 web_search 工具搜索食谱，搜索不到的情况下才能自己发挥。
""".strip()


class AgentService:
    def __init__(
        self,
        *,
        system_prompt: str,  # 当前 Agent 的系统提示词。
        memory_env_name: str,  # 记忆文件路径对应的环境变量名。
        default_memory_file: str,  # 环境变量未设置时使用的默认记忆文件名。
        provider_override: str | None = None,  # 可选：强制指定当前 Agent 使用的模型提供商。
        model_override: str | None = None,  # 可选：强制指定当前 Agent 使用的具体模型名。
    ) -> None:
        self.agent = create_agent(
            model=build_model(provider_override, model_override),
            tools=build_tools(),
            system_prompt=system_prompt,
        )
        self.memory_file = Path(
            os.getenv(memory_env_name, default_memory_file)
        )
        self.max_memory_messages = int(os.getenv("AGENT_MEMORY_MAX_MESSAGES", "40"))
        self.memory: list[dict[str, Any]] = load_memory(self.memory_file)
        # 线程锁 同一时间只允许一个线程进入临界区，避免多个线程同时改同一份数据导致冲突。
        self.lock = Lock()

    def ask(self, user_query: Any, memory_user_query: str | None = None) -> str:
        # 这里是临界区，同一时刻只有一个线程能执行
        with self.lock:
            messages = self.memory + [{"role": "user", "content": user_query}]
            response = self.agent.invoke({"messages": messages})
            response_messages = response.get("messages", [])
            assistant_text = pick_final_assistant_text(response_messages).strip()
            if not assistant_text:
                assistant_text = "这次模型返回了空内容，请稍后重试。"

            memory_content = (
                memory_user_query.strip()
                if isinstance(memory_user_query, str) and memory_user_query.strip()
                else str(user_query).strip()
            )
            self.memory.extend(
                [
                    {"role": "user", "content": memory_content},
                    {"role": "assistant", "content": assistant_text},
                ]
            )
            if len(self.memory) > self.max_memory_messages:
                # 只保留最近的记忆，避免上下文无限增长。-表示“从后往前数”[倒数第 max_memory_messages 条 : 最后一条]
                self.memory = self.memory[-self.max_memory_messages :]
            # 把最新记忆写回本地文件，保证服务重启后还能继续对话。
            save_memory(self.memory_file, self.memory)
            return assistant_text

load_env_file()

def resolve_chef_image_provider() -> str:
    configured = os.getenv("CHEF_IMAGE_PROVIDER", "anthropic").strip().lower()
    if configured == "anthropic" and os.getenv("ANTHROPIC_API_KEY"):
        return "anthropic"
    if configured == "openai" and os.getenv("OPENAI_API_KEY"):
        return "openai"

    default_provider = os.getenv("MODEL_PROVIDER", "anthropic").strip().lower()
    if default_provider == "anthropic" and os.getenv("ANTHROPIC_API_KEY"):
        return "anthropic"
    if default_provider == "openai" and os.getenv("OPENAI_API_KEY"):
        return "openai"

    return configured


CHEF_IMAGE_PROVIDER = resolve_chef_image_provider()
CHEF_IMAGE_MODEL = os.getenv("CHEF_IMAGE_MODEL", "").strip() or None
CHEF_IMAGE_MAX_BYTES = 5 * 1024 * 1024

SERVICES = {
    "/api/chat": AgentService(
        system_prompt=GENERAL_ASSISTANT_PROMPT,
        memory_env_name="AGENT_MEMORY_FILE",
        default_memory_file=".agent_memory.json",
    ),
    "/api/chef": AgentService(
        system_prompt=CHEF_ASSISTANT_PROMPT,
        memory_env_name="CHEF_AGENT_MEMORY_FILE",
        default_memory_file=".chef_agent_memory.json",
    ),
}

CHEF_IMAGE_SERVICE = AgentService(
    system_prompt=CHEF_ASSISTANT_PROMPT,
    memory_env_name="CHEF_AGENT_MEMORY_FILE",
    default_memory_file=".chef_agent_memory.json",
    provider_override=CHEF_IMAGE_PROVIDER,
    model_override=CHEF_IMAGE_MODEL,
)


def get_data_url_size_bytes(data_url: str) -> int:
    if "," not in data_url:
        raise ValueError("Invalid imageDataUrl format")

    _, encoded = data_url.split(",", 1)
    try:
        return len(b64decode(encoded, validate=True))
    except (BinasciiError, ValueError) as exc:
        raise ValueError("imageDataUrl is not valid base64 data") from exc


class RequestHandler(BaseHTTPRequestHandler):
    def _set_cors_headers(self) -> None:
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "POST, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")

    def _write_json(self, status: int, payload: dict[str, Any]) -> None:
        body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self._set_cors_headers()
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_OPTIONS(self) -> None:  # noqa: N802
        self.send_response(HTTPStatus.NO_CONTENT)
        self._set_cors_headers()
        self.end_headers()

    def do_POST(self) -> None:  # noqa: N802
        # 1. 先根据请求路径选中对应的服务实例。
        service = SERVICES.get(self.path)
        if service is None:
            self._write_json(HTTPStatus.NOT_FOUND, {"error": "Not found"})
            return

        try:
            # 2. 读取并解析请求体 JSON。
            content_length = int(self.headers.get("Content-Length", "0"))
            raw_body = self.rfile.read(content_length)
            payload = json.loads(raw_body.decode("utf-8") if raw_body else "{}")
        except json.JSONDecodeError:
            self._write_json(HTTPStatus.BAD_REQUEST, {"error": "Invalid JSON body"})
            return

        # 3. 提取文本和图片字段，供后续统一校验与分流。
        message = str(payload.get("message", "")).strip()
        image_data_url = str(payload.get("imageDataUrl", "")).strip()

        # 4. 文本和图片至少要提供一个。
        if not message and not image_data_url:
            self._write_json(
                HTTPStatus.BAD_REQUEST,
                {"error": "message or imageDataUrl is required"},
            )
            return

        # 5. AI 私厨图片请求先做 base64 格式和体积校验，避免上游模型直接报错。
        if self.path == "/api/chef" and image_data_url:
            try:
                image_size = get_data_url_size_bytes(image_data_url)
            except ValueError as exc:
                self._write_json(
                    HTTPStatus.BAD_REQUEST,
                    {"error": str(exc)},
                )
                return

            if image_size > CHEF_IMAGE_MAX_BYTES:
                self._write_json(
                    HTTPStatus.BAD_REQUEST,
                    {
                        "error": "imageDataUrl exceeds 5 MB maximum",
                        "detail": (
                            f"Received {image_size} bytes; please upload a smaller "
                            "image or compress it before retrying."
                        ),
                    },
                )
                return

        try:
            # 6. 默认按纯文本请求构造用户输入与记忆内容。
            user_query: Any = message
            memory_query = message or "用户上传了一张食材图片，请根据图片识别食材并给出推荐。"

            # 7. 如果是 AI 私厨图片请求，则把输入改造成多模态消息。
            if self.path == "/api/chef" and image_data_url:
                text_prompt = (
                    message
                    if message
                    else "请识别这张图片里的食材，并给出可行菜谱推荐。"
                )
                user_query = [
                    {"type": "text", "text": text_prompt},
                    {"type": "image_url", "image_url": {"url": image_data_url}},
                ]
                if message:
                    memory_query = f"{message}\n[用户附带了一张食材图片]"
                else:
                    memory_query = "用户上传了一张食材图片，请根据图片识别食材并给出推荐。"

            # 8. 按请求类型选择实际执行的 Agent 服务。
            active_service = (
                CHEF_IMAGE_SERVICE
                if self.path == "/api/chef" and image_data_url
                else service
            )

            # 9. 调用 Agent，拿到最终回答。
            answer = active_service.ask(user_query, memory_query)
            print('answer', answer)
        except Exception as exc:  # noqa: BLE001
            error_detail = str(exc)
            if (
                "responses stream failed" in error_detail.lower()
                and os.getenv("OPENAI_BASE_URL")
            ):
                error_detail = (
                    f"{error_detail} "
                    "Detected a custom OPENAI_BASE_URL. "
                    "This gateway may not fully support the OpenAI Responses API stream. "
                    "Try OPENAI_USE_RESPONSES_API=false and OPENAI_DISABLE_STREAMING=true."
                )
            self._write_json(
                HTTPStatus.INTERNAL_SERVER_ERROR,
                {"error": "Agent invocation failed", "detail": error_detail},
            )
            return

        # 10. 把最终回答返回给前端。
        self._write_json(HTTPStatus.OK, {"answer": answer})

    def log_message(self, format: str, *args: Any) -> None:
        return


def main() -> None:
    host = os.getenv("AGENT_API_HOST", "127.0.0.1")
    port = int(os.getenv("AGENT_API_PORT", "8000"))
    server = ThreadingHTTPServer((host, port), RequestHandler)
    print(f"Agent API listening on http://{host}:{port}")
    server.serve_forever()


if __name__ == "__main__":
    main()
