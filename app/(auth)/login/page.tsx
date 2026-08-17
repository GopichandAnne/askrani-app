import { Suspense } from "react";
import type { Metadata } from "next";
import { Wordmark } from "@/components/app-shell/wordmark";
import { LoginForm } from "@/components/auth/login-form";
import { Card, CardContent, CardHeader } from "@/components/ui/card";

export const metadata: Metadata = { title: "Sign in · Ask Rani" };

export default function LoginPage() {
  return (
    <Card className="w-full max-w-sm">
      <CardHeader className="text-center">
        <Wordmark className="justify-center text-2xl" />
      </CardHeader>
      <CardContent>
        {/* The form renders its own heading — it flips between "Sign in" and
            "Create your store" without a navigation. */}
        <Suspense fallback={null}>
          <LoginForm />
        </Suspense>
      </CardContent>
    </Card>
  );
}
