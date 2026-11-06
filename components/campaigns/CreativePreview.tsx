import { displayHost } from "@/lib/campaigns/creative-submission";

type Props = {
  brandName: string | null;
  logoUrl: string | null;
  bannerUrl: string | null;
  headline: string;
  body: string;
  ctaText: string | null;
  destinationUrl: string;
};

/**
 * Ad ka preview: 1 logo + 1 image + headline + description + button text (sponsored ad card jaisa).
 * Sirf dashboard (advertiser aur admin review) me dikhta hai. Images private bucket se signed URL se aati hain.
 * Publisher API ko images nahi jaatin (API contract: 5 text fields). Button yahan link nahi hai: destination ab tak review nahi hui.
 */
export default function CreativePreview({ brandName, logoUrl, bannerUrl, headline, body, ctaText, destinationUrl }: Props) {
  const host = displayHost(destinationUrl);
  return (
    <div className="flex max-w-xl gap-3 rounded-xl border border-line bg-ink/60 p-3" data-ad-preview>
      {bannerUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={bannerUrl}
          alt={`Ad image for ${headline}`}
          loading="lazy"
          decoding="async"
          referrerPolicy="no-referrer"
          className="h-24 w-24 shrink-0 rounded-lg border border-line object-cover sm:h-28 sm:w-28"
        />
      ) : (
        <div className="flex h-24 w-24 shrink-0 items-center justify-center rounded-lg border border-dashed border-line px-1 text-center text-[11px] text-mist/50 sm:h-28 sm:w-28">
          No image
        </div>
      )}
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          {logoUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={logoUrl}
              alt={brandName ? `${brandName} logo` : "Brand logo"}
              loading="lazy"
              decoding="async"
              referrerPolicy="no-referrer"
              className="h-6 w-6 shrink-0 rounded-full border border-line object-cover"
            />
          ) : null}
          <span className="min-w-0 break-words text-sm font-medium text-mist">{brandName ?? "No brand name"}</span>
          <span className="rounded-full border border-line px-2 py-0.5 text-[11px] text-mist/70">Ad</span>
        </div>
        <p className="mt-1 break-words text-sm font-semibold text-mist">{headline}</p>
        <p className="mt-0.5 line-clamp-3 whitespace-pre-line break-words text-sm text-mist/80">{body}</p>
        <p className="mt-1.5 text-sm text-aqua">
          {ctaText ?? "Learn more"}
          {host ? <span className="ml-2 break-all text-xs text-mist/50">{host}</span> : null}
        </p>
      </div>
    </div>
  );
}
