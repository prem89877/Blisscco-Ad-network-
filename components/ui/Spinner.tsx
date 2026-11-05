// Blisscco loading spinner (aqua ring with a gap and two short arcs). Server-safe: sirf SVG + CSS, koi state / hook nahi.
// Sirf tab render karo jab kuch sach mein load / pending ho. `delayed` page-level loading ke liye hai:
// teji se load hone wale page par ye kabhi dikhta hi nahi (CSS 250ms tak chhupa rakhta hai).
type Props = {
  size?: "sm" | "md" | "lg";
  /** true: 250ms tak chhupa; fast load par kuch nahi dikhega. Page loading ke liye. */
  delayed?: boolean;
  className?: string;
};

const SIZE: Record<NonNullable<Props["size"]>, string> = {
  sm: "h-4 w-4",
  md: "h-8 w-8",
  lg: "h-14 w-14",
};

export default function Spinner({ size = "md", delayed = false, className = "" }: Props) {
  return (
    <svg
      aria-hidden="true"
      focusable="false"
      viewBox="0 0 100 100"
      fill="none"
      stroke="currentColor"
      strokeWidth="7"
      strokeLinecap="round"
      className={`bliss-spinner shrink-0 text-aqua ${SIZE[size]} ${delayed ? "bliss-spinner-delayed" : ""} ${className}`}
    >
      <path d="M30 88 A41 41 0 1 1 50 91" />
      <path d="M50 99 A49 49 0 0 0 91 77" transform="translate(0 -2)" />
    </svg>
  );
}
