import Header from "@/components/Header";
import Hero from "@/components/Hero";
import { HowItWorks, Audiences, Developers, Waitlist, Footer } from "@/components/Sections";

export default function Home() {
  return (
    <>
      <Header />
      <main>
        <Hero />
        <HowItWorks />
        <Audiences />
        <Developers />
        <Waitlist />
      </main>
      <Footer />
    </>
  );
}
