import { assertPublicEnvIsSafe } from "./config/public-env-guard.mjs";

// Day 14: build/dev start par check: koi secret NEXT_PUBLIC_ variable me ho toh build ruk jata hai.
assertPublicEnvIsSafe(process.env);

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  // ESLint alag se chalta hai (npm run lint:eslint aur CI). Deploy build ko lint ki wajah se rukna nahi chahiye.
  eslint: { ignoreDuringBuilds: true },
  // Speed: dashboard pages dynamic hain, isliye Next.js 15 inhe client par cache NAHI karta tha (staleTimes.dynamic = 0).
  // Matlab har tap par server ka poora round trip (auth check + database) hota tha. Ab visited page 30 sec tak
  // turant khulta hai. Koi bhi server action (revalidatePath/redirect) is cache ko apne aap saaf kar deta hai,
  // toh create/edit/approve ke baad purana data nahi dikhta.
  experimental: {
    staleTimes: { dynamic: 30, static: 180 },
    // Phase 4 Step 3: ad form me logo (max 1 MB) + banner (max 2 MB) upload hote hain. Server action ki default limit 1 MB hai,
    // isliye 5 MB. Asli size / type ki jaanch server action me (aur bucket ki 2 MB limit) hoti hai.
    serverActions: { bodySizeLimit: "5mb" },
  },
  async headers() {
    return [
      {
        source: "/(.*)",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "X-Frame-Options", value: "DENY" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
        ],
      },
    ];
  },
};
export default nextConfig;
