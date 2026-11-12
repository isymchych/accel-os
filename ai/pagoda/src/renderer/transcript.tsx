import { Markdown, type MarkdownComponents } from "@tanstack/markdown/react";
import { Schema } from "effect";
import {
  ArrowDownIcon,
  CheckIcon,
  ChevronRightIcon,
  CircleAlertIcon,
  LoaderIcon,
  MessageSquareIcon,
  TerminalIcon,
} from "lucide-react";
import { memo, useLayoutEffect, useRef, useState, type ReactElement, type RefObject } from "react";

import type {
  ContentBlock,
  SessionSnapshot,
  ToolActivity,
  TranscriptMessage,
} from "../contracts/index.ts";
import { Button } from "./components/ui/button.tsx";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "./components/ui/collapsible.tsx";

function TranscriptImage({ src, alt }: { src: string; alt: string }): ReactElement {
  const [failed, setFailed] = useState(false);
  if (failed) return <span className="text-muted-foreground">Could not load image: {alt}</span>;
  return (
    <img
      src={src}
      alt={alt}
      referrerPolicy="no-referrer"
      className="max-w-full rounded-lg"
      onError={() => {
        setFailed(true);
      }}
    />
  );
}

const markdownComponents: MarkdownComponents = {
  img: ({ src, alt }) => (
    <TranscriptImage
      src={src?.startsWith("data:") ? src : `/api/image?url=${encodeURIComponent(src ?? "")}`}
      alt={alt ?? ""}
    />
  ),
  a: ({ children, href, title }) =>
    href ? (
      <a href={href} title={title} target="_blank" rel="noreferrer">
        {children}
      </a>
    ) : (
      <span>{children}</span>
    ),
  table: ({ children }) => (
    <div className="overflow-x-auto">
      <table>{children}</table>
    </div>
  ),
};

function MarkdownText({ text }: { text: string }): ReactElement {
  return (
    <div className="transcript-markdown">
      <Markdown allowHtml={false} components={markdownComponents}>
        {text}
      </Markdown>
    </div>
  );
}

function LongText({ text, markdown = false }: { text: string; markdown?: boolean }): ReactElement {
  const [expanded, setExpanded] = useState(false);
  const long = text.length > 4_000;
  return (
    <div className="min-w-0">
      <div className={long && !expanded ? "max-h-80 overflow-hidden" : undefined}>
        {markdown ? (
          <MarkdownText text={text} />
        ) : (
          <pre className="whitespace-pre-wrap break-words text-sm leading-6 [overflow-wrap:anywhere]">
            {text}
          </pre>
        )}
      </div>
      {long && (
        <Button
          variant="ghost"
          size="sm"
          className="mt-3 text-muted-foreground"
          aria-expanded={expanded}
          onClick={() => {
            setExpanded(!expanded);
          }}
        >
          {expanded
            ? "Show less"
            : `Show full content (${text.length.toLocaleString()} characters)`}
        </Button>
      )}
    </div>
  );
}

function Thinking({ text }: { text: string }): ReactElement | null {
  if (!text) return null;
  return (
    <Collapsible>
      <CollapsibleTrigger render={<Button variant="ghost" size="sm" />}>
        Thinking
      </CollapsibleTrigger>
      <CollapsibleContent>
        <LongText text={text} />
      </CollapsibleContent>
    </Collapsible>
  );
}

function Content({
  blocks,
  markdown = false,
}: {
  blocks: readonly ContentBlock[];
  markdown?: boolean;
}): ReactElement {
  return (
    <div className="space-y-2">
      {blocks.map((block, index) => (
        // oxlint-disable-next-line react/no-array-index-key -- Pi content blocks retain their positions.
        <div key={index}>
          {block.type === "image" ? (
            <TranscriptImage
              key={block.data}
              src={`data:${block.mimeType};base64,${block.data}`}
              alt="Attached content"
            />
          ) : block.type === "thinking" ? (
            <Thinking text={block.text} />
          ) : (
            <LongText text={block.text} markdown={markdown} />
          )}
        </div>
      ))}
    </div>
  );
}

const Message = memo(function Message({ message }: { message: TranscriptMessage }): ReactElement {
  const user = message.role === "user";
  const assistant = message.role === "assistant";
  return (
    <article
      aria-label={`${message.role} message`}
      className={`min-w-0 ${user ? "ml-auto w-fit max-w-[95%] rounded-2xl bg-muted/60 px-5 py-4" : assistant ? "py-2" : "border-l-2 border-border pl-4 text-muted-foreground"} ${message.isError ? "border-l-2 border-destructive pl-4" : ""}`}
    >
      <h2
        className={`mb-2 text-xs font-medium ${message.isError ? "text-destructive" : "text-muted-foreground"}`}
      >
        {user ? "You" : assistant ? "Pi" : message.role}
        {message.isError && " · Error"}
      </h2>
      <Content blocks={message.content} markdown={assistant || user} />
    </article>
  );
});

