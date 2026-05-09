"use client";

import { useEffect, useMemo, useState } from "react";

import AIChefAssistant from "./components/AIChefAssistant";

const API_BASE_URL = process.env.NEXT_PUBLIC_API_BASE_URL || "http://127.0.0.1:8000";
const MAX_KITCHEN_IMAGE_BYTES = 4.5 * 1024 * 1024;
const MAX_KITCHEN_IMAGE_DIMENSION = 1600;
const RECENT_QUESTIONS_STORAGE_KEY = "ai-chef-recent-questions";
const MAX_RECENT_QUESTIONS = 8;

type ChatMessage = {
  id: string;
  role: "user" | "assistant";
  content: string;
  imageName?: string;
  status?: "loading" | "error" | "done";
};

type RecentQuestion = {
  id: string;
  title: string;
  prompt: string;
  detail: string;
  createdAt: string;
  messages: ChatMessage[];
};

function truncateText(text: string, maxLength: number) {
  return text.length > maxLength ? `${text.slice(0, maxLength)}...` : text;
}

function formatConversationTime() {
  return new Date().toLocaleString("zh-CN", {
    month: "numeric",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function normalizeChatMessage(message: unknown, index: number): ChatMessage | null {
  if (!message || typeof message !== "object") {
    return null;
  }

  const candidate = message as Partial<ChatMessage>;
  const role = candidate.role === "assistant" ? "assistant" : candidate.role === "user" ? "user" : null;
  if (!role) {
    return null;
  }

  return {
    id: typeof candidate.id === "string" ? candidate.id : `${role}-${index}`,
    role,
    content: typeof candidate.content === "string" ? candidate.content : "",
    imageName: typeof candidate.imageName === "string" ? candidate.imageName : undefined,
    status:
      candidate.status === "loading" || candidate.status === "error" || candidate.status === "done"
        ? candidate.status
        : "done",
  };
}

function normalizeRecentQuestion(question: unknown, index: number): RecentQuestion | null {
  if (!question || typeof question !== "object") {
    return null;
  }

  const candidate = question as Partial<RecentQuestion>;
  const prompt = typeof candidate.prompt === "string" ? candidate.prompt : "";
  const titleSource =
    typeof candidate.title === "string" && candidate.title.trim().length > 0
      ? candidate.title
      : prompt || "图片识别请求";
  const detail = typeof candidate.detail === "string" ? candidate.detail : prompt;
  const normalizedMessages = Array.isArray(candidate.messages)
    ? candidate.messages
        .map((message, messageIndex) => normalizeChatMessage(message, messageIndex))
        .filter((message): message is ChatMessage => message !== null)
    : [];

  return {
    id: typeof candidate.id === "string" ? candidate.id : `history-${index}`,
    title: titleSource,
    prompt,
    detail,
    createdAt: typeof candidate.createdAt === "string" ? candidate.createdAt : formatConversationTime(),
    messages:
      normalizedMessages.length > 0
        ? normalizedMessages
        : [
            {
              id: `legacy-user-${index}`,
              role: "user",
              content: prompt || titleSource,
              status: "done",
            },
          ],
  };
}

function buildRecentQuestionRecord(
  conversationId: string,
  messages: ChatMessage[],
  previousQuestion?: RecentQuestion
): RecentQuestion {
  const cleanedMessages = messages.map((message) => ({
    ...message,
    status: message.status === "loading" ? "done" : message.status || "done",
  }));
  const userMessages = cleanedMessages.filter((message) => message.role === "user");
  const firstUserMessage = userMessages[0];
  const latestUserMessage = userMessages[userMessages.length - 1];
  const latestMessage = cleanedMessages[cleanedMessages.length - 1];
  const prompt = previousQuestion?.prompt || firstUserMessage?.content.trim() || "";
  const titleSource = previousQuestion?.title || prompt || firstUserMessage?.imageName || "图片识别请求";
  const latestPreview =
    latestUserMessage?.content.trim() || latestUserMessage?.imageName || latestMessage?.content || titleSource;

  return {
    id: conversationId,
    title: truncateText(titleSource, 24),
    prompt,
    detail: truncateText(latestPreview, 40),
    createdAt: formatConversationTime(),
    messages: cleanedMessages,
  };
}

function loadImageFromDataUrl(dataUrl: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error("图片解码失败"));
    image.src = dataUrl;
  });
}

function dataUrlByteLength(dataUrl: string): number {
  const base64Payload = dataUrl.split(",", 2)[1] || "";
  const padding = base64Payload.endsWith("==") ? 2 : base64Payload.endsWith("=") ? 1 : 0;
  return Math.floor((base64Payload.length * 3) / 4) - padding;
}

