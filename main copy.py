import os
from pathlib import Path

from langchain.agents import create_agent
from langchain.chat_models import init_chat_model
from langchain.tools import tool
from langchain_tavily import TavilySearch


def load_env_file(path: str = ".env") -> None:
    env_path = Path(path)
    if not env_path.exists():
        return

    for raw_line in env_path.read_text().splitlines():
        line = raw_line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue

        key, value = line.split("=", 1)
        os.environ.setdefault(key.strip(), value.strip().strip("\"'"))


@tool
def mock_search(query: str) -> str:
    """Return mocked search results for demo purposes."""
    return (
        f"Mock search results for query: {query}\n"
        "1. Beijing weather today: sunny to cloudy, around 18C to 26C.\n"
        "2. Air quality: moderate.\n"
        "3. Suggested summary: It is suitable for outdoor activities, "
        "but a light jacket may be useful in the evening.\n"
        "4. Source note: these are simulated results for agent testing only."
    )


def main() -> None:
    load_env_file()

    api_key = os.getenv("OPENAI_API_KEY")
    if not api_key:
        raise RuntimeError("OPENAI_API_KEY is not set. Please add it to .env.")

    model_name = os.getenv("OPENAI_MODEL", "gpt-5.2")
    base_url = os.getenv("OPENAI_BASE_URL")
    use_mock_search = os.getenv("USE_MOCK_SEARCH", "true").lower() == "true"
    tavily_api_key = os.getenv("TAVILY_API_KEY")

    model_kwargs = {}
    if base_url:
        model_kwargs["base_url"] = base_url

    model = init_chat_model(model_name, model_provider="openai", **model_kwargs)
    if use_mock_search:
        search_tool = mock_search
    elif tavily_api_key:
        search_tool = TavilySearch(
            max_results=5,
            topic="general",
        )
    else:
        raise RuntimeError(
            "TAVILY_API_KEY is not set. Add it to .env or set USE_MOCK_SEARCH=true."
        )

    agent = create_agent(
        model=model,
        tools=[search_tool],
        system_prompt=(
            "You are a helpful research assistant. "
            "When the user asks for current or factual external information, "
            "use the search tool before answering. "
            "If the tool returns simulated results, clearly say the answer is based "
            "on mocked search data. Cite the search findings in your answer when helpful."
        ),
    )

    user_query = os.getenv("USER_QUERY", "今天北京天气怎么样？请给出简明结论和依据。")
    result = agent.invoke({"messages": [{"role": "user", "content": user_query}]})
    final_message = result["messages"][-1]
    print(final_message.content)


if __name__ == "__main__":
    main()
