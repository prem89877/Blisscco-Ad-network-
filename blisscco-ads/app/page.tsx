import Hero from "@/components/Hero";
import { ValueProps, Audiences, HowItWorks, Developers, Waitlist } from "@/components/Sections";

export default function Home() {
  return (
    <main id="main">
      <Hero />
      <ValueProps />
      <Audiences />
      <HowItWorks />
      <Developers />
      <Waitlist />
    </main>
  );
}
