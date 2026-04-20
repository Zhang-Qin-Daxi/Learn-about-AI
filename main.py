import os
from pathlib import Path
from urllib.error import HTTPError, URLError
from urllib.parse import quote
from urllib.request import urlopen
import json

from langchain.agents import create_agent
from langchain.chat_models import init_chat_model
from langchain.tools import tool


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
def get_weather(location: str) -> str:
    """Fetch real-time weather data for the requested location."""
    encoded_location = quote(location)
    weather_url = f"https://wttr.in/{encoded_location}?format=j1"

    try:
        with urlopen(weather_url, timeout=10) as response:
            payload = json.loads(response.read().decode("utf-8"))
    except HTTPError as exc:
        return f"Failed to fetch weather for {location}: weather service returned HTTP {exc.code}."
    except URLError as exc:
        return f"Failed to fetch weather for {location}: network error: {exc.reason}."
    except TimeoutError:
        return f"Failed to fetch weather for {location}: request timed out."
    except json.JSONDecodeError:
        return f"Failed to fetch weather for {location}: invalid weather response."

    current = payload.get("current_condition", [])
    if not current:
        return f"Failed to fetch weather for {location}: missing current weather data."

    current_data = current[0]
    resolved_area = payload.get("nearest_area", [{}])[0].get("areaName", [{}])[0].get("value", location)
    description = current_data.get("weatherDesc", [{}])[0].get("value", "Unknown")
    temperature_c = current_data.get("temp_C", "Unknown")
    feels_like_c = current_data.get("FeelsLikeC", "Unknown")
    humidity = current_data.get("humidity", "Unknown")
    wind_kph = current_data.get("windspeedKmph", "Unknown")
    observation_time = current_data.get("localObsDateTime", "Unknown")

    return (
        f"Real-time weather for {resolved_area}: {description}. "
        f"Temperature: {temperature_c}C, feels like {feels_like_c}C, "
        f"humidity: {humidity}%, wind speed: {wind_kph} km/h. "
        f"Observation time: {observation_time}. Source: wttr.in"
    )


def build_model():
    provider = os.getenv("MODEL_PROVIDER", "anthropic").strip().lower()

    if provider == "openai":
        api_key = os.getenv("OPENAI_API_KEY")
        if not api_key:
            raise RuntimeError("OPENAI_API_KEY is not set. Please add it to .env.")

        model_name = os.getenv("OPENAI_MODEL", "gpt-5.2")
        base_url = os.getenv("OPENAI_BASE_URL")
        model_kwargs = {}
        if base_url:
            model_kwargs["base_url"] = base_url

        return init_chat_model(model_name, model_provider="openai", **model_kwargs)

    if provider == "anthropic":
        api_key = os.getenv("ANTHROPIC_API_KEY")
        if not api_key:
            raise RuntimeError("ANTHROPIC_API_KEY is not set. Please add it to .env.")

        model_name = os.getenv("ANTHROPIC_MODEL", "claude-sonnet-4-5")
        return init_chat_model(model_name, model_provider="anthropic")

    raise RuntimeError(
        "MODEL_PROVIDER must be either 'openai' or 'anthropic'."
    )


def main() -> None:
    load_env_file()

    model = build_model()
    agent = create_agent(
        model=model,
        tools=[get_weather],
        system_prompt=(
            "You are a helpful assistant. "
            "Use the weather tool for weather questions. "
            "When weather tool results are available, answer based on that data."
        ),
    )

    user_query = os.getenv("USER_QUERY", "杭州今天天气如何?")
    response = agent.invoke({"messages": [{"role": "user", "content": user_query}]})

    final_message = response["messages"][-1]
    print(final_message.content)


if __name__ == "__main__":
    main()
