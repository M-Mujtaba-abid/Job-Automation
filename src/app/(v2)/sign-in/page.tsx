import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { GoogleSignInButton } from "@/features/auth/components/google-sign-in-button";
import { safeNextPath } from "@/lib/safe-redirect";
import { getOptionalTenantContext, isGoogleSignInConfigured } from "@/server/auth";

export const metadata: Metadata = { title: "Sign in" };

export default async function SignInPage({ searchParams }: PageProps<"/sign-in">) {
  const { next } = await searchParams;
  const nextPath = safeNextPath(next);
  if (await getOptionalTenantContext()) redirect(nextPath);

  const googleReady = isGoogleSignInConfigured();

  return (
    <main className="flex min-h-dvh items-center justify-center bg-muted/40 p-4">
      <Card className="w-full max-w-sm">
        <CardHeader>
          <CardTitle className="text-xl">Sign in to JobFinder AI</CardTitle>
          <CardDescription>Use your Google account. We never see your Google password.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {!googleReady && (
            <Alert>
              <AlertDescription>
                Google sign-in is not configured yet. Add GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET (see
                docs/setup/third-party-accounts.md).
              </AlertDescription>
            </Alert>
          )}
          <GoogleSignInButton callbackURL={nextPath} disabled={!googleReady} />
          <p className="text-xs text-muted-foreground">
            By continuing you agree to the Terms and Privacy Policy. Your resume is never sold or shared.
          </p>
        </CardContent>
      </Card>
    </main>
  );
}
