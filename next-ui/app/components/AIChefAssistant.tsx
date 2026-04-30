"use client";

type AIChefAssistantProps = {
  kitchenValue: string;
  kitchenImageName: string;
  kitchenSubmitted: string;
  canKitchenSubmit: boolean;
  kitchenReply: string;
  setKitchenValue: (value: string) => void;
  handleKitchenKeyDown: (event: React.KeyboardEvent<HTMLInputElement>) => void;
  handleKitchenImageChange: (event: React.ChangeEvent<HTMLInputElement>) => void;
  handleKitchenSubmit: () => void;
  handleKitchenReset: () => void;
};

export default function AIChefAssistant({
  kitchenValue,
  kitchenImageName,
  kitchenSubmitted,
  canKitchenSubmit,
  setKitchenValue,
  kitchenReply,
  handleKitchenKeyDown,
  handleKitchenImageChange,
  handleKitchenSubmit,
  handleKitchenReset,
}: AIChefAssistantProps) {
  return (
    <section className="relative mx-auto flex min-h-[calc(100vh-120px)] w-full max-w-4xl flex-col justify-center gap-4 py-6 sm:gap-5">
      <div className="rounded-3xl border border-white/10 bg-white/[0.05] p-4 shadow-composer backdrop-blur-md">
        <div className="flex items-center justify-between gap-4">
          <div className="flex items-center gap-4">
            <div className="grid h-10 w-10 place-items-center rounded-xl bg-amber-300/15 text-base text-amber-200">
              ✦
            </div>
            <div>
              <h1 className="m-0 text-lg font-semibold tracking-tight text-zinc-100 sm:text-xl">AI 私厨</h1>
              <p className="mt-0.5 text-xs text-zinc-300/65 sm:text-sm">上传食材图片，获取个性化食谱推荐</p>
            </div>
          </div>

          <button
            type="button"
            onClick={handleKitchenReset}
            className="rounded-full bg-white/10 px-3.5 py-2 text-xs text-zinc-100 transition hover:bg-white/15 sm:text-sm"
          >
            新建会话
          </button>
        </div>
      </div>

      <div className="flex min-h-[320px] flex-col rounded-[28px] border border-white/10 bg-white/[0.03] px-6 py-8 text-center shadow-composer backdrop-blur-sm sm:min-h-[360px]">
        <div className="my-auto flex flex-col items-center">
          <h2 className="mt-5 text-xl font-semibold tracking-tight text-zinc-100 sm:text-2xl">上传食材图片开始吧</h2>
          <p className="mt-2 max-w-sm text-sm leading-6 text-zinc-300/68">
            我会帮你识别食材、搜索相关食谱，并按推荐度、难度和营养价值智能排序。
          </p>
          {!!kitchenImageName && (
            <p className="mt-4 rounded-full border border-amber-300/15 bg-amber-300/10 px-3 py-1 text-xs text-amber-100">
              已选择图片: {kitchenImageName}
            </p>
          )}
          {!!kitchenSubmitted && (
            <p className="mt-3 max-w-md text-sm leading-6 text-zinc-200/85">最近输入: {kitchenSubmitted}</p>
          )}
          {!!kitchenReply && (
            <div className="mt-6 w-full max-w-2xl rounded-3xl border border-white/10 bg-black/15 p-5 text-left shadow-composer">
              <p className="m-0 text-xs uppercase tracking-[0.24em] text-amber-200/80">AI 私厨建议</p>
              <div className="mt-3 whitespace-pre-wrap break-words text-sm leading-7 text-zinc-100/90 sm:text-[15px]">
                {kitchenReply}
              </div>
            </div>
          )}
        </div>
      </div>

      <div className="grid gap-2.5 rounded-3xl border border-white/10 bg-white/[0.05] p-2.5 shadow-composer backdrop-blur-md sm:grid-cols-[48px_1fr_48px] sm:items-center">
        <label className="grid h-10 w-10 cursor-pointer place-items-center rounded-full bg-white/[0.08] text-base text-zinc-200 transition hover:bg-white/[0.12]">
          ⊕
          <input type="file" accept="image/*" className="hidden" onChange={handleKitchenImageChange} />
        </label>

        <input
          className="h-10 rounded-full border-0 bg-white/[0.04] px-4 text-sm text-zinc-100 outline-none placeholder:text-zinc-400"
          placeholder="描述你有的食材，或直接上传一张图片"
          value={kitchenValue}
          onChange={(event) => setKitchenValue(event.target.value)}
          onKeyDown={handleKitchenKeyDown}
          aria-label="输入食材"
        />

        <button
          type="button"
          onClick={handleKitchenSubmit}
          disabled={!canKitchenSubmit}
          className="grid h-10 w-10 place-items-center rounded-full bg-white/20 text-base font-semibold text-zinc-100/90 transition hover:-translate-y-0.5 hover:bg-white/30 disabled:cursor-not-allowed disabled:opacity-40"
          aria-label="发送"
        >
          ↑
        </button>
      </div>
    </section>
  );
}
