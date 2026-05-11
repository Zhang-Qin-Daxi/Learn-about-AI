# 项目流程图

下面这份流程图基于当前仓库代码整理，覆盖：

- 命令行对话流程：`main.py`
- Web 页面提交流程：`next-ui` -> `api_server.py`
- Agent 内部工具分流：天气、知识库 RAG、Tavily 搜索

## 1. 总体流程图

```mermaid
flowchart TD
    U[用户] --> C1[命令行入口 main.py]
    U --> C2[Next.js 页面 next-ui/app/page.tsx]

    subgraph CORE[共享 Agent 核心]
        ROUTER[Agent 判断是否调用工具]
        OUT[生成最终回答]
        ROUTER --> OUT
    end

    subgraph CLI[命令行模式]
        C1 --> E1[load_env_file 读取 .env]
        E1 --> M1[build_model 选择 OpenAI 或 Anthropic]
        M1 --> T1[build_tools 组装工具]
        T1 --> A1[create_agent 创建 LangChain Agent]
        A1 --> MEM1[读取本地对话记忆 .agent_memory.json]
        MEM1 --> Q1[用户输入问题]
        Q1 --> INVOKE1[agent.invoke]
        INVOKE1 --> ROUTER
        OUT --> SAVE1[写回对话记忆]
        SAVE1 --> R1[返回给用户]
    end

    subgraph WEB[Web 页面模式]
        C2 --> UI1[AIChefAssistant 输入文本或上传图片]
        UI1 --> UI2[前端压缩图片并准备请求]
        UI2 --> API1[POST /api/chat]
        API1 --> S1[api_server.py RequestHandler]
        S1 --> V1[校验 JSON 文本和图片大小]
        V1 --> Q2[构造多模态 user_query]
        Q2 --> AS1[AgentService.ask]
        AS1 --> A2[create_agent 调用模型和工具]
        A2 --> ROUTER
        OUT --> SAVE2[保存服务端记忆]
        SAVE2 --> API2[返回 JSON answer]
        API2 --> UI3[前端更新聊天列表和最近问题]
        UI3 --> R2[页面展示回答]
    end

    subgraph TOOLS[Agent 可调用工具]
        ROUTER --> W[get_weather]
        ROUTER --> KB[search_knowledge_base]
        ROUTER --> TV[TavilySearch]

        W --> WAPI[wttr.in 实时天气接口]
        KB --> RAG[rag.py 本地知识库检索]
        TV --> WEBSEARCH[互联网网页搜索]
    end
```

## 2. 知识库 RAG 流程

```mermaid
flowchart TD
    KBROOT[knowledge_base 目录] --> SCAN[扫描支持的文件类型]
    SCAN --> READ[读取文档内容]
    READ --> SPLIT[按 chunk_size 和 overlap 切分文本]
    SPLIT --> TOKEN[分词并统计 token]
    TOKEN --> INDEX[建立本地词法索引]
    INDEX --> QUERY[收到 search_knowledge_base 查询]
    QUERY --> SCORE[按相关度打分]
    SCORE --> TOPK[返回 Top K 片段]
    TOPK --> PROMPT[拼接为工具返回文本]
    PROMPT --> AGENT[Agent 基于片段生成答案并标注来源]
```

## 3. 关键文件对应关系

- `main.py`：命令行入口、模型初始化、工具注册、记忆管理
- `api_server.py`：HTTP 服务、多模态请求封装、服务端记忆管理
- `rag.py`：本地知识库扫描、切分、索引、检索
- `next-ui/app/page.tsx`：前端状态管理、发请求、聊天记录和最近问题
- `next-ui/app/components/AIChefAssistant.tsx`：聊天界面、图片上传、消息渲染
