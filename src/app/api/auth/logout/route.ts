import { cookies } from "next/headers";
import { route } from "@/legacy/api";
import { SESSION_COOKIE } from "@/legacy/auth";

export const POST = route(
  async () => {
    (await cookies()).delete(SESSION_COOKIE);
    return { ok: true };
  },
  { auth: "none" },
);
