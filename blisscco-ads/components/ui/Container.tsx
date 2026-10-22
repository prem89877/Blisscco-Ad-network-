type ContainerProps = { children: React.ReactNode; className?: string };

export default function Container({ children, className = "" }: ContainerProps) {
  return <div className={`mx-auto w-full max-w-6xl px-5 sm:px-8 ${className}`}>{children}</div>;
}
