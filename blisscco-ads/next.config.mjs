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
