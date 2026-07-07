#!/usr/bin/env node

import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync, rmSync } from "node:fs";
import { resolve, join, dirname, relative } from "node:path";
import { tmpdir } from "node:os";
import { Command } from "commander";
import { logger, LogLevel } from "./logger.js";
import { parsePlanMe } from "./config/parser.js";
import { RateLimiter } from "./discovery/rateLimiter.js";
import { searchRepos } from "./discovery/search.js";
import { reposByUsers } from "./discovery/byUser.js";
import { explicitRepos } from "./discovery/explicit.js";
import { mergeCandidates } from "./discovery/merge.js";
import { detectLicense } from "./license/detect.js";
import { fallbackDetectLicense } from "./license/fallback.js";
import { isLicenseAllowed } from "./license/allowlist.js";
import { downloadTarball } from "./fetch/tarball.js";
import { extractTarball } from "./fetch/extract.js";
import { isBinary } from "./filter/binaryDetect.js";
import { isExtensionAllowed, isLanguageExtensionAllowed } from "./filter/extensionRules.js";
import { isPathExcluded } from "./filter/pathRules.js";
import { scanForSecrets, redactSecrets } from "./filter/secretScan.js";
import { isWithinSizeLimit } from "./filter/sizeRules.js";
import { HashIndex } from "./dedupe/hashIndex.js";
import { SizeManager } from "./budget/sizeManager.js";
import { ManifestBuilder } from "./metadata/manifest.js";
import { JsonlWriter } from "./metadata/jsonlWriter.js";
import { buildZip } from "./package/zipper.js";
import { CheckpointManager } from "./state/checkpoint.js";
import type { RepoRecord } from "./metadata/repoRecord.js";
import pLimit from "p-limit";
import { initCommand } from "./init.js";
import { inspectCommand } from "./inspect.js";
import { filterCommand } from "./filter.js";
import { prepareCommand } from "./prepare.js";
import { uiCommand } from "./ui.js";
import cliProgress from "cli-progress";
import picocolors from "picocolors";

