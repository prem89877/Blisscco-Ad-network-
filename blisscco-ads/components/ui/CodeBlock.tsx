type CodeBlockProps = { code: string; label?: string };

/** Monospace block for API keys, campaign IDs and code. Scrolls sideways on small screens. */
export default function CodeBlock({ code, label = "Code sample" }: CodeBlockProps) {
  return (
    <pre
      tabIndex={0}
      aria-label={label}
      className="overflow-x-auto rounded-xl border border-line bg-ink p-4 font-mono text-[13px] leading-6 text-aqua sm:p-5"
    >
      <code>{code}</code>
    </pre>
  );
}
