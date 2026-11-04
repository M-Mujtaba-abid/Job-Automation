"use client";

import { createAuthClient } from "better-auth/react";

/** Browser-side Better Auth client (same origin). Only used by client components. */
export const authClient = createAuthClient();
