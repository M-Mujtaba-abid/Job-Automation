import type { Metadata } from "next";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { SignOutButton } from "@/features/auth/components/sign-out-button";
import { requireUser } from "@/server/auth";

export const metadata: Metadata = { title: "Account" };

/** Minimal v2 account page (M1 slice 1): proves the Better Auth session end to end. */
export default async function AccountPage() {
  const ctx = await requireUser("/account");

  return (
    <main className="mx-auto flex min-h-dvh max-w-xl items-start justify-center p-4 pt-16">
      <Card className="w-full">
        <CardHeader>
          <CardTitle>Your account</CardTitle>
          <CardDescription>Signed in with Google.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <dl className="grid grid-cols-[6rem_1fr] gap-2 text-sm">
            <dt className="text-muted-foreground">Name</dt>
            <dd>{ctx.name}</dd>
            <dt className="text-muted-foreground">Email</dt>
            <dd>{ctx.email}</dd>
          </dl>
          <SignOutButton />
        </CardContent>
      </Card>
    </main>
  );
}
