import {
  existsSync,
  readFileSync,
  readdirSync,
  statSync,
  mkdirSync,
  writeFileSync,
  copyFileSync,
  rmSync,
} from "node:fs";
import { join, extname, relative, dirname } from "node:path";
import { tmpdir } from "node:os";
import { mkdtempSync } from "node:fs";
import AdmZip from "adm-zip";
import picocolors from "picocolors";

// ── Config ──

interface FilterConfig {
  /** File extensions to keep */
  keepExtensions: string[];
  /** Path patterns to always remove */
  removePaths: string[];
  /** File patterns to remove (glob-like) */
  removeFilePatterns: string[];
  /** If true, keep test files, examples, docs */
  debugMode: boolean;
}

const DEFAULT_CONFIG: FilterConfig = {
  keepExtensions: [".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs", ".json", ".md"],
  removePaths: [
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
  ],
  removeFilePatterns: [
    "*.min.js",
    "*.min.css",
    "*.lock",
    "*.map",
    "package-lock.json",
    "yarn.lock",
    "pnpm-lock.yaml",
    "tsconfig.tsbuildinfo",
  ],
  debugMode: false,
};

const DEBUG_REMOVE_PATHS = ["test", "tests", "__tests__", "__snapshots__", "fixture", "fixtures", "spec", "specs"];
const DEBUG_REMOVE_FILE_PATTERNS: string[] = [];

// ── Helpers ──

function shouldRemove(
  relPath: string,
  config: FilterConfig,
): { remove: boolean; reason?: string } {
  const normalized = relPath.replace(/\\/g, "/");

  // Check path removal
  for (const pattern of config.removePaths) {
    if (
      normalized === pattern ||
      normalized.startsWith(`${pattern}/`) ||
      normalized.includes(`/${pattern}/`)
    ) {
      return { remove: true, reason: `path: ${pattern}` };
    }
  }

  // Check file patterns
  const fileName = normalized.split("/").pop() ?? "";
  for (const filePattern of config.removeFilePatterns) {
    if (filePattern.startsWith("*.")) {
      const suffix = filePattern.slice(1); // e.g., ".min.js"
      if (fileName.endsWith(suffix)) {
        return { remove: true, reason: `pattern: ${filePattern}` };
      }
    } else if (fileName === filePattern) {
      return { remove: true, reason: `file: ${filePattern}` };
    }
  }

  // Check debug mode — don't remove test/example/doc paths
  if (!config.debugMode) {
    for (const pattern of DEBUG_REMOVE_PATHS) {
      if (
        normalized === pattern ||
        normalized.startsWith(`${pattern}/`) ||
        normalized.includes(`/${pattern}/`)
      ) {
        return { remove: true, reason: `excluded path: ${pattern}` };
      }
    }
    for (const pattern of DEBUG_REMOVE_FILE_PATTERNS) {
      if (fileName === pattern) {
        return { remove: true, reason: `excluded file: ${pattern}` };
      }
    }
  }

  return { remove: false };
}

