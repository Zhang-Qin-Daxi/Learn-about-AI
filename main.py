import os  # 导入 `os` 模块，用于读取和设置环境变量。
import sys  # 导入 `sys`，用于读取命令行参数。
from pathlib import Path  # 导入 `Path`，用于以面向对象的方式处理文件路径。
from urllib.parse import urlparse  # 导入 `urlparse`，用于解析并规范化 OpenAI 接口地址。
from urllib.error import (
    HTTPError,
    URLError,
)  # 导入网络请求相关异常类型，便于分类处理错误。
from urllib.parse import quote  # 导入 `quote`，用于对 URL 中的地点参数进行编码。
from urllib.request import urlopen  # 导入 `urlopen`，用于发起 HTTP 请求获取天气数据。
import json  # 导入 `json` 模块，用于解析天气接口返回的 JSON 数据。

from langchain.agents import (
    create_agent,
)  # 导入 `create_agent`，用于创建可调用工具的智能体。
from langchain.chat_models import (
    init_chat_model,
)  # 导入 `init_chat_model`，用于初始化聊天模型。
from langchain.tools import (
    tool,
)  # 导入 `tool` 装饰器，用于把普通函数注册成可供智能体调用的工具。
from langchain_tavily import TavilySearch  # 导入 Tavily 搜索工具，用于给智能体提供实时网页搜索能力。


def load_env_file(
    path: str = ".env",
) -> None:  # 定义读取 `.env` 文件的函数，默认读取当前目录下的 `.env`。
    env_path = Path(path)  # 把传入的字符串路径转换为 `Path` 对象，便于后续操作。
    if not env_path.exists():  # 如果 `.env` 文件不存在，就直接结束函数。
        return  # 提前返回，避免后续读取文件时报错。

    for raw_line in env_path.read_text().splitlines():  # 逐行读取 `.env` 文件内容。
        line = raw_line.strip()  # 去掉每行首尾空白字符，便于统一处理。
        if (
            not line or line.startswith("#") or "=" not in line
        ):  # 跳过空行、注释行以及不包含 `=` 的非法行。
            continue  # 当前行不处理，继续下一行。

        key, value = line.split("=", 1)  # 按第一个 `=` 分割成环境变量名和值。
        os.environ.setdefault(
            key.strip(), value.strip().strip("\"'")
        )  # 仅在环境变量不存在时写入，且去掉值两端空白和引号。


@tool  # 使用 `@tool` 装饰器，把下面的函数注册为 LangChain 可调用工具。
def get_weather(
    location: str,
) -> str:  # 定义天气查询工具函数，接收地点名称并返回字符串结果。
    """Fetch real-time weather data for the requested location."""  # 说明该函数用于获取指定地点的实时天气。
    encoded_location = quote(
        location
    )  # 对地点名称进行 URL 编码，避免中文或空格导致请求 URL 非法。
    weather_url = f"https://wttr.in/{encoded_location}?format=j1"  # 拼接 wttr.in[免费天气查询服务接口]接口地址，并指定返回 JSON 格式[format=j1]。

    try:  # 开始尝试发起请求并解析响应。
        with urlopen(
            weather_url, timeout=10
        ) as response:  # 使用 10 秒超时访问天气接口，并在结束后自动关闭响应对象。
            payload = json.loads(
                response.read().decode("utf-8")
            )  # 读取响应字节流，按 UTF-8 解码后解析成 Python 字典。
    except HTTPError as exc:  # 捕获 HTTP 层面的错误，例如 404、500 等状态码异常。
        return f"Failed to fetch weather for {location}: weather service returned HTTP {exc.code}."  # 返回包含 HTTP 状态码的错误信息。
    except URLError as exc:  # 捕获网络连接错误，例如域名解析失败或无法连通。
        return f"Failed to fetch weather for {location}: network error: {exc.reason}."  # 返回包含网络错误原因的提示信息。
    except TimeoutError:  # 捕获请求超时异常。
        return f"Failed to fetch weather for {location}: request timed out."  # 返回超时提示。
    except json.JSONDecodeError:  # 捕获返回内容不是合法 JSON 的异常。
        return f"Failed to fetch weather for {location}: invalid weather response."  # 返回响应格式异常提示。

    current = payload.get(
        "current_condition", []
    )  # 从接口响应中提取当前天气列表，取不到时使用空列表兜底。
    if not current:  # 如果当前天气数据为空，说明响应缺少关键字段。
        return f"Failed to fetch weather for {location}: missing current weather data."  # 返回缺少当前天气数据的提示。

    current_data = current[0]  # 取当前天气列表中的第一项作为当前天气详情。
    resolved_area = (
        payload.get("nearest_area", [{}])[0]
        .get("areaName", [{}])[0]
        .get("value", location)
    )  # 提取接口解析后的地名，失败时回退为用户输入的地点。
    description = current_data.get("weatherDesc", [{}])[0].get(
        "value", "Unknown"
    )  # 提取天气描述，例如晴、多云等。
    temperature_c = current_data.get("temp_C", "Unknown")  # 提取当前摄氏温度。
    feels_like_c = current_data.get("FeelsLikeC", "Unknown")  # 提取体感摄氏温度。
    humidity = current_data.get("humidity", "Unknown")  # 提取湿度信息。
    wind_kph = current_data.get(
        "windspeedKmph", "Unknown"
    )  # 提取风速，单位为公里每小时。
    observation_time = current_data.get(
        "localObsDateTime", "Unknown"
    )  # 提取本地观测时间。

    return (  # 返回整理后的天气说明字符串。
        f"Real-time weather for {resolved_area}: {description}. "  # 返回地点名称和天气概况。
        f"Temperature: {temperature_c}C, feels like {feels_like_c}C, "  # 返回温度和体感温度信息。
        f"humidity: {humidity}%, wind speed: {wind_kph} km/h. "  # 返回湿度和风速信息。
        f"Observation time: {observation_time}. Source: wttr.in"  # 返回观测时间以及数据来源。
    )  # 结束多行字符串拼接并返回最终结果。


