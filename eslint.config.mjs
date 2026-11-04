import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

/** Module-boundary rules (ADR-021, .claude/rules/coding-standards.md). */
const noLegacy = {
  group: ["@/legacy", "@/legacy/*"],
  message: "v2 code must not import v1 code (src/legacy). Port what you need into a v2 module.",
};
const noServerFromShared = {
  group: ["@/server", "@/server/*"],
  message: "Isomorphic/UI code must not import server-only modules. Pass DTOs from Server Components.",
};
const noDbOutsideRepos = {
  group: ["@/server/db/client"],
  message: "Import the db client only in src/server/db/**, repository files, or the queue/rate-limit adapters.",
};
const noSqlRaw = {
  selector: "CallExpression[callee.type='MemberExpression'][callee.object.name='sql'][callee.property.name='raw']",
  message: "sql.raw() is banned (SQL injection risk). Use the sql`...` template with bound values.",
};

const config = [
  ...nextVitals,
  ...nextTs,
  { ignores: [".next/**", "node_modules/**", "drizzle/**", "next-env.d.ts"] },
  {
    rules: {
      "@typescript-eslint/no-unused-vars": [
        "warn",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_", ignoreRestSiblings: true },
      ],
    },
  },
  {
    files: ["src/server/**/*.ts", "src/features/**/*.{ts,tsx}"],
    rules: {
      "no-restricted-imports": ["error", { patterns: [noLegacy, noDbOutsideRepos] }],
      "no-restricted-syntax": ["error", noSqlRaw],
    },
  },
  {
    // Infrastructure adapters that own SQL: db layer, repositories, Postgres queue and rate limiter.
    files: ["src/server/db/**/*.ts", "src/server/**/repository.ts", "src/server/**/*-repository.ts", "src/server/jobs/pg-queue.ts", "src/server/lib/rate-limit.ts"],
    rules: {
      "no-restricted-imports": ["error", { patterns: [noLegacy] }],
    },
  },
  {
    files: ["src/lib/**/*.ts", "src/components/**/*.{ts,tsx}"],
    rules: {
      "no-restricted-imports": ["error", { patterns: [noServerFromShared] }],
    },
  },
];

export default config;
