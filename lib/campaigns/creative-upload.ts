import { ASSET_BUCKET, ASSET_LIMITS, checkImageMeta, checkImageUpload, type AssetKind, type ImageCheck } from "@/lib/campaigns/creative-assets";

// Upload ke chhote helpers (server action se alag file me: action file me sirf auth-gated actions rehte hain).
// Koi database yahan nahi; storage client bahar se aata hai (advertiser ka apna session).

/** File ki jaanch: pehle sasti (size/type/naam), phir asli bytes. Bade file ke bytes padhe hi nahi jate. */
export async function checkFile(kind: AssetKind, file: File): Promise<{ check: ImageCheck; bytes: Uint8Array | null }> {
  const meta = checkImageMeta(kind, { name: file.name, type: file.type, size: file.size });
  if (!meta.ok) return { check: meta, bytes: null };
  const bytes = new Uint8Array(await file.arrayBuffer());
  if (bytes.length > ASSET_LIMITS[kind].maxBytes) {
    return { check: { ok: false, error: `${ASSET_LIMITS[kind].label} is too large.` }, bytes: null };
  }
  return { check: checkImageUpload(kind, { name: file.name, type: file.type, size: bytes.length }, bytes.subarray(0, 16)), bytes };
}

export function uploadedPaths(uploaded: Partial<Record<AssetKind, string>>): string[] {
  return Object.values(uploaded).filter((p): p is string => typeof p === "string");
}

type RemoveClient = { from: (bucket: string) => { remove: (paths: string[]) => PromiseLike<unknown> } };

/** Safai best-effort: fail hone par bhi flow nahi rukta. */
export async function removeQuietly(storage: RemoveClient, paths: string[]): Promise<void> {
  if (paths.length === 0) return;
  try {
    await storage.from(ASSET_BUCKET).remove(paths);
  } catch {
    // ignore
  }
}
