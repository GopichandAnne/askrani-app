import { redirect } from "next/navigation";

// Questions live under the unified Inbox now; keep this route as a redirect.
export default function TicketsPage() {
  redirect("/inbox");
}
