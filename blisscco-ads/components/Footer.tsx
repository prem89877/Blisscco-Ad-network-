import Container from "@/components/ui/Container";
import Logo from "@/components/Logo";

export default function Footer() {
  return (
    <footer className="border-t border-line py-10">
      <Container className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <Logo />
        <p className="text-sm text-mist/60">Online Ad Network for AI chatbot platforms</p>
      </Container>
    </footer>
  );
}
