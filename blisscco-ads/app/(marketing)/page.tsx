import Hero from "@/components/Hero";
import {
  HowItWorks,
  Advertisers,
  AdvertiserPilot,
  Benefits,
  Publishers,
  Developers,
  Trust,
  Waitlist,
} from "@/components/Sections";

export default function Home() {
  return (
    <main id="main" tabIndex={-1} className="focus-visible:outline-none">
      <Hero />
      <HowItWorks />
      <Advertisers />
      <AdvertiserPilot />
      <Benefits />
      <Publishers />
      <Developers />
      <Trust />
      <Waitlist />
    </main>
  );
}
