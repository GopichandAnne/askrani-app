import { redirect } from "next/navigation";

// Requests live under the unified Inbox now; keep this route as a redirect.
export default function RequestsPage() {
  redirect("/inbox");
}
