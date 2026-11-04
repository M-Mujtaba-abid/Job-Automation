import { z } from "zod";
import { route } from "@/lib/api";
import { retryApplication } from "@/lib/applications";

export const POST = route<{ id: string }>(async (_req, { params }) => retryApplication(z.uuid().parse(params.id)));
