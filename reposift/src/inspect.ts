import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join, extname, relative } from "node:path";
import { tmpdir } from "node:os";
import { mkdtempSync, rmSync } from "node:fs";
import AdmZip from "adm-zip";
import picocolors from "picocolors";

interface ExtensionInfo {
  count: number;
  sizeBytes: number;
}

interface RepoInfo {
  name: string;
  fileCount: number;
  sizeBytes: number;
  stars?: number;
}

interface FileCategories {
  source: { count: number; sizeBytes: number };
  test: { count: number; sizeBytes: number };
  docs: { count: number; sizeBytes: number };
  config: { count: number; sizeBytes: number };
  generated: { count: number; sizeBytes: number };
  other: { count: number; sizeBytes: number };
}

// Extension → language group mapping for the report
const LANGUAGE_GROUP: Record<string, string> = {
  ".ts": "TypeScript",
  ".tsx": "TypeScript",
  ".mts": "TypeScript",
  ".cts": "TypeScript",
  ".js": "JavaScript",
  ".jsx": "JavaScript",
  ".mjs": "JavaScript",
  ".cjs": "JavaScript",
  ".md": "Markdown",
  ".mdx": "Markdown",
  ".rst": "Markdown",
  ".json": "JSON",
  ".css": "CSS/HTML",
  ".scss": "CSS/HTML",
  ".less": "CSS/HTML",
  ".html": "CSS/HTML",
  ".htm": "CSS/HTML",
  ".yaml": "Config",
  ".yml": "Config",
  ".toml": "Config",
  ".ini": "Config",
  ".cfg": "Config",
  ".xml": "Config",
  ".svg": "Asset",
  ".png": "Asset",
  ".jpg": "Asset",
  ".jpeg": "Asset",
  ".gif": "Asset",
  ".ico": "Asset",
  ".woff": "Asset",
  ".woff2": "Asset",
  ".ttf": "Asset",
  ".eot": "Asset",
};

// Path patterns that indicate generated/vendor content
const GENERATED_PATTERNS = [
  "node_modules",
  "vendor",
  "dist",
  "build",
  "coverage",
  ".next",
  ".nuxt",
  ".git",
  ".cache",
  "__pycache__",
  ".parcel-cache",
  ".turbo",
  "out",
  "target",
  ".nx",
];

const GENERATED_EXT_PATTERNS = [".min.js", ".min.css"];

// Path patterns that indicate test files
const TEST_PATTERNS = [
  "/test/",
  "/tests/",
  "/__tests__/",
  "/__snapshots__/",
  "/spec/",
  "/specs/",
  ".test.",
  ".spec.",
  "-test.",
  "-spec.",
  "_test.",
  "_spec.",
  "/fixture/",
  "/fixtures/",
  "/testing/",
];

// Path patterns that indicate docs/examples
const DOCS_PATTERNS = [
  "/docs/",
  "/documentation/",
  "/examples/",
  "/example/",
  "/demo/",
  "/demos/",
  "/tutorial/",
  "/tutorials/",
  "/guides/",
  "/recipes/",
];

function isGeneratedPath(filePath: string): boolean {
  const normalized = filePath.replace(/\\/g, "/");
  for (const pattern of GENERATED_PATTERNS) {
    if (
      normalized.includes(`/${pattern}/`) ||
      normalized.startsWith(`${pattern}/`) ||
      normalized === pattern
    ) {
      return true;
    }
  }
  for (const ext of GENERATED_EXT_PATTERNS) {
    if (normalized.endsWith(ext)) return true;
  }
  if (
    normalized.endsWith(".lock") ||
    normalized.endsWith(".map") ||
    normalized.endsWith("package-lock.json") ||
    normalized.endsWith("yarn.lock") ||
    normalized.endsWith("pnpm-lock.yaml") ||
    normalized.endsWith(".generated.")
  ) {
    return true;
  }
  return false;
}

function isTestFile(filePath: string): boolean {
  const normalized = filePath.replace(/\\/g, "/");
  for (const pattern of TEST_PATTERNS) {
    if (normalized.includes(pattern)) return true;
  }
  return false;
}

function isDocFile(filePath: string): boolean {
  const normalized = filePath.replace(/\\/g, "/");
  for (const pattern of DOCS_PATTERNS) {
    if (normalized.includes(pattern)) return true;
  }
  return false;
}

