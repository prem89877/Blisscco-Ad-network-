# Day 2 layout stage: changes

## PEHLE YE KARO (zaroori)
`app/page.tsx` DELETE karo. Ab `app/(marketing)/page.tsx` hi `/` serve karta hai.
Dono rahe toh Vercel build fail hoga ("two parallel pages resolve to the same path").

## New
- components/dashboard/DashboardHeader.tsx

## Changed
- app/dashboard/layout.tsx (shared header component use karta hai, min-h-dvh)
- components/dashboard/MobileNav.tsx (list semantics, chhoti screen ke liye font, safe-area, hover)
- components/dashboard/Sidebar.tsx (h-dvh, logo link tap area)
- components/ui/Button.tsx (internal "/" links ke liye next/link)
- components/ui/Badge.tsx (neutral tone add)
- lib/dashboard-nav.ts (currentLabel helper)
