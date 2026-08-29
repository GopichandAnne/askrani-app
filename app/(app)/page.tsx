import { redirect } from "next/navigation";
import { getActiveStore } from "@/lib/store/active-store";
import { profileFor, homeHrefFor } from "@/lib/console-profile";

/** Home → the profile's primary surface: Orders for a local business, the
 *  assistant's Conversations for a SaaS/product account. */
export default async function AppHome() {
  const ctx = await getActiveStore();
  redirect(homeHrefFor(profileFor(ctx?.active?.businessType)));
}