function getLangGroup(ext: string): string {
  return LANGUAGE_GROUP[ext] ?? "Other";
}

function formatSize(bytes: number): string {
  if (bytes > 1024 * 1024 * 1024) {
    return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
  }
  if (bytes > 1024 * 1024) {
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  }
  if (bytes > 1024) {
    return `${(bytes / 1024).toFixed(0)} KB`;
  }
  return `${bytes} B`;
}

function formatCount(n: number): string {
  return n.toLocaleString("en-US");
}

// ──────────────────────────────────────────
// Try to read a JSON file, returning undefined on failure
function tryReadJson(filePath: string): Record<string, unknown> | undefined {
  try {
    const content = readFileSync(filePath, "utf-8");
    return JSON.parse(content);
  } catch {
    return undefined;
  }
}

// ──────────────────────────────────────────
// Extract zip to temp dir and return the path
function extractZipToTemp(zipPath: string): string {
  const tempDir = mkdtempSync(join(tmpdir(), "reposift-inspect-"));
  const zip = new AdmZip(zipPath);
  zip.extractAllTo(tempDir, true);
  return tempDir;
}

// ──────────────────────────────────────────
// Find the data directory within a path
function findDataDir(rootPath: string): string | null {
  // Direct: path/data/
  const direct = join(rootPath, "data");
  if (existsSync(direct) && statSync(direct).isDirectory()) {
    return direct;
  }
  // The root itself is the data dir?
  if (existsSync(rootPath) && statSync(rootPath).isDirectory()) {
    // Check if it has repo__name subdirectories
    const entries = readdirSync(rootPath);
    if (entries.some((e) => e.includes("__"))) {
      return rootPath;
    }
  }
  return null;
}

// ──────────────────────────────────────────
export interface InspectOptions {
  verbose?: boolean;
}

