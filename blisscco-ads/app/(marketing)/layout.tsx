import Header from "@/components/Header";
import Footer from "@/components/Footer";

/** Landing-page shell. The dashboard has its own layout, so Header/Footer live here only. */
export default function MarketingLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <Header />
      {children}
      <Footer />
    </>
  );
}
