type NoticeProps = { tone: "error" | "success" | "info"; children: React.ReactNode };

const TONES = {
  error: "border-red-400/60 bg-red-500/10 text-red-200",
  success: "border-aqua/50 bg-aqua/10 text-aqua",
  info: "border-line bg-mist/5 text-mist/80",
};

/** Screen reader ke liye: error => role=alert (turant padhta hai), baaki => role=status. */
export default function Notice({ tone, children }: NoticeProps) {
  return (
    <div
      role={tone === "error" ? "alert" : "status"}
      className={`mt-5 rounded-lg border px-4 py-3 text-sm ${TONES[tone]}`}
    >
      {children}
    </div>
  );
}
