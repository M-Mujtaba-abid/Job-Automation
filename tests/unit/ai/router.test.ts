import { describe, expect, it } from "vitest";
import { z } from "zod";
import { AiError, aiErrorFromStatus, normaliseVectors, type LlmProvider, type ProviderId } from "@/server/ai/provider";
import { createFakeEmbeddings, createFakeLlm } from "@/server/ai/providers/fake";
import { runJsonTask, type JsonTask } from "@/server/ai/router";

const schema = z.object({ title: z.string(), seniority: z.enum(["JUNIOR", "MID", "SENIOR"]).nullable() });
const task = (dataClass: "public" | "personal"): JsonTask<typeof schema> => ({
  id: "test.extract",
  version: "v1",
  dataClass,
  system: "extract",
  schema,
  maxOutputTokens: 200,
});
const ok = JSON.stringify({ title: "Frontend Engineer", seniority: "MID" });
const providers = (...ps: LlmProvider[]) => new Map<ProviderId, LlmProvider>(ps.map((p) => [p.id, p]));

describe("runJsonTask routing policy", () => {
  it("never sends personal data to a provider that disallows it (Gemini free tier)", async () => {
    const gemini = createFakeLlm(() => ok, { id: "gemini", allowsPersonalData: false });
    const groq = createFakeLlm(() => ok, { id: "groq", allowsPersonalData: true });
    const out = await runJsonTask(task("personal"), "resume text", {
      providers: providers(gemini, groq),
      chain: [
        { provider: "gemini", model: "g" },
        { provider: "groq", model: "q" },
      ],
    });
    expect(out.title).toBe("Frontend Engineer");
    expect(gemini.calls).toHaveLength(0);
    expect(groq.calls).toHaveLength(1);
  });

  it("throws POLICY when no allowed provider is configured for personal data", async () => {
    const gemini = createFakeLlm(() => ok, { id: "gemini", allowsPersonalData: false });
    await expect(
      runJsonTask(task("personal"), "x", { providers: providers(gemini), chain: [{ provider: "gemini", model: "g" }] }),
    ).rejects.toMatchObject({ kind: "POLICY" });
    expect(gemini.calls).toHaveLength(0);
  });

  it("sends a JSON schema without $schema and with required/additionalProperties for strict mode", async () => {
    const p = createFakeLlm(() => ok, { id: "gemini", allowsPersonalData: false });
    await runJsonTask(task("public"), "job", { providers: providers(p), chain: [{ provider: "gemini", model: "g" }] });
    const sent = p.calls[0]!.jsonSchema;
    expect(sent.$schema).toBeUndefined();
    expect(sent).toMatchObject({ type: "object", required: ["title", "seniority"], additionalProperties: false });
  });
});

describe("runJsonTask fallback", () => {
  it("falls back on rate limit and on invalid output, validating with Zod", async () => {
    const limited: LlmProvider = {
      id: "gemini",
      allowsPersonalData: false,
      generateJson: async () => {
        throw new AiError("RATE_LIMITED", "429", 30_000);
      },
    };
    const garbage = createFakeLlm(() => '{"title": 42}', { id: "fake" });
    const good = createFakeLlm(() => "```json\n" + ok + "\n```", { id: "groq" });
    const usage: string[] = [];
    const out = await runJsonTask(task("public"), "job", {
      providers: providers(limited, garbage, good),
      chain: [
        { provider: "gemini", model: "a" },
        { provider: "fake", model: "b" },
        { provider: "groq", model: "c" },
      ],
      onUsage: (u) => usage.push(`${u.provider}:${u.ok}`),
    });
    expect(out).toEqual({ title: "Frontend Engineer", seniority: "MID" });
    expect(usage).toEqual(["fake:false", "groq:true"]);
  });

  it("reports EXHAUSTED with the shortest retry hint when every provider fails", async () => {
    const limited = (id: ProviderId, ms: number): LlmProvider => ({
      id,
      allowsPersonalData: true,
      generateJson: async () => {
        throw new AiError("RATE_LIMITED", "429", ms);
      },
    });
    const err = await runJsonTask(task("public"), "x", {
      providers: providers(limited("gemini", 60_000), limited("groq", 5_000)),
      chain: [
        { provider: "gemini", model: "a" },
        { provider: "groq", model: "b" },
      ],
    }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(AiError);
    expect(err).toMatchObject({ kind: "EXHAUSTED", retryAfterMs: 5_000 });
  });

  it("fails loudly on configuration errors instead of masking them with fallbacks", async () => {
    const broken: LlmProvider = {
      id: "gemini",
      allowsPersonalData: false,
      generateJson: async () => {
        throw new AiError("CONFIG", "401 bad key");
      },
    };
    const good = createFakeLlm(() => ok, { id: "groq" });
    await expect(
      runJsonTask(task("public"), "x", {
        providers: providers(broken, good),
        chain: [
          { provider: "gemini", model: "a" },
          { provider: "groq", model: "b" },
        ],
      }),
    ).rejects.toMatchObject({ kind: "CONFIG" });
    expect(good.calls).toHaveLength(0);
  });
});

describe("provider helpers", () => {
  it("maps HTTP statuses to error kinds", () => {
    expect(aiErrorFromStatus("groq", { status: 429 }).kind).toBe("RATE_LIMITED");
    expect(aiErrorFromStatus("groq", { status: 401 }).kind).toBe("CONFIG");
    expect(aiErrorFromStatus("gemini", { status: 503 }).kind).toBe("UNAVAILABLE");
    expect(aiErrorFromStatus("gemini", new Error("network")).kind).toBe("UNAVAILABLE");
  });

  it("normaliseVectors checks count/dimensions/finiteness and returns unit vectors", () => {
    const [v] = normaliseVectors([[3, 4]], 1, 2);
    expect(v).toEqual([0.6, 0.8]);
    expect(() => normaliseVectors([[1, 2]], 2, 2)).toThrow(/expected 2 vectors/);
    expect(() => normaliseVectors([[1, 2, 3]], 1, 2)).toThrow(/dimensions/);
    expect(() => normaliseVectors([[NaN, 1]], 1, 2)).toThrow(/non-finite/);
  });

  it("fake embeddings are deterministic unit vectors", async () => {
    const e = createFakeEmbeddings(16);
    const [a, b] = await e.embed(["react", "react"], "document");
    expect(a).toEqual(b);
    expect(Math.hypot(...a!)).toBeCloseTo(1, 10);
  });
});
