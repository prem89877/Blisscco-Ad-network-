import Hero from "@/components/Hero";
import { HowItWorks, Audiences, Developers, Waitlist } from "@/components/Sections";

export default function Home() {
  return (
    <main id="main">
      <Hero />
      <HowItWorks />
      <Audiences />
      <Developers />
      <Waitlist />
    </main>
  );
}