const ToolContextSchema = Schema.Struct({
  command: Schema.optionalKey(Schema.String),
  path: Schema.optionalKey(Schema.String),
  file_path: Schema.optionalKey(Schema.String),
});

function toolContext(argumentsText: string): string {
  // Arguments are arbitrary tool-owned JSON; only use known string fields for a hint.
  try {
    const args: unknown = JSON.parse(argumentsText);
    if (Schema.is(ToolContextSchema)(args))
      return args.command ?? args.path ?? args.file_path ?? "";
  } catch {
    // Full original arguments remain available in the disclosure.
  }
  return "";
}

const ToolRow = memo(function ToolRow({
  tool,
  uncertain,
  stopping,
}: {
  tool: ToolActivity;
  uncertain: boolean;
  stopping: boolean;
}): ReactElement {
  const failed = tool.state === "error";
  const running = tool.state === "running";
  const state = toolState(tool.state, uncertain, stopping);
  const spinning = running && !uncertain;
  const warning = failed || (uncertain && running);
  const output = tool.content
    .flatMap((block) => (block.type === "text" ? [block.text] : []))
    .join("\n");
  const Icon = warning ? CircleAlertIcon : spinning ? LoaderIcon : CheckIcon;
  const context = toolContext(tool.arguments);
  return (
    <Collapsible
      className={`group min-w-0 rounded-xl border ${failed ? "border-destructive/30 bg-destructive/5" : "border-border"}`}
    >
      <CollapsibleTrigger
        aria-label={`${tool.name} · ${state.toLowerCase()}`}
        render={
          <Button
            variant="ghost"
            className="h-auto w-full justify-start gap-3 rounded-xl px-3 py-3 text-left font-normal"
          />
        }
      >
        <Icon
          aria-hidden="true"
          className={`size-4 shrink-0 ${warning ? "text-destructive" : "text-muted-foreground"} ${spinning ? "motion-safe:animate-spin" : ""}`}
        />
        <span className="min-w-0 flex-1">
          <span className="block text-sm font-medium">{tool.name}</span>
          {context && (
            <span
              title={context}
              className="block truncate font-mono text-xs text-muted-foreground"
            >
              {context}
            </span>
          )}
        </span>
        <span
          className={`shrink-0 text-xs ${failed ? "text-destructive" : "text-muted-foreground"}`}
        >
          {state}
        </span>
        <ChevronRightIcon
          aria-hidden="true"
          className="size-3.5 shrink-0 text-muted-foreground group-data-[panel-open]:rotate-90"
        />
      </CollapsibleTrigger>
      {failed && output && (
        <p className="px-4 pb-3 text-sm text-destructive [overflow-wrap:anywhere]">
          {output.slice(0, 240)}
          {output.length > 240 ? "…" : ""}
        </p>
      )}
      <CollapsibleContent className="space-y-4 border-t border-border px-4 py-4">
        <div>
          <h3 className="mb-2 text-xs font-medium text-muted-foreground">Arguments</h3>
          <LongText text={tool.arguments || "No arguments"} />
        </div>
        <div>
          <h3 className="mb-2 text-xs font-medium text-muted-foreground">Result</h3>
          {tool.content.length ? (
            <Content blocks={tool.content} />
          ) : (
            <LongText text={running ? "No confirmed result yet." : "No output."} />
          )}
        </div>
      </CollapsibleContent>
    </Collapsible>
  );
});

function toolState(state: ToolActivity["state"], uncertain: boolean, stopping: boolean): string {
  if (state === "error") return "Error";
  if (state === "completed") return "Completed";
  if (uncertain) return "Unconfirmed";
  return stopping ? "Stopping" : "Running";
}

