import { Suspense } from "react";
import type { Metadata } from "next";
import { Wordmark } from "@/components/app-shell/wordmark";
import { LoginForm } from "@/components/auth/login-form";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

export const metadata: Metadata = { title: "Sign in · Ask Rani" };

export default function LoginPage() {
  return (
    <Card className="w-full max-w-sm">
      <CardHeader className="space-y-3 text-center">
        <Wordmark className="justify-center text-2xl" />
        <div className="space-y-1">
          <CardTitle className="text-lg">Sign in to the control panel</CardTitle>
          <CardDescription>
            Staff &amp; owners of Ask Rani stores. Use your store email.
          </CardDescription>
        </div>
      </CardHeader>
      <CardContent>
        <Suspense fallback={null}>
          <LoginForm />
        </Suspense>
      </CardContent>
    </Card>
  );
}
