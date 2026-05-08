"use client";

import { useMemo, useState } from "react";

import AIChefAssistant from "./components/AIChefAssistant";
import AskAssistant from "./components/AskAssistant";

const API_BASE_URL = process.env.NEXT_PUBLIC_API_BASE_URL || "http://127.0.0.1:8000";
const MAX_KITCHEN_IMAGE_BYTES = 4.5 * 1024 * 1024;
const MAX_KITCHEN_IMAGE_DIMENSION = 1600;

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

function getImageFileFromClipboard(event: React.ClipboardEvent<HTMLElement>): File | null {
  // 剪贴板里可能同时有文本、HTML 和文件，这里只提取第一张图片文件。
  for (const item of Array.from(event.clipboardData.items)) {
    if (item.kind === "file" && item.type.startsWith("image/")) {
      // 粘贴截图时浏览器通常会把图片暴露成 File，后续可复用现有上传流程。
      // getAsFile() Web API 原生方法，把这项内容按 File 取出来
      return item.getAsFile();
    }
  }
  return null;
}

export default function Home() {
  const [activeView, setActiveView] = useState<"ask" | "kitchen">("kitchen");
  const [value, setValue] = useState("");
  const [lastSubmitted, setLastSubmitted] = useState("");
  const [reply, setReply] = useState("");
  const [error, setError] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [kitchenValue, setKitchenValue] = useState("");
  const [kitchenImageName, setKitchenImageName] = useState("");
  const [kitchenImageDataUrl, setKitchenImageDataUrl] = useState("");
  const [kitchenSubmitted, setKitchenSubmitted] = useState("");
  const [kitchenReply, setKitchenReply] = useState("");

  const canSubmit = useMemo(() => value.trim().length > 0 && !isSubmitting, [value, isSubmitting]);
  const canKitchenSubmit = useMemo(
    () => (kitchenValue.trim().length > 0 || kitchenImageDataUrl.length > 0) && !isSubmitting,
    [kitchenValue, kitchenImageDataUrl, isSubmitting]
  );

  async function handleSubmit() {
    if (!canSubmit) return;
    const message = value.trim();

    setIsSubmitting(true);
    setError("");
    setReply("");
    setLastSubmitted(message);

    try {
      const response = await fetch(`${API_BASE_URL}/api/chat`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ message }),
      });

      const payload = (await response.json()) as { answer?: string; error?: string };
      if (!response.ok) {
        throw new Error(payload.error || "请求失败");
      }

      setReply(payload.answer || "");
      setValue("");
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : "请求失败，请稍后重试");
    } finally {
      setIsSubmitting(false);
    }
  }

  function handleKeyDown(event: React.KeyboardEvent<HTMLInputElement>) {
    if (event.key === "Enter") {
      event.preventDefault();
      handleSubmit();
    }
  }

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
    const file = getImageFileFromClipboard(event);
    if (!file) {
      return;
    }

    event.preventDefault();
    await setKitchenImage(file);
  }

  async function handleKitchenSubmit() {
    if (!canKitchenSubmit) return;
    const message = kitchenValue.trim();
    const imageLabel = kitchenImageName ? `图片: ${kitchenImageName}` : "";

    setIsSubmitting(true);
    setError("");
    setKitchenReply("");
    setKitchenSubmitted([message, imageLabel].filter(Boolean).join(" · "));

    try {
      const response = await fetch(`${API_BASE_URL}/api/chef`, {
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

      setKitchenReply(payload.answer || "");
      setKitchenValue("");
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : "请求失败，请稍后重试");
    } finally {
      setIsSubmitting(false);
    }
   
  }

  function handleKitchenReset() {
    setKitchenValue("");
    setKitchenImageName("");
    setKitchenImageDataUrl("");
    setKitchenSubmitted("");
    setKitchenReply("");
    setError("");
  }

  return (
    <main className="relative min-h-screen overflow-hidden bg-[radial-gradient(85%_60%_at_20%_88%,rgba(255,255,255,0.06),transparent_52%),radial-gradient(65%_45%_at_84%_24%,rgba(16,185,129,0.12),transparent_55%),linear-gradient(130deg,#181b20,#1f232a)] px-4">
      <div className="pointer-events-none absolute inset-0 bg-[linear-gradient(180deg,rgba(0,0,0,0.18),rgba(0,0,0,0))]" aria-hidden="true" />

      <div className="relative mx-auto flex w-full max-w-6xl justify-center pt-6">
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
      </div>

      {activeView === "ask" ? (
        <AskAssistant
          value={value}
          setValue={setValue}
          lastSubmitted={lastSubmitted}
          reply={reply}
          error={error}
          isSubmitting={isSubmitting}
          canSubmit={canSubmit}
          handleSubmit={handleSubmit}
          handleKeyDown={handleKeyDown}
        />
      ) : (
        <AIChefAssistant
          kitchenValue={kitchenValue}
          kitchenImageName={kitchenImageName}
          kitchenSubmitted={kitchenSubmitted}
          canKitchenSubmit={canKitchenSubmit}
          setKitchenValue={setKitchenValue}
          handleKitchenKeyDown={handleKitchenKeyDown}
          handleKitchenImageChange={handleKitchenImageChange}
          handleKitchenPaste={handleKitchenPaste}
          handleKitchenSubmit={handleKitchenSubmit}
          handleKitchenReset={handleKitchenReset}
          kitchenReply={kitchenReply}
        />
      )}
    </main>
  );
}
