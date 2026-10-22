export default function Header() {
  return (
    <header className="sticky top-0 z-20 border-b border-white/10 bg-ink/85 backdrop-blur">
      <div className="mx-auto flex max-w-6xl items-center justify-between px-5 py-4">
        <a href="#top" className="flex items-center gap-2 font-display text-xl font-semibold">
          <span className="h-3 w-3 rounded-full bg-aqua" aria-hidden />
          Blisscco
        </a>
        <nav className="hidden gap-7 text-sm font-medium text-mist/80 md:flex">
          <a href="#how" className="hover:text-aqua">How it works</a>
          <a href="#platforms" className="hover:text-aqua">For platforms</a>
          <a href="#advertisers" className="hover:text-aqua">For advertisers</a>
          <a href="#developers" className="hover:text-aqua">Developers</a>
        </nav>
        <a href="#waitlist" className="rounded-lg bg-violet px-4 py-2 text-sm font-medium text-white hover:brightness-110">
          Join waitlist
        </a>
      </div>
    </header>
  );
}
