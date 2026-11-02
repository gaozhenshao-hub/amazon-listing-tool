import { lazy, Suspense, type ReactNode } from "react";

const StreamdownRenderer = lazy(async () => {
  const module = await import("streamdown");
  return { default: module.Streamdown };
});

const COMPLEX_MARKDOWN = /```|\bmermaid\b|^\s*\|.+\|\s*$/m;

function renderInline(value: string): ReactNode[] {
  const tokenPattern = /(\*\*[^*]+\*\*|`[^`]+`)/g;
  return value.split(tokenPattern).filter(Boolean).map((part, index) => {
    if (part.startsWith("**") && part.endsWith("**")) return <strong key={index}>{part.slice(2, -2)}</strong>;
    if (part.startsWith("`") && part.endsWith("`")) return <code key={index} className="rounded bg-muted px-1 py-0.5 font-mono text-[0.9em]">{part.slice(1, -1)}</code>;
    return part;
  });
}

export function isComplexRichContent(content: string) {
  return COMPLEX_MARKDOWN.test(content);
}

function PlainMarkdown({ content }: { content: string }) {
  return (
    <div className="space-y-2 whitespace-pre-wrap break-words text-sm leading-6">
      {content.split(/\n{2,}/).map((paragraph, index) => (
        <p key={index}>{paragraph.split("\n").map((line, lineIndex) => <span key={lineIndex}>{renderInline(line)}{lineIndex < paragraph.split("\n").length - 1 ? <br /> : null}</span>)}</p>
      ))}
    </div>
  );
}

export function LazyRichContent({ content }: { content: string }) {
  if (!isComplexRichContent(content)) return <PlainMarkdown content={content} />;
  return (
    <Suspense fallback={<div className="min-h-12 whitespace-pre-wrap text-sm leading-6">{content}</div>}>
      <div className="prose prose-sm max-w-none dark:prose-invert">
        <StreamdownRenderer>{content}</StreamdownRenderer>
      </div>
    </Suspense>
  );
}
