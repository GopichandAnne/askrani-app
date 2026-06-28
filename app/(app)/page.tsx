import { redirect } from "next/navigation";

/** Home → the realtime Orders screen (the panel's primary surface). */
export default function AppHome() {
  redirect("/orders");
}
