# Day 2: Dashboard (demo data only)

## Pehle ye karo
1. Purani `app/page.tsx` DELETE karo (ab wo `app/(marketing)/page.tsx` mein hai, content same).
2. Zip ki files repo mein same paths par daalo. `app/layout.tsx` replace hoga.
3. Commit + push. Vercel khud build karega.

## Changed
- `app/layout.tsx`: Header/Footer hata diye (ab marketing layout mein hain)

## Moved
- `app/page.tsx` -> `app/(marketing)/page.tsx` (URL `/` wahi rahega)

## New
- `app/(marketing)/layout.tsx`
- `app/dashboard/{layout,page}.tsx`, `advertiser|publisher|campaigns|analytics/page.tsx`
- `components/dashboard/*` (Sidebar, MobileNav, PageHeader, StatCard, Panel, BarChart, LineChart, BarList, DataTable, CampaignTable, CampaignsExplorer, AnalyticsView, StatusBadge)
- `lib/{types,format,demo-data,dashboard-nav}.ts`

Koi naya package nahi. Supabase/auth/payments/API nahi. Sab sample data.
Note: local `tsc` check yahan nahi chala (node_modules nahi the); syntax check pass hai. Build error aaye toh error text bhejna.
