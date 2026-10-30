import Header from "@/components/Header";
import Footer from "@/components/Footer";
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

/** Landing page. Header/Footer are rendered here (not in a route group) so only the landing page has them. */
export default function Home() {
  return (
    <>
      <Header />
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
      <Footer />
    </>
  );
}
