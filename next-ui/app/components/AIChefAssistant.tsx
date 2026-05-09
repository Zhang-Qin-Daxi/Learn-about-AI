"use client";

type AIChefAssistantProps = {
  kitchenValue: string;
  kitchenImageName: string;
  canKitchenSubmit: boolean;
  setKitchenValue: (value: string) => void;
  handleKitchenKeyDown: (event: React.KeyboardEvent<HTMLInputElement>) => void;
  handleKitchenImageChange: (event: React.ChangeEvent<HTMLInputElement>) => void;
  handleKitchenPaste: (event: React.ClipboardEvent<HTMLElement>) => void;
  handleKitchenSubmit: () => void;
};

export default function AIChefAssistant({
  kitchenValue,
  kitchenImageName,
  canKitchenSubmit,
  setKitchenValue,
  handleKitchenKeyDown,
  handleKitchenImageChange,
  handleKitchenPaste,
  handleKitchenSubmit,
}: AIChefAssistantProps) {
  return (
    <section
      className="relative mx-auto flex min-h-[calc(100vh-120px)] w-full max-w-4xl flex-col justify-center gap-4 py-6 sm:gap-5"
      onPaste={handleKitchenPaste}
    >
      <span className="text-center text-xl">我们先从哪里开始呢？</span>
      <div
        className="grid gap-2.5 rounded-3xl border border-white/10 bg-white/[0.05] p-2.5 shadow-composer backdrop-blur-md sm:grid-cols-[48px_1fr_48px] sm:items-center"
      >
        <label className="grid h-10 w-10 cursor-pointer place-items-center rounded-full bg-white/[0.08] text-base text-zinc-200 transition hover:bg-white/[0.12]">
          ⊕
          <input type="file" accept="image/*" className="hidden" onChange={handleKitchenImageChange} />
        </label>

        <input
          className="h-10 rounded-full border-0 bg-white/[0.04] px-4 text-sm text-zinc-100 outline-none placeholder:text-zinc-400"
          placeholder="描述你有的食材，或粘贴 / 上传一张图片"
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
      {!!kitchenImageName && (
        <p className="m-0 text-center text-xs text-zinc-300/75">已选择图片: {kitchenImageName}</p>
      )}
    </section>
  );
}
