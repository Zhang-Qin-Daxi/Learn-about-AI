"use client";

import { Fragment } from "react";

type ChatMessage = {
  id: string;
  role: "user" | "assistant";
  content: string;
  imageName?: string;
  status?: "loading" | "error" | "done";
};

type AIChefAssistantProps = {
  kitchenValue: string;
  kitchenImageName: string;
  canKitchenSubmit: boolean;
  isSubmitting: boolean;
  chatMessages: ChatMessage[];
  setKitchenValue: (value: string) => void;
  handleKitchenKeyDown: (event: React.KeyboardEvent<HTMLInputElement>) => void;
  handleKitchenImageChange: (event: React.ChangeEvent<HTMLInputElement>) => void;
  handleKitchenPaste: (event: React.ClipboardEvent<HTMLElement>) => void;
  handleKitchenSubmit: () => void;
};

type MarkdownBlock =
  | {
      type: "code";
      code: string;
      language: string;
    }
  | {
      type: "heading";
      level: 1 | 2 | 3;
      content: string;
    }
  | {
      type: "list";
      ordered: boolean;
      items: string[];
    }
  | {
      type: "blockquote";
      content: string;
    }
  | {
      type: "paragraph";
      content: string;
    };

function renderInlineMarkdown(content: string) {
  const tokens = content.split(/(`[^`]+`|\*\*[^*]+\*\*|\[[^\]]+\]\([^)]+\))/g);

  return tokens.map((token, index) => {
    if (!token) {
      return null;
    }

    if (token.startsWith("`") && token.endsWith("`")) {
      return (
        <code
          key={`inline-code-${index}`}
          className="rounded-md bg-white/10 px-1.5 py-0.5 font-mono text-[0.95em] text-emerald-100"
        >
          {token.slice(1, -1)}
        </code>
      );
    }

    if (token.startsWith("**") && token.endsWith("**")) {
      return (
        <strong key={`bold-${index}`} className="font-semibold text-white">
          {token.slice(2, -2)}
        </strong>
      );
    }

    const linkMatch = token.match(/^\[([^\]]+)\]\(([^)]+)\)$/);
    if (linkMatch) {
      return (
        <a
          key={`link-${index}`}
          href={linkMatch[2]}
          target="_blank"
          rel="noreferrer"
          className="text-emerald-200 underline decoration-emerald-200/40 underline-offset-4 hover:text-emerald-100"
        >
          {linkMatch[1]}
        </a>
      );
    }

    return <Fragment key={`text-${index}`}>{token}</Fragment>;
  });
}

function renderTextWithLineBreaks(content: string) {
  return content.split("\n").map((line, index) => (
    <Fragment key={`line-${index}`}>
      {index > 0 && <br />}
      {renderInlineMarkdown(line)}
    </Fragment>
  ));
}

function parseMarkdownBlocks(content: string): MarkdownBlock[] {
  const blocks: MarkdownBlock[] = [];
  const codeBlockPattern = /```([\w-]*)\n?([\s\S]*?)```/g;
  let cursor = 0;

  function pushTextBlocks(text: string) {
    const normalizedText = text.trim();
    if (!normalizedText) {
      return;
    }

    const chunks = normalizedText.split(/\n\s*\n/);
    for (const chunk of chunks) {
      const trimmedChunk = chunk.trim();
      if (!trimmedChunk) {
        continue;
      }

      const headingMatch = trimmedChunk.match(/^(#{1,3})\s+(.+)$/);
      if (headingMatch) {
        blocks.push({
          type: "heading",
          level: headingMatch[1].length as 1 | 2 | 3,
          content: headingMatch[2].trim(),
        });
        continue;
      }

      const lines = trimmedChunk.split("\n").map((line) => line.trimEnd());
      if (lines.every((line) => /^>\s?/.test(line))) {
        blocks.push({
          type: "blockquote",
          content: lines.map((line) => line.replace(/^>\s?/, "")).join("\n"),
        });
        continue;
      }

      const unorderedItems = lines
        .map((line) => line.match(/^[-*]\s+(.+)$/)?.[1] || null);
      if (unorderedItems.every((item) => item !== null)) {
        blocks.push({
          type: "list",
          ordered: false,
          items: unorderedItems.filter((item): item is string => item !== null),
        });
        continue;
      }

      const orderedItems = lines
        .map((line) => line.match(/^\d+\.\s+(.+)$/)?.[1] || null);
      if (orderedItems.every((item) => item !== null)) {
        blocks.push({
          type: "list",
          ordered: true,
          items: orderedItems.filter((item): item is string => item !== null),
        });
        continue;
      }

      blocks.push({
        type: "paragraph",
        content: trimmedChunk,
      });
    }
  }

  for (const match of content.matchAll(codeBlockPattern)) {
    const matchIndex = match.index ?? 0;
    pushTextBlocks(content.slice(cursor, matchIndex));
    blocks.push({
      type: "code",
      language: match[1] || "",
      code: match[2].replace(/\n$/, ""),
    });
    cursor = matchIndex + match[0].length;
  }

  pushTextBlocks(content.slice(cursor));

  if (blocks.length === 0 && content.trim()) {
    return [
      {
        type: "paragraph",
        content: content.trim(),
      },
    ];
  }

  return blocks;
}

function MarkdownMessage({ content }: { content: string }) {
  const blocks = parseMarkdownBlocks(content);

  return (
    <div className="space-y-4 text-[15px] leading-7 text-zinc-100">
      {blocks.map((block, index) => {
        if (block.type === "code") {
          return (
            <div key={`code-${index}`} className="overflow-hidden rounded-2xl border border-white/10 bg-black/35">
              {(block.language || "").length > 0 && (
                <div className="border-b border-white/10 px-4 py-2 text-xs uppercase tracking-[0.24em] text-zinc-400">
                  {block.language}
                </div>
              )}
              <pre className="overflow-x-auto px-4 py-4 text-sm leading-6 text-emerald-100">
                <code>{block.code}</code>
              </pre>
            </div>
          );
        }

        if (block.type === "heading") {
          const headingClassName =
            block.level === 1
              ? "text-2xl font-semibold text-white"
              : block.level === 2
                ? "text-xl font-semibold text-white"
                : "text-lg font-semibold text-zinc-100";

          return (
            <h3 key={`heading-${index}`} className={headingClassName}>
              {renderInlineMarkdown(block.content)}
            </h3>
          );
        }

        if (block.type === "list") {
          const ListTag = block.ordered ? "ol" : "ul";

          return (
            <ListTag
              key={`list-${index}`}
              className={`space-y-2 pl-5 text-zinc-100 ${block.ordered ? "list-decimal" : "list-disc"}`}
            >
              {block.items.map((item, itemIndex) => (
                <li key={`item-${itemIndex}`}>{renderTextWithLineBreaks(item)}</li>
              ))}
            </ListTag>
          );
        }

        if (block.type === "blockquote") {
          return (
            <blockquote
              key={`blockquote-${index}`}
              className="border-l-2 border-emerald-200/45 pl-4 text-zinc-300/90"
            >
              {renderTextWithLineBreaks(block.content)}
            </blockquote>
          );
        }

        return (
          <p key={`paragraph-${index}`} className="m-0 whitespace-pre-wrap break-words text-zinc-100">
            {renderTextWithLineBreaks(block.content)}
          </p>
        );
      })}
    </div>
  );
}

export default function AIChefAssistant({
  kitchenValue,
  kitchenImageName,
  canKitchenSubmit,
  isSubmitting,
  chatMessages,
  setKitchenValue,
  handleKitchenKeyDown,
  handleKitchenImageChange,
  handleKitchenPaste,
  handleKitchenSubmit,
}: AIChefAssistantProps) {
  const hasStartedChat = chatMessages.length > 0;

  return (
    <section
      className={`relative mx-auto flex w-full max-w-5xl flex-col gap-4 py-6 sm:gap-5 ${
        hasStartedChat ? "min-h-[calc(100vh-120px)] justify-between" : "min-h-[calc(100vh-120px)] justify-center"
      }`}
      onPaste={handleKitchenPaste}
    >
      {hasStartedChat ? (
        <div className="flex flex-1 flex-col justify-start pt-2 sm:pt-4">
          <div className="space-y-8">
            {chatMessages.map((message) =>
              message.role === "user" ? (
                <div key={message.id} className="flex justify-end">
                  <div className="max-w-[80%] rounded-[28px] bg-white/18 px-6 py-4 text-right text-white shadow-[0_16px_40px_rgba(0,0,0,0.24)]">
                    <p className="m-0 whitespace-pre-wrap break-words">{message.content || "图片识别请求"}</p>
                    {!!message.imageName && (
                      <p className="mt-2 text-sm text-zinc-300/80">附图: {message.imageName}</p>
                    )}
                  </div>
                </div>
              ) : (
                <div key={message.id} className="max-w-[85%] space-y-5 pt-12">
                  {message.status === "loading" ? (
                    <p className="m-0 whitespace-pre-wrap break-words leading-relaxed text-zinc-100">正在思考中...</p>
                  ) : (
                    <MarkdownMessage content={message.content} />
                  )}
                  <div className="flex items-center gap-6 text-zinc-200/90">
                    <button type="button" className="transition hover:text-white" aria-label="复制回答">
                      ⧉
                    </button>
                    <button type="button" className="transition hover:text-white" aria-label="分享回答">
                      ↥
                    </button>
                    <button type="button" className="transition hover:text-white" aria-label="重新生成">
                      ↻
                    </button>
                    <button type="button" className="transition hover:text-white" aria-label="更多操作">
                      …
                    </button>
                  </div>
                </div>
              )
            )}
          </div>
        </div>
      ) : (
        <div className="flex flex-col gap-4 sm:gap-5">
          <span className="text-center text-xl">我们先从哪里开始呢？</span>
        </div>
      )}

      <div className="mt-6">
        <div className="grid gap-2.5 rounded-3xl border border-white/10 bg-white/[0.05] p-2.5 shadow-composer backdrop-blur-md sm:grid-cols-[48px_1fr_48px] sm:items-center">
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
            disabled={isSubmitting}
          />

          <button
            type="button"
            onClick={handleKitchenSubmit}
            disabled={!canKitchenSubmit}
            className="grid h-10 w-10 place-items-center rounded-full bg-white/20 text-base font-semibold text-zinc-100/90 transition hover:-translate-y-0.5 hover:bg-white/30 disabled:cursor-not-allowed disabled:opacity-40"
            aria-label="发送"
          >
            {isSubmitting ? "…" : "↑"}
          </button>
        </div>
        {!!kitchenImageName && <p className="m-0 pt-3 text-center text-xs text-zinc-300/75">已选择图片: {kitchenImageName}</p>}
      </div>
    </section>
  );
}