export async function inspectCommand(
  inputPath: string,
  options: InspectOptions,
): Promise<void> {
  const resolvedPath = inputPath ? join(process.cwd(), inputPath) : process.cwd();
  let cleanupTemp: (() => void) | null = null;

  try {
    // Determine if input is a zip or directory
    let workingDir = resolvedPath;
    const isZip =
      existsSync(resolvedPath) &&
      !statSync(resolvedPath).isDirectory() &&
      resolvedPath.toLowerCase().endsWith(".zip");

    if (isZip) {
      workingDir = extractZipToTemp(resolvedPath);
      cleanupTemp = () => {
        try {
          rmSync(workingDir, { recursive: true, force: true });
        } catch { /* best effort */ }
      };
    }

    // Find the data directory
    const dataDir = findDataDir(workingDir);
    if (!dataDir) {
      console.error(
        `${picocolors.red("✘")} Could not find a data directory in "${resolvedPath}".\n` +
          "  Make sure the path points to a dataset output directory (containing a 'data/' folder) or a .zip file.",
      );
      process.exitCode = 1;
      return;
    }

    // Try to read stats.json and manifest.json if they exist
    const statsJson = tryReadJson(join(workingDir, "stats.json"));
    const manifestJson = tryReadJson(join(workingDir, "manifest.json"));

    // Collect dataset name
    const datasetName =
      (statsJson?.name as string) ??
      (manifestJson ? "unknown" : undefined);

    // Walk the data directory
    const extensionBreakdown: Record<string, ExtensionInfo> = {};
    const repoInfo: Record<string, RepoInfo> = {};
    const categories: FileCategories = {
      source: { count: 0, sizeBytes: 0 },
      test: { count: 0, sizeBytes: 0 },
      docs: { count: 0, sizeBytes: 0 },
      config: { count: 0, sizeBytes: 0 },
      generated: { count: 0, sizeBytes: 0 },
      other: { count: 0, sizeBytes: 0 },
    };

    let totalFiles = 0;
    let totalSizeBytes = 0;
    let tsFiles = 0;
    let tsSizeBytes = 0;

    // Detect if we have repo subdirectories
    const repoDirs = readdirSync(dataDir).filter((entry) => {
      const fullPath = join(dataDir, entry);
      return statSync(fullPath).isDirectory();
    });

    if (repoDirs.length === 0) {
      console.error(
        `${picocolors.red("✘")} No repo directories found in data directory.\n` +
          "  The data/ folder should contain subdirectories named like 'owner__repo'.",
      );
      process.exitCode = 1;
      return;
    }

    const totalRepos = repoDirs.length;

    // Build manifest lookup for star counts
    const manifestStars: Record<string, number> = {};
    if (Array.isArray(manifestJson)) {
      for (const entry of manifestJson) {
        const entry_ = entry as Record<string, unknown>;
        const fullName = entry_.fullName as string | undefined;
        const stars = entry_.stars as number | undefined;
        if (fullName && stars !== undefined) {
          manifestStars[fullName] = stars;
        }
      }
    }

    // Walk each repo directory
    for (const repoDirName of repoDirs) {
      const repoRoot = join(dataDir, repoDirName);
      const repoName = repoDirName.replace("__", "/");

      let repoFiles = 0;
      let repoBytes = 0;

      const walkDir = (dirPath: string): void => {
        let entries: string[];
        try {
          entries = readdirSync(dirPath);
        } catch {
          return;
        }

        for (const entry of entries) {
          const fullPath = join(dirPath, entry);
          let stat;
          try {
            stat = statSync(fullPath);
          } catch {
            continue;
          }

          if (stat.isDirectory()) {
            walkDir(fullPath);
          } else if (stat.isFile()) {
            const relPath = relative(dataDir, fullPath);
            const ext = extname(entry).toLowerCase();
            const size = stat.size;

            totalFiles++;
            totalSizeBytes += size;
            repoFiles++;
            repoBytes += size;

            // Extension breakdown
            if (!extensionBreakdown[ext]) {
              extensionBreakdown[ext] = { count: 0, sizeBytes: 0 };
            }
            extensionBreakdown[ext].count++;
            extensionBreakdown[ext].sizeBytes += size;

            // TS files tracking
            if (ext === ".ts" || ext === ".tsx" || ext === ".mts" || ext === ".cts") {
              tsFiles++;
              tsSizeBytes += size;
            }

            // Categorization
            if (isGeneratedPath(relPath)) {
              categories.generated.count++;
              categories.generated.sizeBytes += size;
            } else if (ext === ".ts" || ext === ".tsx" || ext === ".js" || ext === ".jsx" || ext === ".mjs" || ext === ".cjs") {
              if (isTestFile(relPath)) {
                categories.test.count++;
                categories.test.sizeBytes += size;
              } else {
                categories.source.count++;
                categories.source.sizeBytes += size;
              }
            } else if (ext === ".md" || ext === ".mdx" || ext === ".rst") {
              if (isDocFile(relPath)) {
                categories.docs.count++;
                categories.docs.sizeBytes += size;
              } else if (isTestFile(relPath)) {
                categories.test.count++;
                categories.test.sizeBytes += size;
              } else {
                categories.source.count++;
                categories.source.sizeBytes += size;
              }
            } else if (ext === ".json" || ext === ".yaml" || ext === ".yml" || ext === ".toml") {
              categories.config.count++;
              categories.config.sizeBytes += size;
            } else if (ext === ".css" || ext === ".scss" || ext === ".less" || ext === ".html" || ext === ".htm") {
              categories.source.count++;
              categories.source.sizeBytes += size;
            } else {
              categories.other.count++;
              categories.other.sizeBytes += size;
            }
          }
        }
      };

      walkDir(repoRoot);

      // Look up stars from manifest
      const stars = manifestStars[repoName];
      repoInfo[repoName] = {
        name: repoName,
        fileCount: repoFiles,
        sizeBytes: repoBytes,
        stars,
      };
    }

    // ── Generate the report ──

    // Sort repos by file count descending
    const sortedRepos = Object.values(repoInfo).sort(
      (a, b) => b.fileCount - a.fileCount,
    );

    // Build language group breakdown from extensions
    const langGroups: Record<string, { count: number; sizeBytes: number }> = {};
    for (const [ext, info] of Object.entries(extensionBreakdown)) {
      const group = getLangGroup(ext);
      if (!langGroups[group]) {
        langGroups[group] = { count: 0, sizeBytes: 0 };
      }
      langGroups[group].count += info.count;
      langGroups[group].sizeBytes += info.sizeBytes;
    }
    // Add generated files as their own group
    const generatedCount = categories.generated.count;

    const sortedLangGroups = Object.entries(langGroups)
      .filter(([, info]) => info.count > 0)
      .sort((a, b) => b[1].count - a[1].count);

    // Compute duplicate percentage
    const duplicatesSkipped = (statsJson?.duplicatesSkipped as number) ?? 0;
    const dupPct =
      totalFiles > 0
        ? ((duplicatesSkipped / (totalFiles + duplicatesSkipped)) * 100).toFixed(1)
        : "0.0";

    // ── Print the report ──

    const bar = picocolors.dim("═".repeat(50));

    console.log(`\n${picocolors.bold(picocolors.cyan("Dataset Inspection Report"))}`);
    console.log(bar);
    if (datasetName) {
      console.log(`  ${picocolors.bold("Dataset:")}  ${picocolors.white(datasetName)}`);
    }
    console.log(`  ${picocolors.bold("Source:")}   ${picocolors.dim(resolvedPath)}`);
    console.log(bar);
    console.log(
      `  ${picocolors.bold("Total files:")}  ${picocolors.white(formatCount(totalFiles))}`,
    );
    console.log(
      `  ${picocolors.bold("Total size:")}   ${picocolors.white(formatSize(totalSizeBytes))}`,
    );
    console.log(
      `  ${picocolors.bold("Total repos:")}  ${picocolors.white(formatCount(totalRepos))}`,
    );
    if (duplicatesSkipped > 0) {
      console.log(
        `  ${picocolors.bold("Duplicates:")}   ${picocolors.yellow(`${formatCount(duplicatesSkipped)} (${dupPct}%)`)}`,
      );
    }
    console.log("");

    // Language groups
    console.log(`${picocolors.bold("Most Common Languages:")}`);
    for (const [group, info] of sortedLangGroups) {
      const pct = ((info.count / totalFiles) * 100).toFixed(1);
      const label = `${group}:`.padEnd(20);
      console.log(
        `  ${picocolors.cyan(label)} ${picocolors.white(formatCount(info.count))}  ${picocolors.dim(`(${pct}%)  ${formatSize(info.sizeBytes)}`)}`,
      );
    }
    if (generatedCount > 0) {
      const pct = ((generatedCount / totalFiles) * 100).toFixed(1);
      const genSize = categories.generated.sizeBytes;
      console.log(
        `  ${picocolors.red("Generated/Vendor:".padEnd(20))} ${picocolors.white(formatCount(generatedCount))}  ${picocolors.dim(`(${pct}%)  ${formatSize(genSize)}`)}`,
      );
    }
    console.log("");

    // File type breakdown
    console.log(`${picocolors.bold("File Type Breakdown:")}`);
    const sortedExtensions = Object.entries(extensionBreakdown)
      .filter(([, info]) => info.count > 0)
      .sort((a, b) => b[1].count - a[1].count);
    for (const [ext, info] of sortedExtensions.slice(0, 20)) {
      const pct = ((info.count / totalFiles) * 100).toFixed(1);
      console.log(
        `  ${picocolors.dim(ext.padEnd(12))} ${picocolors.white(formatCount(info.count).padStart(10))}  ${picocolors.dim(`(${pct}%)`)}  ${picocolors.dim(formatSize(info.sizeBytes))}`,
      );
    }
    if (sortedExtensions.length > 20) {
      console.log(
        `  ${picocolors.dim(`... and ${sortedExtensions.length - 20} more extensions`)}`,
      );
    }
    console.log("");

    // TS files
    const tsPct = ((tsFiles / totalFiles) * 100).toFixed(1);
    console.log(`${picocolors.bold("TypeScript Files:")}`);
    console.log(
      `  ${picocolors.cyan(`${formatCount(tsFiles)} files`.padEnd(20))} ${picocolors.dim(`(${tsPct}%)  ${formatSize(tsSizeBytes)}`)}`,
    );
    console.log("");

    // Useful source analysis
    console.log(`${picocolors.bold("Useful Source Files Analysis:")}`);

    const usefulCategories: Array<{
      label: string;
      color: (s: string) => string;
      count: number;
      sizeBytes: number;
    }> = [
      {
        label: "Source (.ts/.tsx/.js/.jsx)",
        color: picocolors.green,
        count: categories.source.count,
        sizeBytes: categories.source.sizeBytes,
      },
      {
        label: "Config/Data (.json/.yaml/.toml)",
        color: picocolors.blue,
        count: categories.config.count,
        sizeBytes: categories.config.sizeBytes,
      },
      {
        label: "Test files",
        color: picocolors.magenta,
        count: categories.test.count,
        sizeBytes: categories.test.sizeBytes,
      },
      {
        label: "Docs/Examples",
        color: picocolors.cyan,
        count: categories.docs.count,
        sizeBytes: categories.docs.sizeBytes,
      },
      {
        label: "Other",
        color: picocolors.dim,
        count: categories.other.count,
        sizeBytes: categories.other.sizeBytes,
      },
    ];

    const totalUseful =
      categories.source.count +
      categories.config.count +
      categories.test.count +
      categories.docs.count;

    const totalNotUseful = categories.generated.count + categories.other.count;
    const usefulPct = ((totalUseful / totalFiles) * 100).toFixed(1);

    for (const cat of usefulCategories) {
      const pct = ((cat.count / totalFiles) * 100).toFixed(1);
      console.log(
        `  ${cat.color(cat.label.padEnd(32))} ${picocolors.white(formatCount(cat.count).padStart(10))}  ${picocolors.dim(`(${pct}%)  ${formatSize(cat.sizeBytes)}`)}`,
      );
    }

    const genPct = ((totalNotUseful / totalFiles) * 100).toFixed(1);
    console.log(
      `  ${picocolors.red("Generated/Vendor/Other".padEnd(32))} ${picocolors.white(formatCount(totalNotUseful).padStart(10))}  ${picocolors.dim(`(${genPct}%)  ${formatSize(categories.generated.sizeBytes + categories.other.sizeBytes)}`)}`,
    );
    console.log(picocolors.dim("  " + "─".repeat(52)));
    console.log(
      `  ${picocolors.bold("Total useful".padEnd(32))} ${picocolors.white(formatCount(totalUseful).padStart(10))}  ${picocolors.green(`(${usefulPct}%)`)}`,
    );
    console.log(
      `  ${picocolors.dim("Total not useful".padEnd(32))} ${picocolors.white(formatCount(totalNotUseful).padStart(10))}  ${picocolors.red(`(${(100 - parseFloat(usefulPct)).toFixed(1)}%)`)}`,
    );
    console.log("");

    // Largest repos
    console.log(`${picocolors.bold("Largest Repos (by file count):")}`);
    const topN = Math.min(10, sortedRepos.length);
    for (let i = 0; i < topN; i++) {
      const r = sortedRepos[i];
      const starsStr = r.stars ? `  ⭐ ${formatCount(r.stars)}` : "";
      console.log(
        `  ${picocolors.dim(`${(i + 1).toString().padStart(2)}.`)} ${picocolors.white(r.name.padEnd(30))} ${picocolors.yellow(formatCount(r.fileCount).padStart(8))} files  ${picocolors.dim(formatSize(r.sizeBytes).padStart(9))}${starsStr}`,
      );
    }
    if (sortedRepos.length > 10) {
      console.log(
        `  ${picocolors.dim(`... and ${sortedRepos.length - 10} more repos`)}`,
      );
    }
    console.log("");

    // Largest repos by size
    const sortedBySize = Object.values(repoInfo).sort(
      (a, b) => b.sizeBytes - a.sizeBytes,
    );
    console.log(`${picocolors.bold("Largest Repos (by size):")}`);
    for (let i = 0; i < Math.min(10, sortedBySize.length); i++) {
      const r = sortedBySize[i];
      const starsStr = r.stars ? `  ⭐ ${formatCount(r.stars)}` : "";
      console.log(
        `  ${picocolors.dim(`${(i + 1).toString().padStart(2)}.`)} ${picocolors.white(r.name.padEnd(30))} ${picocolors.yellow(formatSize(r.sizeBytes).padStart(9))}  ${picocolors.dim(`${formatCount(r.fileCount)} files`)}${starsStr}`,
      );
    }
    console.log("");

    // Repos with most generated/vendor content
    // (We can't easily determine this per-repo without re-walking, skip for now)

    // Quick summary
    console.log(bar);
    console.log(
      `  ${picocolors.bold("Summary:")}  ${formatCount(totalUseful)}/${formatCount(totalFiles)} files useful for training  ${picocolors.green(`(${usefulPct}%)`)}`,
    );
    console.log(
      `  ${picocolors.bold("Filter:")}   reposift filter <input> <output>  to remove generated/vendor files`,
    );
    console.log(bar);
    console.log("");
  } finally {
    if (cleanupTemp) cleanupTemp();
  }
}
