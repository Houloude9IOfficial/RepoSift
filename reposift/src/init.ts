import { writeFileSync } from "node:fs";
import { resolve } from "node:path";
import * as p from "@clack/prompts";
import picocolors from "picocolors";

const LANGUAGES = [
  { value: "TypeScript", label: "TypeScript" },
  { value: "JavaScript", label: "JavaScript" },
  { value: "Python", label: "Python" },
  { value: "Go", label: "Go" },
  { value: "Rust", label: "Rust" },
  { value: "Java", label: "Java" },
  { value: "Ruby", label: "Ruby" },
  { value: "C", label: "C" },
  { value: "C++", label: "C++" },
  { value: "C#", label: "C#" },
  { value: "Swift", label: "Swift" },
  { value: "Kotlin", label: "Kotlin" },
  { value: "Scala", label: "Scala" },
  { value: "PHP", label: "PHP" },
  { value: "Shell", label: "Shell" },
  { value: "Lua", label: "Lua" },
  { value: "R", label: "R" },
  { value: "Dart", label: "Dart" },
  { value: "Zig", label: "Zig" },
];

const LICENSES = [
  { value: "MIT", label: "MIT" },
  { value: "Apache-2.0", label: "Apache 2.0" },
  { value: "BSD-3-Clause", label: "BSD 3-Clause" },
  { value: "BSD-2-Clause", label: "BSD 2-Clause" },
  { value: "GPL-3.0", label: "GPL 3.0" },
  { value: "GPL-2.0", label: "GPL 2.0" },
  { value: "LGPL-3.0", label: "LGPL 3.0" },
  { value: "MPL-2.0", label: "MPL 2.0" },
  { value: "Unlicense", label: "Unlicense" },
  { value: "ISC", label: "ISC" },
  { value: "0BSD", label: "Zero-Clause BSD" },
];

const SECRET_ACTIONS = [
  { value: "drop", label: "Drop — remove files containing secrets" },
  { value: "redact", label: "Redact — replace secret lines with [REDACTED]" },
];

