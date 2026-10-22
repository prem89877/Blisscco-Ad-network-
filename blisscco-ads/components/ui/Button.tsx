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

/** Renders a link when `href` is given, otherwise a button. 44px minimum touch height. */
export default function Button(props: LinkProps | BtnProps) {
  const { variant = "primary", className = "", ...rest } = props;
  const cls = `${base} ${variants[variant]} ${className}`;
  if ("href" in rest && rest.href !== undefined) {
    return <a {...(rest as ComponentPropsWithoutRef<"a">)} className={cls} />;
  }
  return <button type="button" {...(rest as ComponentPropsWithoutRef<"button">)} className={cls} />;
}
