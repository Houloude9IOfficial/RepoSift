import { createWriteStream, existsSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import archiver from "archiver";
import type { RepoManifest, DatasetStats } from "../metadata/manifest.js";

export interface ZipInput {
  name: string;
  outputDir: string;
  dataDir: string;
  planMePath: string;
  jsonlPath: string;
  manifest: RepoManifest[];
  stats: DatasetStats;
}

export async function buildZip(input: ZipInput): Promise<string> {
  const zipPath = join(input.outputDir, `${input.name}.zip`);
  const output = createWriteStream(zipPath);
  const archive = archiver("zip", { zlib: { level: 6 } });

  return new Promise<string>((resolve, reject) => {
    output.on("close", () => resolve(zipPath));
    archive.on("error", (err) => reject(err));

    archive.pipe(output);

    // Add plan.me
    if (existsSync(input.planMePath)) {
      archive.file(input.planMePath, { name: "plan.me" });
    }

    // Add data directory
    if (existsSync(input.dataDir)) {
      archive.directory(input.dataDir, "data");
    }

    // Add manifest.json
    archive.append(JSON.stringify(input.manifest, null, 2), {
      name: "manifest.json",
    });

    // Add metadata.jsonl
    if (existsSync(input.jsonlPath)) {
      archive.file(input.jsonlPath, { name: "metadata.jsonl" });
    }

    // Add stats.json
    archive.append(JSON.stringify(input.stats, null, 2), {
      name: "stats.json",
    });

    archive.finalize();
  });
}
