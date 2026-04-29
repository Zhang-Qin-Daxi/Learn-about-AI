"use client";

import { useMemo, useState } from "react";

import AIChefAssistant from "./components/AIChefAssistant";
import AskAssistant from "./components/AskAssistant";

const API_BASE_URL = process.env.NEXT_PUBLIC_API_BASE_URL || "http://127.0.0.1:8000";

export default function Home() {
  const [activeView, setActiveView] = useState<"ask" | "kitchen">("ask");
  const [value, setValue] = useState("");
  const [lastSubmitted, setLastSubmitted] = useState("");
  const [reply, setReply] = useState("");
  const [error, setError] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [kitchenValue, setKitchenValue] = useState("");
  const [kitchenImageName, setKitchenImageName] = useState("");
  const [kitchenSubmitted, setKitchenSubmitted] = useState("");

  const kitchenFeatures = ["图片识别", "智能搜索", "智能排序", "创意建议"];

  const canSubmit = useMemo(() => value.trim().length > 0 && !isSubmitting, [value, isSubmitting]);
  const canKitchenSubmit = useMemo(
    () => kitchenValue.trim().length > 0 || kitchenImageName.length > 0,
    [kitchenValue, kitchenImageName]
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

  function handleKitchenImageChange(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    setKitchenImageName(file ? file.name : "");
  }

  function handleKitchenSubmit() {
    if (!canKitchenSubmit) return;
    const message = kitchenValue.trim();
    const imageLabel = kitchenImageName ? `图片: ${kitchenImageName}` : "";

    setKitchenSubmitted([message, imageLabel].filter(Boolean).join(" · "));
    setKitchenValue("");
  }

  function handleKitchenReset() {
    setKitchenValue("");
    setKitchenImageName("");
    setKitchenSubmitted("");
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
          kitchenFeatures={kitchenFeatures}
          setKitchenValue={setKitchenValue}
          handleKitchenKeyDown={handleKitchenKeyDown}
          handleKitchenImageChange={handleKitchenImageChange}
          handleKitchenSubmit={handleKitchenSubmit}
          handleKitchenReset={handleKitchenReset}
        />
      )}
    </main>
  );
}
