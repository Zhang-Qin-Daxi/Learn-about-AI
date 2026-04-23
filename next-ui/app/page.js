"use client";

import { useMemo, useState } from "react";

const API_BASE_URL = process.env.NEXT_PUBLIC_API_BASE_URL || "http://127.0.0.1:8000";

export default function Home() {
  const [value, setValue] = useState("");
  const [lastSubmitted, setLastSubmitted] = useState("");
  const [reply, setReply] = useState("");
  const [error, setError] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);

  const canSubmit = useMemo(() => value.trim().length > 0 && !isSubmitting, [value, isSubmitting]);

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

      const payload = await response.json();
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

  function handleKeyDown(event) {
    if (event.key === "Enter") {
      event.preventDefault();
      handleSubmit();
    }
  }

  return (
    <main className="relative min-h-screen overflow-hidden bg-[radial-gradient(85%_60%_at_20%_88%,rgba(255,255,255,0.06),transparent_52%),radial-gradient(65%_45%_at_84%_24%,rgba(255,255,255,0.05),transparent_55%),linear-gradient(130deg,#181b20,#1f232a)] px-4">
      <div className="pointer-events-none absolute inset-0 bg-[linear-gradient(180deg,rgba(0,0,0,0.18),rgba(0,0,0,0))]" aria-hidden="true" />

      <section className="relative mx-auto flex min-h-screen w-full max-w-5xl flex-col items-center justify-center gap-6 sm:gap-7">
        <span className="text-center tracking-tight text-zinc-100 text-3xl">
          你在忙什么?
        </span>

        <div
          className="grid h-12 w-full grid-cols-[1fr_38px] items-center rounded-full border border-white/10 bg-white/[0.08] px-3 shadow-composer backdrop-blur-md sm:h-[52px] sm:grid-cols-[1fr_40px] sm:px-3.5"
          role="search"
        >
          <input
            className="h-full w-full border-0 bg-transparent pl-2 pr-2 text-base font-medium tracking-wide text-zinc-100 outline-none placeholder:text-zinc-300/60 sm:pl-3 sm:text-lg"
            placeholder="有问题，尽管问"
            value={value}
            onChange={(event) => setValue(event.target.value)}
            onKeyDown={handleKeyDown}
            aria-label="输入问题"
            disabled={isSubmitting}
          />

          <button
            className="grid h-8 w-8 place-items-center rounded-full bg-white/20 text-lg font-semibold text-zinc-100/90 transition hover:-translate-y-0.5 hover:bg-white/30 disabled:cursor-not-allowed disabled:opacity-45 sm:h-9 sm:w-9 sm:text-xl"
            type="button"
            onClick={handleSubmit}
            disabled={!canSubmit}
            aria-label="发送"
          >
            {isSubmitting ? "…" : "↑"}
          </button>
        </div>

        <div className="w-full rounded-2xl border border-white/10 bg-white/[0.03] px-4 py-3.5 sm:px-5" aria-live="polite">
          {isSubmitting && <p className="m-0 text-sm tracking-wide text-zinc-300/80">正在思考中...</p>}
          {!isSubmitting && !reply && !error && (
            <p className="m-0 text-sm tracking-wide text-zinc-300/70">输入内容后按回车或点击右侧按钮发送</p>
          )}
          {!!lastSubmitted && !isSubmitting && (
            <p className="m-0 whitespace-pre-wrap break-words text-[15px] leading-7 text-zinc-100/90">你: {lastSubmitted}</p>
          )}
          {!!reply && !isSubmitting && (
            <p className="m-0 whitespace-pre-wrap break-words text-[15px] leading-7 text-zinc-100/90">AI: {reply}</p>
          )}
          {!!error && !isSubmitting && (
            <p className="m-0 whitespace-pre-wrap break-words text-[15px] leading-7 text-rose-300">错误: {error}</p>
          )}
        </div>
      </section>
    </main>
  );
}
