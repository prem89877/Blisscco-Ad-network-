import Link from "next/link";
import Logo from "@/components/Logo";
import Card from "@/components/ui/Card";

type Props = { title: string; description?: string; children: React.ReactNode };

/** Login/Signup pages ka common dhancha (landing page ke same colors). */
export default function AuthShell({ title, description, children }: Props) {
  return (
    <div className="flex min-h-dvh flex-col items-center px-5 py-8 sm:justify-center">
      <Link href="/" aria-label="Blisscco landing page" className="mb-6 rounded">
        <Logo />
      </Link>
      <main id="main" tabIndex={-1} className="w-full max-w-md focus-visible:outline-none">
        <Card className="!p-6 sm:!p-8">
          <h1 className="font-display text-2xl font-semibold tracking-tight">{title}</h1>
          {description && <p className="mt-2 text-sm text-mist/70">{description}</p>}
          {children}
        </Card>
      </main>
    </div>
  );
}