export async function initCommand(outputPath?: string): Promise<void> {
  console.log(`\n${picocolors.bold(picocolors.cyan("RepoSift"))} — ${picocolors.dim("Dataset builder for AI training data")}\n`);
  console.log(picocolors.dim("This wizard will walk you through creating a plan.me config file.\n"));

  const s = p.spinner();

  try {
    // ── Dataset basics ──
    const name = await p.text({
      message: "Dataset name",
      placeholder: "my-dataset",
      defaultValue: "my-dataset",
      validate: (v) => {
        if (!v || v.trim().length === 0) return "Name is required";
        if (!/^[a-zA-Z0-9_-]+$/.test(v.trim())) return "Only letters, numbers, hyphens, and underscores allowed";
      },
    });
    if (p.isCancel(name)) return cancel();

    const maxSizeGB = await p.text({
      message: "Maximum dataset size (GB)",
      placeholder: "10",
      defaultValue: "10",
      validate: (v) => {
        const n = Number(v);
        if (isNaN(n) || n <= 0) return "Must be a positive number";
        if (n > 1000) return "Max 1000 GB";
      },
    });
    if (p.isCancel(maxSizeGB)) return cancel();

    // ── Discovery ──
    console.log(`\n${picocolors.underline("Discovery Sources")} — ${picocolors.dim("Where to find repos")}\n`);

    const useSearch = await p.confirm({
      message: "Search GitHub by query (e.g., language, stars, keywords)?",
      initialValue: true,
    });
    if (p.isCancel(useSearch)) return cancel();

    let searchQuery: string | symbol | undefined;
    let searchLimit: string | symbol | undefined;
    if (useSearch) {
      searchQuery = await p.text({
        message: "GitHub search query",
        placeholder: 'language:TypeScript stars:>1000',
        defaultValue: "language:TypeScript stars:>500",
        validate: (v) => {
          if (!v || v.trim().length === 0) return "Query is required";
        },
      });
      if (p.isCancel(searchQuery)) return cancel();

      searchLimit = await p.text({
        message: "Max repos to collect from search",
        placeholder: "100",
        defaultValue: "100",
        validate: (v) => {
          const n = Number(v);
          if (isNaN(n) || n <= 0) return "Must be a positive number";
          if (n > 2000) return "Max 2000";
        },
      });
      if (p.isCancel(searchLimit)) return cancel();
    }

    const useUsers = await p.confirm({
      message: "Fetch repos from specific GitHub users or orgs?",
      initialValue: false,
    });
    if (p.isCancel(useUsers)) return cancel();

    let users: string[] = [];
    let perUserLimit: string | symbol | undefined;
    if (useUsers) {
      const userInput = await p.text({
        message: "GitHub usernames (comma-separated)",
        placeholder: "sindresorhus, vercel, microsoft",
        validate: (v) => {
          if (!v || v.trim().length === 0) return "At least one username required";
          const parts = v.split(",").map((s) => s.trim()).filter(Boolean);
          if (parts.length === 0) return "At least one username required";
        },
      });
      if (p.isCancel(userInput)) return cancel();
      users = (userInput as string).split(",").map((s) => s.trim()).filter(Boolean);

      perUserLimit = await p.text({
        message: "Max repos per user/org",
        placeholder: "100",
        defaultValue: "100",
        validate: (v) => {
          const n = Number(v);
          if (isNaN(n) || n <= 0) return "Must be a positive number";
          if (n > 2000) return "Max 2000";
        },
      });
      if (p.isCancel(perUserLimit)) return cancel();
    }

    const useExplicit = await p.confirm({
      message: "Add specific repos by name (e.g., facebook/react)?",
      initialValue: false,
    });
    if (p.isCancel(useExplicit)) return cancel();

    let explicitRepos: string[] = [];
    if (useExplicit) {
      const explicitInput = await p.text({
        message: "Comma-separated repo names (owner/repo)",
        placeholder: "facebook/react, vercel/next.js",
        validate: (v) => {
          if (!v || v.trim().length === 0) return "At least one repo required";
          const parts = v.split(",").map((s) => s.trim()).filter(Boolean);
          if (parts.length === 0) return "At least one repo required";
          for (const part of parts) {
            if (!part.includes("/")) return `"${part}" is not in owner/repo format`;
          }
        },
      });
      if (p.isCancel(explicitInput)) return cancel();
      explicitRepos = (explicitInput as string).split(",").map((s) => s.trim()).filter(Boolean);
    }

    // ── Filters ──
    console.log(`\n${picocolors.underline("Filters")} — ${picocolors.dim("Which repos to include")}\n`);

    const languages = await p.multiselect({
      message: "Languages to include (leave empty for all)",
      options: LANGUAGES,
      required: false,
    });
    if (p.isCancel(languages)) return cancel();

    const minStars = await p.text({
      message: "Minimum stars",
      placeholder: "50",
      defaultValue: "50",
      validate: (v) => {
        const n = Number(v);
        if (isNaN(n) || n < 0) return "Must be a non-negative number";
      },
    });
    if (p.isCancel(minStars)) return cancel();

    const licenses = await p.multiselect({
      message: "Allowed licenses (leave empty for all)",
      options: LICENSES,
      required: false,
      initialValues: ["MIT", "Apache-2.0", "BSD-3-Clause"],
    });
    if (p.isCancel(licenses)) return cancel();

    const requireDetected = await p.confirm({
      message: "Require license to be detected (repos with unknown license will be skipped)?",
      initialValue: true,
    });
    if (p.isCancel(requireDetected)) return cancel();

    // ── Processing ──
    console.log(`\n${picocolors.underline("Processing")} — ${picocolors.dim("How to handle files")}\n`);

    const dedupe = await p.confirm({
      message: "Enable content deduplication (skip duplicate files across repos)?",
      initialValue: true,
    });
    if (p.isCancel(dedupe)) return cancel();

    const secretScan = await p.confirm({
      message: "Scan for secrets/API keys in source files?",
      initialValue: true,
    });
    if (p.isCancel(secretScan)) return cancel();

    let secretAction: string | symbol = "drop";
    if (secretScan) {
      secretAction = await p.select({
        message: "How to handle files containing secrets?",
        options: SECRET_ACTIONS,
        initialValue: "drop",
      });
      if (p.isCancel(secretAction)) return cancel();
    }

    const concurrency = await p.text({
      message: "Concurrent downloads",
      placeholder: "5",
      defaultValue: "5",
      validate: (v) => {
        const n = Number(v);
        if (isNaN(n) || n <= 0) return "Must be a positive number";
        if (n > 20) return "Max 20 recommended";
      },
    });
    if (p.isCancel(concurrency)) return cancel();

    // ── Build YAML ──
    const lines: string[] = [];
    lines.push(`name: ${name}`);
    lines.push(`maxSizeGB: ${maxSizeGB}`);
    lines.push("");

    // Discovery
    const hasDiscovery = useSearch || useUsers || useExplicit;
    if (hasDiscovery) {
      lines.push("discovery:");

      if (useSearch && searchQuery) {
        lines.push("  search:");
        lines.push(`    query: "${String(searchQuery)}"`);
        lines.push(`    limit: ${String(searchLimit ?? 100)}`);
      }

      if (users.length > 0) {
        lines.push("  users:");
        for (const user of users) {
          lines.push(`    - ${user}`);
        }
        lines.push(`  perUserLimit: ${String(perUserLimit)}`);
      }

      if (explicitRepos.length > 0) {
        lines.push("  explicitRepos:");
        for (const repo of explicitRepos) {
          lines.push(`    - "${repo}"`);
        }
      }
    }
    lines.push("");

    // Licenses
    const licenseValues = licenses as string[];
    if (licenseValues.length > 0) {
      lines.push("licenses:");
      lines.push("  allow:");
      for (const lic of licenseValues) {
        lines.push(`    - ${lic}`);
      }
      lines.push(`  requireDetected: ${requireDetected}`);
    }
    lines.push("");

    // Stars
    lines.push("stars:");
    lines.push(`  min: ${minStars}`);
    lines.push("");

    // Languages
    const langValues = languages as string[];
    if (langValues.length > 0) {
      lines.push("languages:");
      lines.push("  allow:");
      for (const lang of langValues) {
        lines.push(`    - ${lang}`);
      }
      lines.push("");
    }

    // Exclude (defaults, written explicitly for clarity)
    lines.push("exclude:");
    lines.push("  paths:");
    lines.push("    - node_modules");
    lines.push("    - vendor");
    lines.push("    - dist");
    lines.push("    - build");
    lines.push('    - "*.min.js"');
    lines.push('    - "*.lock"');
    lines.push("  extensions:");
    lines.push("    - .png");
    lines.push("    - .jpg");
    lines.push("    - .svg");
    lines.push("    - .woff");
    lines.push("    - .zip");
    lines.push("    - .exe");
    lines.push("    - .bin");
    lines.push("    - .pdf");
    lines.push(`  maxFileSizeKB: ${500}`);
    lines.push("");

    // Dedupe
    lines.push("dedupe:");
    lines.push(`  enabled: ${String(dedupe)}`);
    lines.push("");

    // Secret scan
    lines.push("secretScan:");
    lines.push(`  enabled: ${String(secretScan)}`);
    lines.push(`  action: ${String(secretAction)}`);
    lines.push("");

    // Output
    lines.push("output:");
    lines.push("  format: raw+jsonl");
    lines.push("");

    // Auth
    lines.push("auth:");
    lines.push("  tokenEnv: GITHUB_TOKEN");
    lines.push("");

    // Concurrency
    lines.push(`concurrency: ${concurrency}`);

    const yaml = lines.join("\n") + "\n";

    // ── Confirm and write ──
    console.log(`\n${picocolors.underline("Preview")}\n`);
    console.log(picocolors.dim(yaml));

    const confirm = await p.confirm({
      message: "Write this plan.me file?",
      initialValue: true,
    });
    if (p.isCancel(confirm) || !confirm) return cancel();

    s.start("Writing plan.me...");

    const dest = outputPath ? resolve(outputPath) : resolve("plan.me");
    writeFileSync(dest, yaml, "utf-8");

    s.stop(`Created ${picocolors.green(dest)}`);

    console.log(`\n${picocolors.dim("Next steps:")}`);
    console.log(`  ${picocolors.cyan("reposift run plan.me")}     ${picocolors.dim("Build your dataset")}`);
    console.log(`  ${picocolors.cyan("reposift run plan.me -v")}  ${picocolors.dim("Verbose mode for debugging")}`);
    console.log("");

  } catch (err) {
    s.stop("Failed");
    console.error(picocolors.red(`Error: ${(err as Error).message}`));
    process.exitCode = 1;
  }
}

function cancel(): void {
  p.cancel("Cancelled — no file written.");
  process.exit(0);
}
