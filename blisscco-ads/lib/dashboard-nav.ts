export type NavItem = { href: string; label: string };
export type NavRole = "advertiser" | "publisher" | "admin";

// Sab links ek jagah. Har role ko sirf uske kaam ke links dikhte hain (navForRole).
export const DASHBOARD_NAV: NavItem[] = [
  { href: "/dashboard", label: "Overview" },
  { href: "/dashboard/advertiser/campaigns", label: "Campaigns" },
  { href: "/dashboard/publisher", label: "Publisher" },
  { href: "/dashboard/admin", label: "Admin" },
  { href: "/dashboard/analytics", label: "Analytics" },
];

const ROLE_LINKS: Record<NavRole, readonly string[]> = {
  advertiser: ["/dashboard", "/dashboard/advertiser/campaigns", "/dashboard/analytics"],
  publisher: ["/dashboard", "/dashboard/publisher", "/dashboard/analytics"],
  admin: ["/dashboard", "/dashboard/admin", "/dashboard/analytics"],
};

/** Role ke hisaab se links. Role pata na ho (account load fail) toh sirf Overview. */
export function navForRole(role: NavRole | null): NavItem[] {
  if (role === null) return DASHBOARD_NAV.filter((i) => i.href === "/dashboard");
  const allowed = ROLE_LINKS[role];
  return DASHBOARD_NAV.filter((i) => allowed.includes(i.href));
}

/** Overview matches exactly; other items also match their sub-paths. */
export function isActive(pathname: string, href: string): boolean {
  return href === "/dashboard" ? pathname === href : pathname === href || pathname.startsWith(`${href}/`);
}

/** Label of the current dashboard page, used in the header. */
export function currentLabel(pathname: string): string {
  return DASHBOARD_NAV.find((i) => isActive(pathname, i.href))?.label ?? "Dashboard";
}
