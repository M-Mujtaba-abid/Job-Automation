"use client";

import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { authClient } from "@/lib/auth-client";

export function GoogleSignInButton({ callbackURL, disabled }: { callbackURL: string; disabled?: boolean }) {
  const [pending, setPending] = useState(false);

  async function signIn() {
    setPending(true);
    const { error } = await authClient.signIn.social({ provider: "google", callbackURL });
    if (error) {
      toast.error("Could not start Google sign-in. Please try again.");
      setPending(false);
    }
    // On success the browser is redirected to Google.
  }

  return (
    <Button type="button" className="w-full" size="lg" onClick={signIn} disabled={disabled || pending} aria-busy={pending}>
      {pending ? "Redirecting to Google…" : "Continue with Google"}
    </Button>
  );
}
