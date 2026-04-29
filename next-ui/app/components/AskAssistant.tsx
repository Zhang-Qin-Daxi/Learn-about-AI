"use client";

type AskAssistantProps = {
  value: string;
  setValue: (value: string) => void;
  lastSubmitted: string;
  reply: string;
  error: string;
  isSubmitting: boolean;
  canSubmit: boolean;
  handleSubmit: () => void;
  handleKeyDown: (event: React.KeyboardEvent<HTMLInputElement>) => void;
};

export default function AskAssistant({
  value,
  setValue,
  lastSubmitted,
  reply,
  error,
  isSubmitting,
  canSubmit,
  handleSubmit,
  handleKeyDown,
}: AskAssistantProps) {
  return (
    <section className="relative mx-auto flex min-h-[calc(100vh-120px)] w-full max-w-5xl flex-col items-center justify-center gap-6 sm:gap-7">
      <span className="text-center text-3xl tracking-tight text-zinc-100">你在忙什么?</span>

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
  );
}
