# Blisscco: Android-only setup (Next.js + GitHub + Vercel)

Status: nothing here has been run or deployed yet. Follow the steps and check each one yourself.

## Kaise sab judta hai
- **Spck Editor**: code edit karna, Git commit/push (GitHub se connected). Terminal nahi chahiye.
- **GitHub**: code ka source of truth.
- **Vercel**: GitHub repo connect karo. Har push par Vercel khud `npm install` + `next build` chalata hai. Isliye build ke liye aapko local Node nahi chahiye.
- **Cloud terminal (GitHub Codespaces ya StackBlitz)**: sirf tab jab `npm install` karke `package-lock.json` banana ho, ya build error local debug karna ho.

## Versions (target)
Node 20 ya 22 (Vercel settings me), Next.js 15, React 19, TypeScript 5.7 (strict), Tailwind CSS 3.4.

## Steps
1. GitHub par naya repo banao (`blisscco-ad-network`).
2. Zip ki files repo me daalo (Spck me import ya GitHub web "Upload files").
3. Vercel > Add New Project > repo select > Framework: Next.js > Deploy.
4. Agar `package-lock.json` chahiye: Codespaces kholo > `npm install` > commit.
5. Baad me Supabase keys Vercel > Settings > Environment Variables me daalo. Keys kabhi commit mat karo. Exact variables ki poori list: `DAY14-PART3-PRODUCTION-ENV.md`.

| Kaam | Spck | Cloud terminal |
|---|---|---|
| Code edit, commit, push | Haan | Nahi |
| Vercel deploy | Nahi (Vercel khud) | Nahi |
| npm install, lockfile | Nahi | Haan |
| Local `npm run dev` preview | Nahi | Haan (optional) |

## Folder structure
```
app/            layout.tsx, page.tsx, globals.css
components/     Header, Hero, Sections
tailwind.config.ts, tsconfig.json (strict), next.config.mjs
```
Aage: `app/api/` (ad match), `app/dashboard/`, `lib/supabase/`.

## Day 14: CI aur lockfile
- `package-lock.json` abhi repo me nahi hai (sandbox me npm registry band thi, isliye generate nahi hua).
- Lockfile banane ke liye (Node 22): `npm install --package-lock-only` ya Codespaces me `npm install`, phir `package-lock.json` commit karo.
- Lockfile milte hi CI `npm ci` use karega. Tab tak CI `npm install` fallback + warning dega.
- CI me type check, tests, ESLint, build — sab real failures par job fail hota hai (koi continue-on-error nahi).
