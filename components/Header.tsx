import Container from "@/components/ui/Container";
import Logo from "@/components/Logo";
import Nav from "@/components/Nav";

export default function Header() {
  return (
    <header className="sticky top-0 z-30 border-b border-line bg-ink/95">
      <Container className="relative flex items-center justify-between py-3">
        <a href="#top" aria-label="Blisscco home" className="rounded">
          <Logo />
        </a>
        <Nav />
      </Container>
    </header>
  );
}