// Try to load .env file from CWD
try {
  const envPath = resolve(".env");
  if (existsSync(envPath)) {
    const envContent = readFileSync(envPath, "utf-8");
    for (const line of envContent.split("\n")) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const eqIdx = trimmed.indexOf("=");
      if (eqIdx === -1) continue;
      const key = trimmed.slice(0, eqIdx).trim();
      const value = trimmed.slice(eqIdx + 1).trim();
      const clean = value.replace(/^['"]|['"]$/g, "");
      if (!process.env[key]) {
        process.env[key] = clean;
      }
    }
  }
} catch {
  // .env loading is best-effort
}

const program = new Command();

program
  .name("reposift")
  .description("Scrape GitHub repos for AI training data — filtered, deduped, and packaged")
  .version("0.1.0");

program
  .command("ui")
  .description("Open interactive menu for all commands")
  .action(uiCommand);

program
  .command("init")
  .description("Interactively create a plan.me config file")
  .argument("[output-path]", "output path for plan.me (default: ./plan.me)")
  .action(initCommand);

program
  .command("inspect")
  .description("Analyze a dataset folder or .zip and print a detailed report")
  .argument("[input-path]", "path to dataset folder or .zip (default: current directory)")
  .option("-v, --verbose", "verbose debug output")
  .action(async (inputPath?: string, opts?: { verbose?: boolean }) => {
    await inspectCommand(inputPath ?? ".", { verbose: opts?.verbose ?? false });
  });

program
  .command("filter")
  .description("Filter a dataset, removing generated/vendor files, keeping useful source files")
  .argument("<input-path>", "path to dataset folder or .zip")
  .requiredOption("-o, --output <dir>", "output directory for filtered dataset")
  .option("--debug", "keep test files, examples, and docs (useful for debugging agent training)")
  .option("--split-docs", "separate .md/.mdx files into a parallel docs/ directory")
  .option("-v, --verbose", "verbose debug output")
  .action(async (inputPath: string, opts: { output: string; debug?: boolean; splitDocs?: boolean; verbose?: boolean }) => {
    await filterCommand(inputPath, { output: opts.output, debug: opts.debug, splitDocs: opts.splitDocs, verbose: opts.verbose });
  });

program
  .command("prepare")
  .description("Generate training examples from a filtered dataset for agent training")
  .argument("<input-path>", "path to filtered dataset (output of 'reposift filter')")
  .requiredOption("-o, --output <dir>", "output directory for training examples")
  .option("-m, --mode <mode>", "example type: explain | debug | all (default: all)")
  .option("--max-examples <n>", "maximum number of examples to generate", parseInt)
  .option("--max-file-size-kb <n>", "skip files larger than this (default: 50)", parseInt)
  .option("-v, --verbose", "verbose debug output")
  .action(async (inputPath: string, opts: { output: string; mode?: string; maxExamples?: number; maxFileSizeKB?: number; verbose?: boolean }) => {
    const mode = (opts.mode ?? "all") as "explain" | "debug" | "all";
    if (!["explain", "debug", "all"].includes(mode)) {
      console.error(`Invalid mode "${mode}". Use explain, debug, or all.`);
      process.exitCode = 1;
      return;
    }
    await prepareCommand(inputPath, {
      output: opts.output,
      mode,
      maxExamples: opts.maxExamples,
      maxFileSizeKB: opts.maxFileSizeKB ?? 50,
      verbose: opts.verbose,
    });
  });

program
  .command("run")
  .description("Run a dataset build from a plan.me config file")
  .argument("<plan-me-path>", "path to plan.me YAML config")
  .option("-o, --output <dir>", "output directory (default: ./output/<name>)")
  .option("-v, --verbose", "verbose debug output")
  .option("--resume", "resume from last checkpoint")
  .action(runCommand);

export async function runCommand(
  planMePath: string,
  options: { output?: string; verbose?: boolean; resume?: boolean },
): Promise<void> {
  if (options.verbose) {
    logger.setLevel(LogLevel.DEBUG);
  }

  let isShuttingDown = false;
  const abortController = new AbortController();
  let progressBars: cliProgress.MultiBar | null = null;

  const handleSignal = () => {
    if (isShuttingDown) {
      logger.warn("Force quitting...");
      process.exit(1);
    }
    isShuttingDown = true;
    logger.warn("\nGracefully shutting down (press Ctrl+C again to force)...");
    abortController.abort();
  };
  process.on("SIGINT", handleSignal);
  process.on("SIGTERM", handleSignal);

  try {
    logger.step("Loading configuration");
    const absolutePath = resolve(planMePath);
    if (!existsSync(absolutePath)) {
      logger.fail(`plan.me file not found at "${absolutePath}"`);
      process.exitCode = 1;
      return;
    }

    const config = parsePlanMe(absolutePath);
    logger.success(`Loaded config: "${config.name}" (max ${config.maxSizeGB}GB)`);

    const outputDir = options.output
      ? resolve(options.output)
      : resolve("output", config.name);
    if (!existsSync(outputDir)) {
      mkdirSync(outputDir, { recursive: true });
    }

    const tokenEnv = config.auth.tokenEnv;
    const token = process.env[tokenEnv];
    if (!token) {
      logger.fail(`GitHub token not found. Set ${tokenEnv} environment variable (or create a .env file).`);
      process.exitCode = 1;
      return;
    }

    const limiter = new RateLimiter();
    const sizeManager = new SizeManager(config.maxSizeGB);
    const hashIndex = new HashIndex();
    const manifest = new ManifestBuilder();
    const checkpoint = new CheckpointManager(config.name, outputDir);
    const concurrency = pLimit(config.concurrency);

    const dataDir = join(outputDir, "data");
    if (!existsSync(dataDir)) {
      mkdirSync(dataDir, { recursive: true });
    }

    const jsonlPath = join(outputDir, "metadata.jsonl");
    const jsonlWriter = new JsonlWriter(jsonlPath);

    // Phase 1: Discovery
    logger.step("Discovering repositories");

    const discoveryTasks: Array<{ name: string; promise: Promise<RepoRecord[]> }> = [];

    if (config.discovery?.search) {
      logger.info(`Searching GitHub: "${config.discovery.search.query}"`);
      discoveryTasks.push({
        name: "search",
        promise: searchRepos(config.discovery.search, token, limiter, abortController.signal),
      });
    }

    if (config.discovery?.users && config.discovery.users.length > 0) {
      const perUserLimit = config.discovery.perUserLimit ?? 100;
      logger.info(`Fetching repos for ${config.discovery.users.length} users (limit: ${perUserLimit} per user)...`);
      discoveryTasks.push({
        name: "users",
        promise: reposByUsers(
          config.discovery.users,
          token,
          limiter,
          perUserLimit,
          abortController.signal,
          (user, page, count) => {
            logger.debug(`  ${user}: page ${page}, ${count} repos so far`);
          },
        ),
      });
    }

    if (config.discovery?.explicitRepos && config.discovery.explicitRepos.length > 0) {
      logger.info(`Fetching explicit repos: ${config.discovery.explicitRepos.join(", ")}`);
      discoveryTasks.push({
        name: "explicit",
        promise: explicitRepos(config.discovery.explicitRepos, token, limiter, abortController.signal),
      });
    }

    let candidates: RepoRecord[] = [];

    if (discoveryTasks.length > 0) {
      const results = await Promise.allSettled(discoveryTasks.map((t) => t.promise));
      const successful: RepoRecord[][] = [];
      for (let i = 0; i < results.length; i++) {
        const result = results[i];
        if (result.status === "fulfilled") {
          successful.push(result.value);
          logger.success(`${discoveryTasks[i].name}: ${result.value.length} repos found`);
        } else {
          logger.warn(`${discoveryTasks[i].name} discovery failed: ${result.reason?.message ?? "unknown error"}`);
        }
      }
      candidates = mergeCandidates(...successful);
      logger.success(`Discovered ${candidates.length} unique repos`);
    } else {
      logger.warn("No discovery sources configured in plan.me");
    }

    // Phase 2: Filter by license and stars
    logger.step("Filtering repositories (license + stars)");
    const licenseFilter = config.licenses;
    const starsFilter = config.stars;
    const allowedLanguages = config.languages?.allow;

    const eligible: RepoRecord[] = [];
    for (const repo of candidates) {
      if (abortController.signal.aborted) throw new DOMException("Aborted", "AbortError");

      if (options.resume && checkpoint.isRepoCompleted(repo.fullName)) {
        logger.debug(`Skipping already completed: ${repo.fullName}`);
        continue;
      }

      if (starsFilter.min > 0 && repo.stars < starsFilter.min) {
        logger.debug(`Skipping ${repo.fullName}: ${repo.stars} stars < ${starsFilter.min}`);
        continue;
      }

      if (allowedLanguages && allowedLanguages.length > 0 && repo.language) {
        const langOk = allowedLanguages.some(
          (a) => a.toLowerCase() === repo.language!.toLowerCase(),
        );
        if (!langOk) {
          logger.debug(`Skipping ${repo.fullName}: language "${repo.language}" not allowed`);
          continue;
        }
      }

      if (licenseFilter.requireDetected || licenseFilter.allow.length > 0) {
        let detectedLicense = repo.license ?? null;

        if (!detectedLicense) {
          try {
            detectedLicense = await detectLicense(repo.fullName, token, limiter);
          } catch (err) {
            logger.warn(`License detect failed for ${repo.fullName}: ${(err as Error).message}`);
          }
        }

        if (!detectedLicense) {
          try {
            detectedLicense = await fallbackDetectLicense(
              repo.fullName, repo.defaultBranch, token, limiter,
            );
          } catch (err) {
            logger.warn(`License fallback failed for ${repo.fullName}: ${(err as Error).message}`);
          }
        }

        if (!isLicenseAllowed(detectedLicense, licenseFilter.allow, licenseFilter.requireDetected)) {
          logger.debug(`Skipping ${repo.fullName}: license "${detectedLicense}" not allowed`);
          continue;
        }

        repo.license = detectedLicense ?? undefined;
      }

      eligible.push(repo);
    }

    logger.success(`${eligible.length} repos passed filtering`);

    if (eligible.length === 0) {
      logger.warn("No repos to process. Exiting.");
      return;
    }

    // ── Phase 3: Fetch and process with live progress bar ──
    logger.step("Fetching and processing repositories");
    logger.info(`Concurrency: ${config.concurrency}`);

    // Create progress bar
    progressBars = new cliProgress.MultiBar({
      format: (options, params, payload) => {
        const bar = cliProgress.Format.BarFormat(params.progress, options);
        const percent = Math.floor(params.progress * 100);
        const current = (payload as { currentRepo?: string }).currentRepo ?? "waiting...";
        return `${picocolors.cyan(" repos")} ${bar} ${picocolors.white(`${percent}%`)} | ${picocolors.yellow(`${params.value}/${params.total}`)} | ${picocolors.dim(current)}`;
      },
      barCompleteChar: "━",
      barIncompleteChar: "─",
      hideCursor: true,
      clearOnComplete: false,
      stopOnComplete: false,
    });

    const repoBar = progressBars.create(eligible.length, 0, { currentRepo: "starting..." });

    let processedCount = 0;
    let skippedDueToBudget = false;
    const results: Array<{ repo: string; files: number; bytes: number; ok: boolean }> = [];

    const processRepo = async (repo: RepoRecord): Promise<void> => {
      if (skippedDueToBudget || abortController.signal.aborted) return;

      // Check budget before starting
      if (sizeManager.isExceeded) {
        skippedDueToBudget = true;
        progressBars?.log(`${picocolors.yellow("⚠")} Size budget exceeded. Stopping new fetches.\n`);
        return;
      }

      // Update progress bar to show current repo
      repoBar.update({ currentRepo: `${repo.fullName}...` });

      const tmpTarball = join(tmpdir(), `reposift-${repo.fullName.replace("/", "__")}.tar.gz`);

      try {
        await downloadTarball(repo.fullName, repo.defaultBranch, tmpTarball, abortController.signal);
        repoBar.update({ currentRepo: `${repo.fullName} (extracting...)` });

        const extractDir = await extractTarball(tmpTarball);
        repoBar.update({ currentRepo: `${repo.fullName} (filtering...)` });

        let repoFiles = 0;
        let repoBytes = 0;

        const walkDir = (dir: string): void => {
          let entries;
          try {
            entries = readdirSync(dir, { withFileTypes: true });
          } catch {
            return;
          }

          for (const entry of entries) {
            const fullPath = join(dir, entry.name);
            const relPath = relative(extractDir, fullPath);

            if (entry.isDirectory()) {
              if (isPathExcluded(relPath, config.exclude.paths)) continue;
              walkDir(fullPath);
            } else if (entry.isFile()) {
              if (isPathExcluded(relPath, config.exclude.paths)) continue;
              if (!isExtensionAllowed(relPath, config.exclude.extensions)) continue;
              if (allowedLanguages && allowedLanguages.length > 0) {
                if (!isLanguageExtensionAllowed(relPath, allowedLanguages)) continue;
              }

              let content: Buffer;
              try {
                content = readFileSync(fullPath);
              } catch {
                continue;
              }

              if (!isWithinSizeLimit(content.length, config.exclude.maxFileSizeKB)) continue;
              if (isBinary(content)) continue;

              if (config.secretScan.enabled) {
                const textContent = content.toString("utf-8");
                const secrets = scanForSecrets(textContent);
                if (secrets.length > 0) {
                  if (config.secretScan.action === "drop") continue;
                  content = Buffer.from(redactSecrets(textContent, secrets), "utf-8");
                }
              }

              if (config.dedupe.enabled) {
                if (hashIndex.isDuplicate(content)) {
                  manifest.addDuplicate();
                  continue;
                }
              }

              if (!sizeManager.tryAdd(content.length)) {
                skippedDueToBudget = true;
                continue;
              }

              const destPath = join(dataDir, `${repo.owner}__${repo.repo}`, relPath);
              const destDirPath = dirname(destPath);
              if (!existsSync(destDirPath)) mkdirSync(destDirPath, { recursive: true });

              try {
                writeFileSync(destPath, content);
              } catch {
                continue;
              }

              const fileHash = HashIndex.hashBuffer(content);
              jsonlWriter.write({
                repoOwner: repo.owner,
                repoName: repo.repo,
                repoFullName: repo.fullName,
                filePath: relPath,
                sizeBytes: content.length,
                sha256: fileHash,
                license: repo.license,
                language: repo.language,
                stars: repo.stars,
              });

              manifest.addFile(content.length);
              repoFiles++;
              repoBytes += content.length;
            }
          }
        };

        walkDir(extractDir);

        try {
          rmSync(tmpTarball, { force: true });
          rmSync(extractDir, { recursive: true, force: true });
        } catch { /* best effort */ }

        manifest.addRepo(repo, repoFiles, repoBytes);
        checkpoint.markRepoCompleted(repo.fullName, repoFiles, repoBytes);

        results.push({ repo: repo.fullName, files: repoFiles, bytes: repoBytes, ok: true });

        // Log completed repo above the progress bar
        const sizeLabel = repoBytes > 1024 * 1024
          ? `${(repoBytes / 1024 / 1024).toFixed(2)}MB`
          : `${(repoBytes / 1024).toFixed(1)}KB`;
        progressBars?.log(
          `  ${picocolors.green("✔")} ${picocolors.white(repo.fullName)} ${picocolors.dim(`— ${repoFiles} files, ${sizeLabel}`)}\n`,
        );

      } catch (err) {
        if ((err as Error).name === "AbortError") {
          try { rmSync(tmpTarball, { force: true }); } catch { /* best effort */ }
          throw err;
        }
        results.push({ repo: repo.fullName, files: 0, bytes: 0, ok: false });
        progressBars?.log(
          `  ${picocolors.red("✘")} ${picocolors.white(repo.fullName)} ${picocolors.dim(`— ${(err as Error).message}`)}\n`,
        );
      } finally {
        processedCount++;
        repoBar.update(processedCount, { currentRepo: skippedDueToBudget ? "budget exhausted" : "waiting..." });
      }
    };

    // Process repos with concurrency limit
    const processPromises = eligible.map((repo) => concurrency(() => processRepo(repo)));
    await Promise.allSettled(processPromises);

    // Stop progress bar
    progressBars.stop();
    progressBars = null;

    // Log a brief summary of the fetch phase
    const successCount = results.filter((r) => r.ok).length;
    const failCount = results.filter((r) => !r.ok).length;
    if (failCount > 0) {
      logger.info(`${picocolors.green(String(successCount))} repos succeeded, ${picocolors.red(String(failCount))} failed`);
    }

    // Phase 4: Build output
    logger.step("Building output package");

    await jsonlWriter.close();

    const stats = manifest.buildStats(config.name);
    const manifestEntries = manifest.buildManifest();

    logger.info(`Files: ${stats.totalFiles}  Size: ${stats.totalSizeGB.toFixed(2)}GB  Repos: ${stats.totalRepos}`);

    const zipPath = await buildZip({
      name: config.name,
      outputDir,
      dataDir,
      planMePath: absolutePath,
      jsonlPath,
      manifest: manifestEntries,
      stats,
    });

    logger.success(`Dataset package created: ${zipPath}`);

    // Final summary
    console.log("\n" + "=".repeat(50));
    console.log(`  ${picocolors.bold("Dataset:")}  ${config.name}`);
    console.log(`  ${picocolors.bold("Repos:")}    ${stats.totalRepos}`);
    console.log(`  ${picocolors.bold("Files:")}    ${stats.totalFiles}`);
    console.log(`  ${picocolors.bold("Size:")}     ${stats.totalSizeGB.toFixed(2)} GB`);
    console.log(`  ${picocolors.bold("Output:")}   ${zipPath}`);
    if (stats.duplicatesSkipped > 0) {
      console.log(`  ${picocolors.bold("Dupes:")}    ${stats.duplicatesSkipped} skipped`);
    }
    console.log("=".repeat(50) + "\n");

  } catch (err) {
    if ((err as Error).name === "AbortError") {
      logger.warn("Operation cancelled by user.");
    } else {
      logger.error(`Pipeline failed: ${(err as Error).message}`);
      process.exitCode = 1;
    }
  } finally {
    // Always clean up progress bar and signal handlers
    if (progressBars) {
      try { progressBars.stop(); } catch { /* best effort */ }
    }
    process.off("SIGINT", handleSignal);
    process.off("SIGTERM", handleSignal);
  }
}

program.parse(process.argv);
