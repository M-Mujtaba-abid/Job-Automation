import { z } from "zod";
import { route } from "@/legacy/api";
import { retryApplication } from "@/legacy/applications";

export const POST = route<{ id: string }>(async (_req, { params }) => retryApplication(z.uuid().parse(params.id)));