async function optimizeKitchenImage(file: File): Promise<string> {
  const originalDataUrl = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(typeof reader.result === "string" ? reader.result : "");
    reader.onerror = () => reject(new Error("图片读取失败"));
    reader.readAsDataURL(file);
  });

  if (dataUrlByteLength(originalDataUrl) <= MAX_KITCHEN_IMAGE_BYTES) {
    return originalDataUrl;
  }

  const image = await loadImageFromDataUrl(originalDataUrl);
  const scale = Math.min(1, MAX_KITCHEN_IMAGE_DIMENSION / Math.max(image.width, image.height));
  const width = Math.max(1, Math.round(image.width * scale));
  const height = Math.max(1, Math.round(image.height * scale));

  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;

  const context = canvas.getContext("2d");
  if (!context) {
    throw new Error("浏览器不支持图片压缩");
  }

  context.drawImage(image, 0, 0, width, height);

  for (const quality of [0.9, 0.8, 0.7, 0.6, 0.5]) {
    const compressedDataUrl = canvas.toDataURL("image/jpeg", quality);
    if (dataUrlByteLength(compressedDataUrl) <= MAX_KITCHEN_IMAGE_BYTES) {
      return compressedDataUrl;
    }
  }

  throw new Error("图片过大，请换一张更小的图片后重试");
}

function getImageFileFromClipboard(clipboardData: DataTransfer | null): File | null {
  if (!clipboardData) {
    return null;
  }

  // 剪贴板里可能同时有文本、HTML 和文件，这里只提取第一张图片文件。
  for (const item of Array.from(clipboardData.items)) {
    if (item.kind === "file" && item.type.startsWith("image/")) {
      // 粘贴截图时浏览器通常会把图片暴露成 File，后续可复用现有上传流程。
      // getAsFile() Web API 原生方法，把这项内容按 File 取出来
      return item.getAsFile();
    }
  }

  for (const file of Array.from(clipboardData.files)) {
    if (file.type.startsWith("image/")) {
      return file;
    }
  }

  return null;
}

