type LogoProps = { className?: string };

/** Text-based logo: Space Grotesk 600 wordmark with a small aqua dot. */
export default function Logo({ className = "" }: LogoProps) {
  return (
    <span className={`inline-flex items-center gap-2 font-display text-xl font-semibold tracking-tight text-mist ${className}`}>
      <span aria-hidden className="h-2.5 w-2.5 rounded-full bg-aqua" />
      Bliss<span className="text-aqua">cco</span>
    </span>
  );
}
