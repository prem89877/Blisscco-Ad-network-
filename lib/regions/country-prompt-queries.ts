import { loadMyAdvertiser } from "@/lib/campaigns/queries";
import { loadMyAdvertiserCountry } from "@/lib/advertiser/country-queries";
import { loadMyPublisher } from "@/lib/publisher/queries";
import { loadMyPublisherCountry } from "@/lib/publisher/country-queries";
import { countryPromptMode, type CountryPromptMode } from "./country-prompt";

// Server: logged-in advertiser / publisher ke liye country prompt ka mode. Sab loaders React cache() wale hain (overview ke saath share hote hain).
// Koi load fail => null (prompt nahi). Role galat (admin) => null.

export async function loadCountryPromptMode(role: string): Promise<CountryPromptMode | null> {
  if (role === "advertiser") {
    const { advertiser, failed } = await loadMyAdvertiser();
    const country = advertiser && advertiser.status !== "suspended" ? await loadMyAdvertiserCountry() : null;
    return countryPromptMode({ role, accountFailed: failed, accountExists: advertiser !== null, suspended: advertiser?.status === "suspended", country });
  }
  if (role === "publisher") {
    const { publisher, failed } = await loadMyPublisher();
    const country = publisher && publisher.status !== "suspended" ? await loadMyPublisherCountry() : null;
    return countryPromptMode({ role, accountFailed: failed, accountExists: publisher !== null, suspended: publisher?.status === "suspended", country });
  }
  return null;
}
