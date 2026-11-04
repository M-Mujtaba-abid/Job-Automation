import { z } from "zod";

export const sourceInputSchema = z.object({
  name: z.string().trim().min(1).max(120),
  type: z.enum(["apify_linkedin", "apify_facebook"]),
  enabled: z.boolean().default(true),
  config: z.object({
    actorId: z.string().trim().min(1, "Actor id is required"),
    input: z.record(z.string(), z.unknown()).default({}),
    keywords: z.array(z.string().trim().min(1)).default([]),
    maxResults: z.coerce.number().int().min(1).max(1000).optional(),
  }),
});

export const templateInputSchema = z.object({
  name: z.string().trim().min(1).max(120),
  subject: z.string().trim().min(1).max(300),
  body: z.string().trim().min(1).max(20_000),
  isDefault: z.boolean().default(false),
  attachCv: z.boolean().default(true),
});

export const settingsInputSchema = z.object({
  fullName: z.string().trim().max(120).default(""),
  email: z.union([z.email(), z.literal("")]).default(""),
  phone: z.string().trim().max(40).default(""),
  portfolioUrl: z.union([z.url(), z.literal("")]).default(""),
  linkedinUrl: z.union([z.url(), z.literal("")]).default(""),
  whatsappMessageTemplate: z.string().max(2000).default(""),
});

export const jobIdsSchema = z.array(z.uuid()).min(1).max(1000);
