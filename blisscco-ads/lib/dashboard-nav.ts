export type NavItem = { href: string; label: string };

export const DASHBOARD_NAV: NavItem[] = [
  { href: "/dashboard", label: "Overview" },
  { href: "/dashboard/advertiser", label: "Advertiser" },
  { href: "/dashboard/publisher", label: "Publisher" },
  { href: "/dashboard/campaigns", label: "Campaigns" },
  { href: "/dashboard/analytics", label: "Analytics" },
];

/** Overview matches exactly; other items also match their sub-paths. */
export function isActive(pathname: string, href: string): boolean {
  return href === "/dashboard" ? pathname === href : pathname === href || pathname.startsWith(`${href}/`);
}