function shouldKeepExtension(ext: string, config: FilterConfig): boolean {
  return config.keepExtensions.includes(ext.toLowerCase());
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

// ── Main ──

export interface FilterOptions {
  output: string;
  debug?: boolean;
  verbose?: boolean;
}

export async function filterCommand(
  inputPath: string,
  options: FilterOptions,
): Promise<void> {
  const resolvedInput = join(process.cwd(), inputPath);
  const resolvedOutput = join(process.cwd(), options.output);
  let cleanupTemp: (() => void) | null = null;

  const config: FilterConfig = {
    ...DEFAULT_CONFIG,
    debugMode: options.debug ?? false,
  };

  if (options.verbose) {
    console.log(
      `${picocolors.dim("▸")} Mode: ${config.debugMode ? picocolors.magenta("debug") : picocolors.cyan("default")}`,
    );
    console.log(
      `${picocolors.dim("▸")} Keeping extensions: ${config.keepExtensions.join(", ")}`,
    );
    if (config.debugMode) {
      console.log(
        `${picocolors.dim("▸")} Also keeping: test, examples, docs directories`,
      );
    }
  }

  try {
    // Validate input
    if (!existsSync(resolvedInput)) {
      console.error(
        `${picocolors.red("✘")} Input not found: "${resolvedInput}"`,
      );
      process.exitCode = 1;
      return;
    }

    // Handle zip input
    let workingDir = resolvedInput;
    const isZip =
      !statSync(resolvedInput).isDirectory() &&
      resolvedInput.toLowerCase().endsWith(".zip");

    if (isZip) {
      if (options.verbose) {
        console.log(`${picocolors.dim("▸")} Extracting .zip...`);
      }
      const tempDir = mkdtempSync(join(tmpdir(), "reposift-filter-"));
      const zip = new AdmZip(resolvedInput);
      zip.extractAllTo(tempDir, true);
      workingDir = tempDir;
      cleanupTemp = () => {
        try {
          rmSync(tempDir, { recursive: true, force: true });
        } catch { /* best effort */ }
      };
    }

    // Find data directory
    let dataDir: string | null = null;
    const direct = join(workingDir, "data");
    if (existsSync(direct) && statSync(direct).isDirectory()) {
      dataDir = direct;
    } else {
      // Check if the root itself has repo__ subdirectories
      const entries = readdirSync(workingDir);
      if (entries.some((e) => e.includes("__"))) {
        dataDir = workingDir;
      }
    }

    if (!dataDir) {
      console.error(
        `${picocolors.red("✘")} No data directory found in "${resolvedInput}".\n` +
          "  Make sure the input contains a 'data/' folder with repo subdirectories.",
      );
      process.exitCode = 1;
      return;
    }

    // Prepare output
    const outputDataDir = join(resolvedOutput, "data");
    mkdirSync(outputDataDir, { recursive: true });

    // Walk and filter
    const repoDirs = readdirSync(dataDir).filter((entry) => {
      const fullPath = join(dataDir, entry);
      return statSync(fullPath).isDirectory();
    });

    let totalKept = 0;
    let totalSkipped = 0;
    let skippedGenerated = 0;
    let skippedExtension = 0;
    let totalBytesKept = 0;
    let repoCount = 0;

    for (const repoDirName of repoDirs) {
      // Skip if it doesn't look like a repo dir
      if (!repoDirName.includes("__")) continue;

      const repoSource = join(dataDir, repoDirName);
      const repoDest = join(outputDataDir, repoDirName);
      mkdirSync(repoDest, { recursive: true });
      repoCount++;

    let repoKept = 0;
    let repoSkipped = 0;

    // Hoisted helper to count files in a directory subtree
    const countDir = (d: string): number => {
      let c = 0;
      try {
        const ents = readdirSync(d, { withFileTypes: true });
        for (const e of ents) {
          const fp = join(d, e.name);
          if (e.isDirectory()) c += countDir(fp);
          else if (e.isFile()) c++;
        }
      } catch { /* */ }
      return c;
    };

    const walkDir = (dirPath: string): void => {
        const relToData = relative(dataDir, dirPath);
        let entries: string[];
        try {
          entries = readdirSync(dirPath);
        } catch {
          return;
        }

        for (const entry of entries) {
          const fullPath = join(dirPath, entry);
          let fileStat;
          try {
            fileStat = statSync(fullPath);
          } catch {
            continue;
          }

          if (fileStat.isDirectory()) {
            // Check if directory should be entirely removed
            const dirRelPath = join(relToData, entry);
            const { remove } = shouldRemove(dirRelPath, config);
            if (remove) {
              const skippedInDir = countDir(fullPath);
              skippedGenerated += skippedInDir;
              totalSkipped += skippedInDir;
              if (options.verbose) {
                console.log(
                  `  ${picocolors.red("✘")} ${picocolors.dim(join(relToData, entry))}/  (removed: ${formatCount(skippedInDir)} files)`,
                );
              }
              continue;
            }
            walkDir(fullPath);
          } else if (fileStat.isFile()) {
            const fileRelPath = join(relToData, entry);
            const ext = extname(entry).toLowerCase();

            // Check extension
            if (!shouldKeepExtension(ext, config)) {
              skippedExtension++;
              totalSkipped++;
              continue;
            }

            // Check path/file patterns
            const { remove, reason } = shouldRemove(fileRelPath, config);
            if (remove) {
              skippedGenerated++;
              totalSkipped++;
              if (options.verbose) {
                console.log(
                  `  ${picocolors.red("✘")} ${picocolors.dim(fileRelPath)}  (${reason})`,
                );
              }
              continue;
            }

            // Copy the file
            const destPath = join(outputDataDir, fileRelPath);
            const destDir = dirname(destPath);
            mkdirSync(destDir, { recursive: true });
            try {
              copyFileSync(fullPath, destPath);
            } catch {
              continue;
            }

            totalKept++;
            repoKept++;
            totalBytesKept += fileStat.size;
          }
        }
      };

      walkDir(repoSource);

      // Remove repo dir if nothing was kept
      if (repoKept === 0) {
        try {
          rmSync(repoDest, { recursive: true, force: true });
        } catch { /* best effort */ }
        repoCount--;
      }
    }

    // Copy metadata files (manifest.json, stats.json, metadata.jsonl, plan.me)
    const metadataFiles = [
      "manifest.json",
      "stats.json",
      "metadata.jsonl",
      "plan.me",
    ];

    let metadataCopied = 0;
    for (const file of metadataFiles) {
      const src = join(workingDir, file);
      if (existsSync(src)) {
        try {
          // Copy — note: manifest.json and stats.json will have stale counts
          copyFileSync(src, join(resolvedOutput, file));
          metadataCopied++;
        } catch { /* best effort */ }
      }
    }

    // Print summary
    const pctKept = totalKept + totalSkipped > 0
      ? ((totalKept / (totalKept + totalSkipped)) * 100).toFixed(1)
      : "0.0";

    console.log(`\n${picocolors.bold(picocolors.cyan("Filter Complete"))}`);
    console.log(picocolors.dim("═".repeat(50)));
    console.log(
      `  ${picocolors.bold("Input:")}    ${picocolors.dim(resolvedInput)}`,
    );
    console.log(
      `  ${picocolors.bold("Output:")}   ${picocolors.white(resolvedOutput)}`,
    );
    console.log(
      `  ${picocolors.bold("Repos:")}    ${picocolors.white(formatCount(repoCount))}`,
    );
    console.log(
      `  ${picocolors.bold("Kept:")}     ${picocolors.green(formatCount(totalKept))} files  ${picocolors.dim(formatSize(totalBytesKept))}`,
    );
    console.log(
      `  ${picocolors.bold("Removed:")}  ${picocolors.red(formatCount(totalSkipped))} files`,
    );
    if (options.verbose) {
      console.log(
        `  ${picocolors.dim("  removed (extension):")} ${formatCount(skippedExtension)}`,
      );
      console.log(
        `  ${picocolors.dim("  removed (generated):")} ${formatCount(skippedGenerated)}`,
      );
    }
    console.log(
      `  ${picocolors.bold("Kept %:")}   ${picocolors.white(pctKept)}%`,
    );
    if (metadataCopied > 0) {
      console.log(
        `  ${picocolors.dim(`Metadata: ${metadataCopied} file(s) copied`)}`,
      );
    }
    console.log(picocolors.dim("═".repeat(50)));

    // Warning about stale metadata
    if (metadataCopied > 0) {
      console.log(
        `  ${picocolors.yellow("⚠")} ${picocolors.dim("manifest.json and stats.json are from the original dataset.")}`,
      );
      console.log(
        `    ${picocolors.dim("Run")} ${picocolors.cyan("reposift inspect <output>")} ${picocolors.dim("for accurate filtered stats.")}`,
      );
    }

    // Quick tip
    console.log(
      `\n  ${picocolors.dim("Tip:")} Run ${picocolors.cyan("reposift inspect <output>")} to analyze the filtered dataset.\n`,
    );
  } finally {
    if (cleanupTemp) cleanupTemp();
  }
}
