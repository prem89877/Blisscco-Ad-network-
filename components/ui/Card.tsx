type CardProps = { children: React.ReactNode; className?: string; as?: "div" | "li" | "article" };

export default function Card({ children, className = "", as: Tag = "div" }: CardProps) {
  return <Tag className={`rounded-xl border border-line bg-surface p-5 sm:p-6 ${className}`}>{children}</Tag>;
}
