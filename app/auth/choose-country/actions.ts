"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { requireUser } from "@/lib/auth/session";
import { COUNTRY_PROMPT_COOKIE, countryPromptMarker } from "@/lib/regions/country-prompt";

// "Do it later": is login ke liye country prompt band. Cookie session-wali hai (maxAge nahi), httpOnly, aur isme sirf user id + last_sign_in_at
// hai (koi secret nahi). Naya login => last_sign_in_at badalta hai => prompt dobara aata hai jab tak country chuni nahi.
// ?later=1 bhi overview maanta hai, taaki cookies band hon tab bhi redirect ka loop na bane.
export async function skipCountryPrompt(): Promise<void> {
  const user = await requireUser();
  const marker = countryPromptMarker(user);
  if (marker) {
    (await cookies()).set(COUNTRY_PROMPT_COOKIE, marker, {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      path: "/",
    });
  }
  redirect("/dashboard?later=1");
}
