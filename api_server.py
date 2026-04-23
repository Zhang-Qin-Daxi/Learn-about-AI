import json
import os
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


class AgentService:
    def __init__(self) -> None:
        load_env_file()
        self.agent = create_agent(
            model=build_model(),
            tools=build_tools(),
            system_prompt=(
                "You are a helpful assistant. "
                "Use the weather tool for weather questions. "
                "When weather tool results are available, answer based on that data. "
                "Use Tavily search for questions that need current web information, recent facts, news, or source-backed answers. "
                "When search results are available, summarize them and include source URLs when helpful. "
                "For questions that do not need real-time external data, answer normally without using tools."
            ),
        )
        self.memory_file = Path(os.getenv("AGENT_MEMORY_FILE", ".agent_memory.json"))
        self.max_memory_messages = int(os.getenv("AGENT_MEMORY_MAX_MESSAGES", "40"))
        self.memory: list[dict[str, str]] = load_memory(self.memory_file)
        self.lock = Lock()

    def ask(self, user_query: str) -> str:
        with self.lock:
            messages = self.memory + [{"role": "user", "content": user_query}]
            response = self.agent.invoke({"messages": messages})
            response_messages = response.get("messages", [])
            assistant_text = pick_final_assistant_text(response_messages).strip()
            if not assistant_text:
                assistant_text = "这次模型返回了空内容，请稍后重试。"

            self.memory.extend(
                [
                    {"role": "user", "content": user_query},
                    {"role": "assistant", "content": assistant_text},
                ]
            )
            if len(self.memory) > self.max_memory_messages:
                self.memory = self.memory[-self.max_memory_messages :]
            save_memory(self.memory_file, self.memory)
            return assistant_text


SERVICE = AgentService()


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
        if self.path != "/api/chat":
            self._write_json(HTTPStatus.NOT_FOUND, {"error": "Not found"})
            return

        try:
            content_length = int(self.headers.get("Content-Length", "0"))
            raw_body = self.rfile.read(content_length)
            payload = json.loads(raw_body.decode("utf-8") if raw_body else "{}")
        except json.JSONDecodeError:
            self._write_json(HTTPStatus.BAD_REQUEST, {"error": "Invalid JSON body"})
            return

        message = str(payload.get("message", "")).strip()
        if not message:
            self._write_json(HTTPStatus.BAD_REQUEST, {"error": "message is required"})
            return

        try:
            answer = SERVICE.ask(message)
        except Exception as exc:  # noqa: BLE001
            self._write_json(
                HTTPStatus.INTERNAL_SERVER_ERROR,
                {"error": "Agent invocation failed", "detail": str(exc)},
            )
            return

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
