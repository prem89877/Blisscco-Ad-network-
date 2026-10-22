import Link from "next/link";
import type { ComponentPropsWithoutRef } from "react";

type Variant = "primary" | "secondary";

const base =
  "inline-flex min-h-11 items-center justify-center rounded-lg px-5 py-2.5 text-base font-medium transition-colors";
const variants: Record<Variant, string> = {
  primary: "bg-violet text-white hover:bg-[#6444F0]",
  secondary: "border border-aqua/60 text-aqua hover:bg-aqua/10",
};

type LinkProps = { href: string; variant?: Variant } & ComponentPropsWithoutRef<"a">;
type BtnProps = { href?: undefined; variant?: Variant } & ComponentPropsWithoutRef<"button">;

/**
 * Link when `href` is given, otherwise a button. 44px minimum touch height.
 * Internal paths ("/dashboard") use next/link; "#anchors" and full URLs stay plain <a>.
 */
export default function Button(props: LinkProps | BtnProps) {
  const { variant = "primary", className = "", ...rest } = props;
  const cls = `${base} ${variants[variant]} ${className}`;
  if ("href" in rest && rest.href !== undefined) {
    const a = rest as ComponentPropsWithoutRef<"a"> & { href: string };
    if (a.href.startsWith("/")) return <Link {...a} className={cls} />;
    return <a {...a} className={cls} />;
  }
  return <button type="button" {...(rest as ComponentPropsWithoutRef<"button">)} className={cls} />;
}
