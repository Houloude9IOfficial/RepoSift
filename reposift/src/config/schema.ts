import { z } from "zod";

export const searchSourceSchema = z.object({
  query: z.string().min(1),
  limit: z.number().int().positive().max(2000).default(100),
});

export const discoverySchema = z.object({
  search: searchSourceSchema.optional(),
  users: z.array(z.string().min(1)).optional(),
  explicitRepos: z.array(z.string().min(1)).optional(),
  perUserLimit: z.number().int().positive().max(2000).default(100),
});

export const licenseFilterSchema = z.object({
  allow: z.array(z.string().min(1)).default(["MIT", "Apache-2.0", "BSD-3-Clause"]),
  requireDetected: z.boolean().default(true),
});

export const starsFilterSchema = z.object({
  min: z.number().int().nonnegative().default(0),
});

export const languageFilterSchema = z.object({
  allow: z.array(z.string().min(1)).optional(),
});

export const excludePathsSchema = z.array(z.string()).default([
  "node_modules",
  "vendor",
  "dist",
  "build",
  "*.min.js",
  "*.lock",
]);

export const excludeSchema = z.object({
  paths: excludePathsSchema,
  extensions: z.array(z.string()).default([".png", ".jpg", ".svg", ".woff", ".zip", ".exe", ".bin", ".pdf"]),
  maxFileSizeKB: z.number().int().positive().default(500),
});

export const dedupeSchema = z.object({
  enabled: z.boolean().default(true),
});

export const secretScanSchema = z.object({
  enabled: z.boolean().default(true),
  action: z.enum(["drop", "redact"]).default("drop"),
});

export const outputSchema = z.object({
  format: z.enum(["raw+jsonl"]).default("raw+jsonl"),
});

export const authSchema = z.object({
  tokenEnv: z.string().default("GITHUB_TOKEN"),
});

export const planMeSchema = z.object({
  name: z.string().min(1).default("my-dataset"),
  maxSizeGB: z.number().positive().default(50),
  discovery: discoverySchema.optional(),
  licenses: licenseFilterSchema.default({}),
  stars: starsFilterSchema.default({}),
  languages: languageFilterSchema.optional(),
  exclude: excludeSchema.default({}),
  dedupe: dedupeSchema.default({}),
  secretScan: secretScanSchema.default({}),
  output: outputSchema.default({}),
  auth: authSchema.default({}),
  concurrency: z.number().int().positive().default(5),
});

export type PlanMeConfig = z.infer<typeof planMeSchema>;
export type SearchSource = z.infer<typeof searchSourceSchema>;
export type DiscoveryConfig = z.infer<typeof discoverySchema>;
export type LicenseFilter = z.infer<typeof licenseFilterSchema>;
export type StarsFilter = z.infer<typeof starsFilterSchema>;
export type LanguageFilter = z.infer<typeof languageFilterSchema>;
export type ExcludeConfig = z.infer<typeof excludeSchema>;
export type DedupeConfig = z.infer<typeof dedupeSchema>;
export type SecretScanConfig = z.infer<typeof secretScanSchema>;
export type AuthConfig = z.infer<typeof authSchema>;