export default function Home() {
  const [error, setError] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);
  const [kitchenValue, setKitchenValue] = useState("");
  const [kitchenImageName, setKitchenImageName] = useState("");
  const [kitchenImageDataUrl, setKitchenImageDataUrl] = useState("");
  const [recentQuestions, setRecentQuestions] = useState<RecentQuestion[]>([]);
  const [hasLoadedRecentQuestions, setHasLoadedRecentQuestions] = useState(false);
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([]);
  const [currentConversationId, setCurrentConversationId] = useState<string | null>(null);

  const canKitchenSubmit = useMemo(
    () => (kitchenValue.trim().length > 0 || kitchenImageDataUrl.length > 0) && !isSubmitting,
    [kitchenValue, kitchenImageDataUrl, isSubmitting]
  );
  const hasStartedChat = chatMessages.length > 0;
  const activeRecentQuestion = useMemo(
    () => recentQuestions.find((question) => question.id === currentConversationId) || null,
    [currentConversationId, recentQuestions]
  );
  const currentConversationTitle = useMemo(() => {
    if (activeRecentQuestion) {
      return activeRecentQuestion.title;
    }

    const latestUserMessage = [...chatMessages].reverse().find((message) => message.role === "user");
    if (!latestUserMessage) {
      return "新建聊天";
    }

    const title = latestUserMessage.content.trim() || latestUserMessage.imageName || "图片识别请求";
    return truncateText(title, 24);
  }, [activeRecentQuestion, chatMessages]);

  useEffect(() => {
    try {
      const savedRecentQuestions = window.localStorage.getItem(RECENT_QUESTIONS_STORAGE_KEY);
      if (!savedRecentQuestions) {
        return;
      }

      const parsedQuestions = JSON.parse(savedRecentQuestions) as unknown;
      if (Array.isArray(parsedQuestions)) {
        setRecentQuestions(
          parsedQuestions
            .map((question, index) => normalizeRecentQuestion(question, index))
            .filter((question): question is RecentQuestion => question !== null)
            .slice(0, MAX_RECENT_QUESTIONS)
        );
      }
    } catch {
      window.localStorage.removeItem(RECENT_QUESTIONS_STORAGE_KEY);
    } finally {
      setHasLoadedRecentQuestions(true);
    }
  }, []);

  useEffect(() => {
    if (!hasLoadedRecentQuestions) {
      return;
    }
    window.localStorage.setItem(RECENT_QUESTIONS_STORAGE_KEY, JSON.stringify(recentQuestions));
  }, [hasLoadedRecentQuestions, recentQuestions]);

  useEffect(() => {
    if (!isSidebarOpen) {
      return;
    }

    const { overflow } = document.body.style;
    document.body.style.overflow = "hidden";

    return () => {
      document.body.style.overflow = overflow;
    };
  }, [isSidebarOpen]);

  useEffect(() => {
    function handleResize() {
      if (window.innerWidth >= 1280) {
        setIsSidebarOpen(false);
      }
    }

    handleResize();
    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  }, []);

  function handleKitchenKeyDown(event: React.KeyboardEvent<HTMLInputElement>) {
    if (event.key === "Enter") {
      event.preventDefault();
      handleKitchenSubmit();
    }
  }

  async function setKitchenImage(file: File) {
    setKitchenImageName(file.name || "pasted-image.png");
    setError("");

    try {
      const optimizedDataUrl = await optimizeKitchenImage(file);
      setKitchenImageDataUrl(optimizedDataUrl);
    } catch (imageError) {
      setKitchenImageName("");
      setKitchenImageDataUrl("");
      setError(imageError instanceof Error ? imageError.message : "图片处理失败，请重新选择");
      throw imageError;
    }
  }

  async function handleKitchenImageChange(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) {
      setKitchenImageName("");
      setKitchenImageDataUrl("");
      return;
    }

    try {
      await setKitchenImage(file);
    } catch {
      event.target.value = "";
    }
  }

  async function handleKitchenPaste(event: React.ClipboardEvent<HTMLElement>) {
    const file = getImageFileFromClipboard(event.clipboardData);
    if (!file) {
      return;
    }

    event.preventDefault();
    await setKitchenImage(file);
  }

  useEffect(() => {
    function handleWindowPaste(event: ClipboardEvent) {
      if (event.defaultPrevented) {
        return;
      }

      const file = getImageFileFromClipboard(event.clipboardData);
      if (!file) {
        return;
      }

      event.preventDefault();
      void setKitchenImage(file);
    }

    window.addEventListener("paste", handleWindowPaste);
    return () => window.removeEventListener("paste", handleWindowPaste);
  }, []);

  function handleNewChat() {
    setIsSidebarOpen(false);
    setKitchenValue("");
    setKitchenImageName("");
    setKitchenImageDataUrl("");
    setChatMessages([]);
    setCurrentConversationId(null);
    setError("");
  }

  function saveRecentQuestion(conversationId: string, messages: ChatMessage[]) {
    setRecentQuestions((currentQuestions) => {
      const existingQuestion = currentQuestions.find((question) => question.id === conversationId);
      const nextQuestion = buildRecentQuestionRecord(conversationId, messages, existingQuestion);

      return [nextQuestion, ...currentQuestions.filter((question) => question.id !== conversationId)].slice(
        0,
        MAX_RECENT_QUESTIONS
      );
    });
  }

  function restoreRecentQuestion(question: RecentQuestion) {
    setIsSidebarOpen(false);
    setChatMessages(question.messages);
    setCurrentConversationId(question.id);
    setKitchenValue("");
    setKitchenImageName("");
    setKitchenImageDataUrl("");
    setError("");
  }

  function handleDeleteRecentQuestion(questionId: string) {
    setRecentQuestions((currentQuestions) => currentQuestions.filter((question) => question.id !== questionId));

    if (currentConversationId === questionId) {
      setChatMessages([]);
      setCurrentConversationId(null);
      setKitchenValue("");
      setKitchenImageName("");
      setKitchenImageDataUrl("");
      setError("");
    }
  }

  async function handleKitchenSubmit() {
    if (!canKitchenSubmit) return;
    const message = kitchenValue.trim();
    const currentImageName = kitchenImageName;
    const conversationId = currentConversationId || `conversation-${Date.now()}`;
    const userMessageId = `user-${Date.now()}`;
    const assistantMessageId = `assistant-${Date.now()}`;
    const pendingMessages: ChatMessage[] = [
      ...chatMessages,
      {
        id: userMessageId,
        role: "user",
        content: message,
        imageName: currentImageName || undefined,
        status: "done",
      },
      {
        id: assistantMessageId,
        role: "assistant",
        content: "",
        status: "loading",
      },
    ];

    setIsSubmitting(true);
    setError("");
    setCurrentConversationId(conversationId);
    setChatMessages(pendingMessages);

    try {
      const response = await fetch(`${API_BASE_URL}/api/chat`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ message, imageDataUrl: kitchenImageDataUrl || undefined }),
      });

      const payload = (await response.json()) as { answer?: string; error?: string };
      if (!response.ok) {
        throw new Error(payload.error || "请求失败");
      }

      const answer = payload.answer || "我已经收到你的问题了，不过这次没有返回内容。";
      const nextMessages = pendingMessages.map((currentMessage) =>
        currentMessage.id === assistantMessageId
          ? {
              ...currentMessage,
              content: answer,
              status: "done" as const,
            }
          : currentMessage
      );

      setChatMessages(nextMessages);
      saveRecentQuestion(conversationId, nextMessages);
      setKitchenValue("");
      setKitchenImageName("");
      setKitchenImageDataUrl("");
    } catch (submitError) {
      const messageText = submitError instanceof Error ? submitError.message : "请求失败，请稍后重试";
      setError(messageText);
      const nextMessages = pendingMessages.map((currentMessage) =>
        currentMessage.id === assistantMessageId
          ? {
              ...currentMessage,
              content: `请求失败：${messageText}`,
              status: "error" as const,
            }
          : currentMessage
      );

      setChatMessages(nextMessages);
      saveRecentQuestion(conversationId, nextMessages);
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <main className="relative min-h-screen overflow-hidden bg-[radial-gradient(85%_60%_at_20%_88%,rgba(255,255,255,0.06),transparent_52%),radial-gradient(65%_45%_at_84%_24%,rgba(16,185,129,0.12),transparent_55%),linear-gradient(130deg,#181b20,#1f232a)] px-4 py-4">
      {/* <div className="pointer-events-none absolute inset-0 bg-[linear-gradient(180deg,rgba(0,0,0,0.18),rgba(0,0,0,0))]" aria-hidden="true" /> */}

      {/* <div className="relative mx-auto flex w-full max-w-6xl justify-center pt-6">
        <div className="inline-flex rounded-full border border-white/10 bg-white/[0.06] p-1 backdrop-blur-md">
          <button
            type="button"
            onClick={() => setActiveView("ask")}
            className={`rounded-full px-4 py-2 text-sm transition ${
              activeView === "ask" ? "bg-white text-zinc-900" : "text-zinc-200 hover:bg-white/10"
            }`}
          >
            问答助手
          </button>
          <button
            type="button"
            onClick={() => setActiveView("kitchen")}
            className={`rounded-full px-4 py-2 text-sm transition ${
              activeView === "kitchen" ? "bg-emerald-200 text-zinc-950" : "text-zinc-200 hover:bg-white/10"
            }`}
          >
            AI 私厨
          </button>
        </div>
      </div> */}

      {isSidebarOpen && (
        <button
          type="button"
          className="fixed inset-0 z-30 bg-black/55 xl:hidden"
          onClick={() => setIsSidebarOpen(false)}
          aria-label="关闭菜单"
        />
      )}

      <div className="relative flex min-h-[calc(100vh-2rem)] w-full flex-col gap-4 xl:flex-row">
        <aside
          id="chat-sidebar"
          className={`fixed inset-y-4 left-4 z-40 w-[min(22rem,calc(100vw-2rem))] overflow-y-auto rounded-[28px] border border-white/10 bg-[#1d2127]/95 p-4 shadow-2xl backdrop-blur-md transition duration-300 xl:static xl:z-auto xl:w-auto xl:bg-white/[0.06] xl:p-5 ${
            isSidebarOpen ? "translate-x-0 opacity-100" : "-translate-x-[115%] opacity-0 pointer-events-none"
          } xl:pointer-events-auto xl:translate-x-0 xl:opacity-100 xl:min-h-full xl:basis-[20%]`}
        >
          <div className="flex items-center justify-between gap-3">
            <div>
              <p className="m-0 text-xs uppercase tracking-[0.3em] text-emerald-200/70">AI Chef</p>
              <h1 className="mt-2 text-xl font-semibold text-white">聊天菜单</h1>
            </div>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={handleNewChat}
                disabled={isSubmitting}
                className="rounded-full border border-emerald-300/30 bg-emerald-300/15 px-4 py-2 text-sm font-medium text-emerald-100 transition hover:bg-emerald-300/25"
              >
                {hasStartedChat ? "重新开始" : "新建聊天"}
              </button>
              <button
                type="button"
                onClick={() => setIsSidebarOpen(false)}
                className="grid h-10 w-10 place-items-center rounded-full border border-white/10 bg-white/[0.06] text-lg text-zinc-200 transition hover:bg-white/[0.1] xl:hidden"
                aria-label="折叠菜单"
              >
                ×
              </button>
            </div>
          </div>

          <div className="mt-6 rounded-2xl border border-white/10 bg-black/10 p-4">
            <p className="m-0 text-xs uppercase tracking-[0.24em] text-zinc-500">
              {hasStartedChat ? "当前会话" : "默认状态"}
            </p>
            <p className="mt-3 text-sm font-medium text-zinc-100">{currentConversationTitle}</p>
            <p className="mt-2 text-xs leading-5 text-zinc-400">
              {hasStartedChat ? "正在问答模式中，继续输入会延续当前对话。" : "当前还没有发起对话，页面保持默认欢迎态。"}
            </p>
          </div>

          <div className="mt-6">
            <div className="mb-3 flex items-center justify-between">
              <h2 className="m-0 text-sm font-medium text-zinc-100">最近询问</h2>
              <span className="text-xs text-zinc-400">{recentQuestions.length} 条</span>
            </div>

            <div className="space-y-2">
              {recentQuestions.length > 0 ? (
                recentQuestions.map((question) => (
                  <div
                    key={question.id}
                    className={`relative rounded-2xl border transition ${
                      currentConversationId === question.id
                        ? "border-emerald-200/35 bg-emerald-300/10"
                        : "border-white/8 bg-black/10 hover:border-emerald-200/20 hover:bg-white/[0.07]"
                    }`}
                  >
                    <button
                      type="button"
                      onClick={() => restoreRecentQuestion(question)}
                      disabled={isSubmitting}
                      className="w-full rounded-2xl px-4 py-3 pr-14 text-left transition disabled:cursor-not-allowed disabled:opacity-60"
                    >
                      <p className="m-0 text-sm font-medium text-zinc-100">{question.title}</p>
                      <p className="mt-1 line-clamp-2 text-xs text-zinc-400">{question.detail}</p>
                      <p className="mt-2 text-[11px] text-zinc-500">{question.createdAt}</p>
                    </button>
                    <button
                      type="button"
                      onClick={() => handleDeleteRecentQuestion(question.id)}
                      disabled={isSubmitting}
                      className="absolute right-3 top-3 grid h-8 w-8 place-items-center rounded-full border border-white/10 bg-white/[0.05] text-sm text-zinc-300 transition hover:bg-white/[0.12] hover:text-white disabled:cursor-not-allowed disabled:opacity-50"
                      aria-label={`删除 ${question.title}`}
                    >
                      ×
                    </button>
                  </div>
                ))
              ) : (
                <div className="rounded-2xl border border-dashed border-white/10 bg-black/10 px-4 py-5 text-sm text-zinc-400">
                  还没有询问记录，发起第一条对话吧。
                </div>
              )}
            </div>
          </div>
        </aside>

        <section className="rounded-[32px] border border-white/10 bg-white/[0.03] px-4 shadow-2xl backdrop-blur-sm xl:basis-[80%] sm:px-6">
          <div className="flex items-center justify-between gap-3 border-white/8 py-4 xl:hidden">
            <button
              type="button"
              onClick={() => setIsSidebarOpen(true)}
              className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/[0.06] px-4 py-2 text-sm font-medium text-zinc-100 transition hover:bg-white/[0.1]"
              aria-expanded={isSidebarOpen}
              aria-controls="chat-sidebar"
            >
              <span className="text-base leading-none">☰</span>
              菜单
            </button>
            <div className="text-right">
              <p className="m-0 text-xs uppercase tracking-[0.24em] text-zinc-500">
                {hasStartedChat ? "当前会话" : "默认状态"}
              </p>
              <p className="mt-1 text-sm font-medium text-zinc-100">{currentConversationTitle}</p>
            </div>
          </div>
          <AIChefAssistant
            kitchenValue={kitchenValue}
            kitchenImageName={kitchenImageName}
            canKitchenSubmit={canKitchenSubmit}
            isSubmitting={isSubmitting}
            chatMessages={chatMessages}
            setKitchenValue={setKitchenValue}
            handleKitchenKeyDown={handleKitchenKeyDown}
            handleKitchenImageChange={handleKitchenImageChange}
            handleKitchenPaste={handleKitchenPaste}
            handleKitchenSubmit={handleKitchenSubmit}
          />
          {!!error && chatMessages.length === 0 && <p className="pb-6 text-center text-sm text-rose-300">{error}</p>}
        </section>
      </div>
    </main>
  );
}