def build_model():  # 定义模型构建函数，根据环境变量选择不同的模型提供商。
    provider = (
        os.getenv("MODEL_PROVIDER", "anthropic").strip().lower()
    )  # 读取模型提供商配置，默认是 `anthropic`，并统一成小写。

    if provider == "openai":  # 如果配置的提供商是 OpenAI，则进入 OpenAI 初始化分支。
        api_key = os.getenv("OPENAI_API_KEY")  # 读取 OpenAI 的 API Key。
        if not api_key:  # 如果没有配置 API Key，则抛出异常提醒用户。
            raise RuntimeError(
                "OPENAI_API_KEY is not set. Please add it to .env."
            )  # 报告缺少 OpenAI API Key。

        model_name = os.getenv(
            "OPENAI_MODEL", "gpt-5.2"
        )  # 读取 OpenAI 模型名，默认使用 `gpt-5.2`。
        base_url = os.getenv("OPENAI_BASE_URL")  # 读取可选的 OpenAI 兼容接口地址。
        model_kwargs = {}  # 初始化一个字典，用于按需收集额外的模型参数。
        if base_url:  # 如果配置了自定义接口地址，则加入参数字典。
            # parsed = urlparse(base_url)  # 解析接口地址，便于判断路径部分是否缺失。
            # normalized_base_url = base_url.rstrip("/")  # 先去掉末尾斜杠，避免重复拼接。
            # if parsed.path in {"", "/"}:  # 许多 OpenAI 兼容网关要求显式 `/v1` 前缀。
            #     normalized_base_url = (
            #         f"{normalized_base_url}/v1"  # 当只给到根路径时自动补齐 `/v1`。
            #     )
            model_kwargs["base_url"] = (
                base_url
                # normalized_base_url  # 把规范化后的接口地址设置到模型参数。
            )

        return init_chat_model(
            model_name, model_provider="openai", **model_kwargs
        )  # 初始化并返回 OpenAI 聊天模型。

    if (
        provider == "anthropic"
    ):  # 如果配置的提供商是 Anthropic，则进入 Anthropic 初始化分支。
        api_key = os.getenv("ANTHROPIC_API_KEY")  # 读取 Anthropic 的 API Key。
        if not api_key:  # 如果没有配置 API Key，则抛出异常提醒用户。
            raise RuntimeError(
                "ANTHROPIC_API_KEY is not set. Please add it to .env."
            )  # 报告缺少 Anthropic API Key。

        model_name = os.getenv(
            "ANTHROPIC_MODEL", "claude-sonnet-4-5"
        )  # 读取 Anthropic 模型名，默认使用 `claude-sonnet-4-5`。
        return init_chat_model(
            model_name, model_provider="anthropic"
        )  # 初始化并返回 Anthropic 聊天模型。

    raise RuntimeError(  # 如果配置的提供商既不是 OpenAI 也不是 Anthropic，则抛出异常。
        "MODEL_PROVIDER must be either 'openai' or 'anthropic'."  # 明确提示 `MODEL_PROVIDER` 的允许取值。
    )  # 结束异常构造。


def build_tools():  # 定义工具构建函数，集中管理智能体可以调用的外部能力。
    tools = [get_weather]  # 默认注册天气工具，处理实时天气查询。

    tavily_api_key = os.getenv("TAVILY_API_KEY")  # 读取 Tavily API Key。
    if tavily_api_key:  # 如果配置了 Tavily Key，则启用实时网页搜索工具。
        tools.append(
            TavilySearch(
                max_results=5,
                topic="general",
            )
        )  # 注册 Tavily 搜索工具，默认返回 5 条通用网页搜索结果。

    return tools  # 返回最终工具列表，供智能体注册使用。


# def resolve_initial_query() -> (
#     str | None
# ):  # 解析一次性提问内容，优先命令行参数，其次环境变量。
#     if len(sys.argv) > 1:  # 如果命令行携带了额外参数，则把它们拼接成用户问题。
#         return " ".join(sys.argv[1:])  # 返回命令行中的完整问题文本。

