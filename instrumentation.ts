import { cleanDiagId, cleanDiagPath, diagLog } from "@/lib/diagnostics/log";

// Diagnostics: server par koi bhi page / server action / route kisi error se toote toh Vercel project logs me ek saaf line:
//   [diag] event=error_boundary source=server method=POST path=/dashboard/admin digest=1234567 routeType=action ...
// "digest" wahi hai jo user ki error screen par (aur browser ki "[diag] ... source=browser" line me) hota hai: dono ko jod kar sabab milta hai.
// Error ka message / stack yahan nahi likha jata (Next.js apne aap asli error Vercel logs me pehle hi likhta hai).
export async function onRequestError(
  err: unknown,
  request: { path: string; method: string },
  context: { routerKind?: string; routePath?: string; routeType?: string; renderSource?: string },
) {
  const e = err as { digest?: unknown; name?: unknown } | null;
  diagLog("error_boundary", {
    source: "server",
    method: request.method,
    path: cleanDiagPath(request.path),
    digest: cleanDiagId(e?.digest),
    errName: typeof e?.name === "string" ? e.name : undefined,
    routerKind: context.routerKind,
    routePath: context.routePath,
    routeType: context.routeType,
    renderSource: context.renderSource,
  });
}
