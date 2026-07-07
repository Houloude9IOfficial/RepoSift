import { readFileSync } from "node:fs";
import { load } from "js-yaml";
import { planMeSchema, type PlanMeConfig } from "./schema.js";

export function parsePlanMe(path: string): PlanMeConfig {
  let raw: string;
  try {
    raw = readFileSync(path, "utf-8");
  } catch (err) {
    throw new Error(`Failed to read plan.me file at "${path}": ${(err as Error).message}`);
  }

  let parsed: unknown;
  try {
    parsed = load(raw);
  } catch (err) {
    throw new Error(`Failed to parse YAML in "${path}": ${(err as Error).message}`);
  }

  if (typeof parsed !== "object" || parsed === null) {
    throw new Error(`Invalid plan.me: expected a YAML mapping at root, got ${typeof parsed}`);
  }

  const result = planMeSchema.safeParse(parsed);
  if (!result.success) {
    const issues = result.error.issues
      .map((i) => `  - ${i.path.join(".")}: ${i.message}`)
      .join("\n");
    throw new Error(`plan.me validation failed:\n${issues}`);
  }

  return result.data;
}