#     env_query = os.getenv(
#         "USER_QUERY", ""
#     ).strip()  # 读取环境变量中的问题，并去掉首尾空白。
#     if env_query:  # 如果环境变量中配置了问题，则直接使用它。
#         return env_query  # 返回环境变量中的问题。

#     return None  # 没有一次性问题时返回空，后续进入交互模式。


def main() -> None:  # 定义程序主入口函数。
    load_env_file()  # 先加载 `.env` 文件中的环境变量配置。

    model = build_model()  # 根据环境变量配置初始化聊天模型。
    tools = build_tools()  # 构建智能体可调用的工具列表。
    agent = create_agent(  # 创建一个带实时数据工具的智能体。
        model=model,  # 指定智能体底层使用的聊天模型。
        tools=tools,  # 为智能体注册可调用的外部工具。
        system_prompt=(  # 设置系统提示词，约束智能体的行为。
            "You are a helpful assistant. "  # 告诉模型它是一个有帮助的助手。
            "Use the weather tool for weather questions. "  # 要求模型遇到天气问题时优先调用天气工具。
            "When weather tool results are available, answer based on that data. "  # 要求模型在拿到工具结果后基于结果回答。
            "Use Tavily search for questions that need current web information, recent facts, news, or source-backed answers. "  # 要求模型遇到需要实时网页信息的问题时调用 Tavily。
            "When search results are available, summarize them and include source URLs when helpful. "  # 要求模型基于搜索结果回答，并在有帮助时附上来源链接。
            "For questions that do not need real-time external data, answer normally without using tools."  # 明确说明普通问题直接回答即可。
        ),  # 结束系统提示词定义。
    )  # 结束智能体创建。

    # initial_query = resolve_initial_query()  # 先尝试解析一次性提问内容。
    # if initial_query is not None:  # 如果拿到了一次性问题，则只调用一次智能体后退出。
    #     try:  # 捕获 OpenAI 兼容网关返回非标准结构时的典型异常，给出更可操作的提示。
    #         response = agent.invoke(
    #             {"messages": [{"role": "user", "content": initial_query}]}
    #         )  # 用用户消息调用智能体并获取返回结果。
    #     except (
    #         AttributeError
    #     ) as exc:  # 针对 `langchain_openai` 解析响应失败的场景做专门提示。
    #         if "model_dump" in str(exc):  # 该关键字通常意味着返回不是 OpenAI 规范对象。
    #             raise RuntimeError(
    #                 "OpenAI-compatible response format is invalid. "
    #                 "Please verify OPENAI_BASE_URL returns OpenAI-compatible JSON (usually ending with /v1)."
    #             ) from exc
    #         raise
    #     final_message = response["messages"][-1]  # 取消息列表中的最后一条作为最终回复。
    #     print(final_message.content)  # 把最终回复内容输出到标准输出。
    #     return  # 单次问答模式执行完毕后直接结束程序。

    print(
        "进入交互模式，直接输入问题即可；输入 exit 或 quit 结束。"
    )  # 提示用户当前进入连续对话模式。
    while True:  # 循环读取用户输入，支持连续提问。
        try:  # 捕获输入过程中的中断和结束信号，避免程序直接报错退出。
            user_query = input("你: ").strip()  # 从终端读取一行用户输入并去掉首尾空白。
        except (
            EOFError,
            KeyboardInterrupt,
        ):  # 如果用户按下 Ctrl+D 或 Ctrl+C，则优雅退出。
            print("\n已退出。")  # 输出退出提示。
            break  # 跳出循环，结束程序。

        if not user_query:  # 忽略空输入，避免把空消息发给模型。
            continue  # 继续等待下一次输入。

        if user_query.lower() in {"exit", "quit"}:  # 支持常见退出命令。
            print("已退出。")  # 输出退出提示。
            break  # 跳出循环，结束程序。

        try:  # 捕获 OpenAI 兼容网关返回非标准结构时的典型异常，给出更可操作的提示。
            response = agent.invoke(
                {"messages": [{"role": "user", "content": user_query}]}
            )  # 用当前问题调用智能体并获取回复。
        except (
            AttributeError
        ) as exc:  # 针对 `langchain_openai` 解析响应失败的场景做专门提示。
            if "model_dump" in str(exc):  # 该关键字通常意味着返回不是 OpenAI 规范对象。
                print(
                    "模型返回格式异常：请检查 OPENAI_BASE_URL 是否为 OpenAI 兼容接口（通常需要以 /v1 结尾）。"
                )
                continue
            raise
        final_message = response["messages"][-1]  # 取消息列表中的最后一条作为最终回复。
        print(final_message.content)  # 把最终回复内容输出到标准输出。


if __name__ == "__main__":  # 如果当前文件是直接运行而不是被导入，则执行主函数。
    main()  # 调用主函数启动程序。
