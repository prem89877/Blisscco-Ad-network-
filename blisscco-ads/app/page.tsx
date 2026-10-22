import Hero from "@/components/Hero";
import {
  HowItWorks,
  Advertisers,
  AdvertiserPilot,
  Benefits,
  Publishers,
  Developers,
  Waitlist,
} from "@/components/Sections";

export default function Home() {
  return (
    <main id="main">
      <Hero />
      <HowItWorks />
      <Advertisers />
      <AdvertiserPilot />
      <Benefits />
      <Publishers />
      <Developers />
      <Waitlist />
    </main>
  );
}