const Transcript = memo(function Transcript({
  snapshot,
  contentRef,
}: {
  snapshot: SessionSnapshot;
  contentRef: RefObject<HTMLElement | null>;
}): ReactElement {
  const messages = snapshot.messages.filter((message) => message.content.length > 0);
  const empty =
    messages.length === 0 && snapshot.streaming.length === 0 && snapshot.tools.length === 0;
  return (
    <section
      ref={contentRef}
      aria-label="Session transcript"
      className={`mx-auto flex min-h-full w-full max-w-4xl flex-col px-5 py-8 lg:px-8 ${empty ? "justify-center" : "gap-7"}`}
    >
      {empty && (
        <div className="mx-auto max-w-md py-10 text-center">
          <span className="mx-auto mb-5 flex size-12 items-center justify-center rounded-2xl border border-border bg-card text-muted-foreground">
            <MessageSquareIcon aria-hidden="true" className="size-5" />
          </span>
          <h3 className="text-2xl font-semibold tracking-tight">What are we working on?</h3>
          <p className="mt-3 text-sm leading-relaxed text-muted-foreground">
            Ask a question, explore the code, or describe a change. Pi will work in your selected
            directory.
          </p>
        </div>
      )}
      {messages.map((message, index) => (
        // oxlint-disable-next-line react/no-array-index-key -- Pi snapshots append messages between explicit history replacements.
        <Message key={index} message={message} />
      ))}
      {snapshot.streaming.length > 0 && (
        <article aria-label="Streaming response" className="min-w-0 py-2">
          <h2 className="mb-2 flex items-center gap-2 text-xs font-medium text-muted-foreground">
            Pi{" "}
            <span className="rounded-md bg-muted px-2 py-0.5">
              {snapshot.connection !== "connected" || snapshot.execution === "unknown"
                ? "Execution unknown · unfinished"
                : "Responding…"}
            </span>
          </h2>
          <Content blocks={snapshot.streaming} markdown />
        </article>
      )}
      {snapshot.tools.length > 0 && (
        <section aria-label="Tool activity" className="min-w-0 space-y-2">
          <h2 className="mb-3 flex items-center gap-2 text-xs font-medium text-muted-foreground">
            <TerminalIcon aria-hidden="true" className="size-3.5" />
            Tool activity <span>{snapshot.tools.length}</span>
          </h2>
          {snapshot.tools.map((tool) => (
            <ToolRow
              key={tool.id}
              tool={tool}
              uncertain={snapshot.connection !== "connected" || snapshot.execution === "unknown"}
              stopping={snapshot.execution === "stopping"}
            />
          ))}
        </section>
      )}
    </section>
  );
});

export function TranscriptPane({
  snapshot,
  transcriptRef,
}: {
  snapshot: SessionSnapshot;
  transcriptRef: RefObject<HTMLDivElement | null>;
}): ReactElement {
  const contentRef = useRef<HTMLElement>(null);
  const following = useRef(true);
  const automaticTop = useRef<number | null>(null);
  const [away, setAway] = useState(false);

  useLayoutEffect(() => {
    const viewport = transcriptRef.current;
    const content = contentRef.current;
    if (!viewport || !content) return undefined;
    const follow = (): void => {
      if (following.current) {
        viewport.scrollTop = viewport.scrollHeight;
        automaticTop.current = viewport.scrollTop;
      }
    };
    follow();
    const observer = new ResizeObserver(follow);
    observer.observe(content);
    observer.observe(viewport);
    return (): void => {
      observer.disconnect();
    };
  }, [transcriptRef]);

  return (
    <div className="relative flex min-h-0 flex-1 flex-col">
      <div
        ref={transcriptRef}
        className="min-h-0 flex-1 overflow-x-hidden overflow-y-auto overscroll-contain [overflow-anchor:none]"
        onScroll={(event) => {
          const viewport = event.currentTarget;
          // A programmatic scroll event can arrive after streaming changed the
          // geometry. That event is not evidence that the reader scrolled away.
          const automatic = viewport.scrollTop === automaticTop.current;
          automaticTop.current = null;
          if (automatic) return;
          following.current =
            viewport.scrollHeight - viewport.clientHeight - viewport.scrollTop < 80;
          setAway(!following.current);
        }}
      >
        <Transcript snapshot={snapshot} contentRef={contentRef} />
      </div>
      {away && (
        <div className="pointer-events-none absolute inset-x-0 bottom-3 flex justify-center">
          <Button
            variant="outline"
            size="sm"
            className="pointer-events-auto rounded-full bg-background shadow-md"
            onClick={() => {
              const viewport = transcriptRef.current;
              if (viewport) {
                viewport.scrollTop = viewport.scrollHeight;
                automaticTop.current = viewport.scrollTop;
              }
              following.current = true;
              setAway(false);
            }}
          >
            <ArrowDownIcon aria-hidden="true" />
            Jump to latest
          </Button>
        </div>
      )}
    </div>
  );
}
