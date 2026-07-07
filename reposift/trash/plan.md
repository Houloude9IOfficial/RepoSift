# RepoSift

Node.js CLI that scrapes GitHub repos for AI training data, filtered by license, stars, language, and user-defined rules in a `plan.me` config file. Outputs a `.zip` with raw source files and a JSONL metadata index.

## Goals

- Pull code from public GitHub repos that match license, star, and language constraints defined by the user
- Strip anything that isn't useful training signal: binaries, lockfiles, vendored deps, minified bundles, images, generated code
- Hard-drop or redact secrets/API keys before they ever hit disk
- Cap total output size in GB, not just file count
- Produce a portable `.zip`: `/data` for files, root for `manifest.json`, `stats.json`, and a copy of `plan.me`
- Be resumable — a killed process shouldn't mean starting over

## Non-goals (for v1)

- No fine-tuning or training pipeline itself — this is a dataset builder only
- No support for private repos / org-auth scraping
- No automatic PII scrubbing beyond secrets (names, emails in comments are out of scope for v1)

## Tech stack

- Node.js + TypeScript, `tsx` for dev execution
- `zod` for `plan.me` schema validation
- `js-yaml` for parsing `plan.me`
- `tar` for streaming tarball extraction
- `archiver` for final zip packaging
- `p-limit` for concurrency control
- `undici` for HTTP (GitHub REST + Search API, tarball downloads)
- No git binary dependency — fetch via `codeload.github.com` tarballs

## plan.me spec

```yaml
name: my-dataset
maxSizeGB: 50

discovery:
  search:
    query: "language:TypeScript stars:>50"
    limit: 2000
  users: [torvalds, sindresorhus]
  explicitRepos: ["facebook/react", "vercel/next.js"]

licenses:
  allow: [MIT, Apache-2.0, BSD-3-Clause]
  requireDetected: true

stars:
  min: 50

languages:
  allow: [TypeScript, Python, Go]

exclude:
  paths: [node_modules, vendor, dist, build, "*.min.js", "*.lock"]
  extensions: [.png, .jpg, .svg, .woff, .zip, .exe, .bin, .pdf]
  maxFileSizeKB: 500

dedupe:
  enabled: true

secretScan:
  enabled: true
  action: drop          # drop | redact

output:
  format: raw+jsonl

auth:
  tokenEnv: GITHUB_TOKEN

concurrency: 5
```

## Architecture

```
reposift/
  src/
    cli.ts                    # entry point: reposift run <plan.me>
    config/
      schema.ts                # zod schema for plan.me
      parser.ts                 # yaml -> typed config
    discovery/
      search.ts                 # GitHub Search API (stars/language/keyword)
      byUser.ts                   # all repos under a user/org
      explicit.ts                  # fixed repo list from plan.me
      merge.ts                      # merges + dedupes the three sources into one queue
      rateLimiter.ts                 # token bucket, respects X-RateLimit-* headers
    license/
      detect.ts                 # GitHub API license field + SPDX match
      fallback.ts                # parse LICENSE/LICENSE.md when API returns null
      allowlist.ts                 # match against plan.me allowed licenses
    fetch/
      tarball.ts                # codeload.github.com download
      extract.ts                  # stream-extract tar.gz to temp dir
    filter/
      binaryDetect.ts            # buffer sniff, reject non-text
      extensionRules.ts           # allow/deny by extension
      pathRules.ts                 # exclude node_modules, vendor, dist, lockfiles
      secretScan.ts                  # entropy check + regex for keys/tokens
      sizeRules.ts                    # per-file max size
    dedupe/
      hashIndex.ts               # sha256 content hash, skip duplicate files across repos
    budget/
      sizeManager.ts             # tracks running bytes vs maxSizeGB, cuts off cleanly
    metadata/
      repoRecord.ts              # per-repo: owner, repo, sha, license, stars, files, bytes
      manifest.ts                 # global manifest.json + stats.json
      jsonlWriter.ts                # per-file metadata.jsonl line writer
    package/
      zipper.ts                  # builds final .zip
    state/
      checkpoint.ts               # resumable run state (crash/interrupt safe)
    logger.ts
  bin/reposift
  .env.example
  package.json
  tsconfig.json
```

## Pipeline flow

1. Parse and validate `plan.me` (zod schema, fail fast on bad config)
2. Discovery: run search + user + explicit sources in parallel, merge into one candidate list, dedupe by `owner/repo`
3. For each candidate: fetch license + star count from GitHub API, filter against `licenses.allow` and `stars.min`
4. Surviving repos queued for tarball fetch (concurrency-limited via `p-limit`)
5. Extract tarball to temp dir
6. Walk extracted files through filter chain: path rules → extension rules → binary detection → size rules → secret scan
7. Surviving files hashed (dedupe check) and copied into `/data/owner__repo/...`, with one JSONL line appended per file
8. After each repo, check `sizeManager` running total against `maxSizeGB` — stop queueing new repos once exceeded, let in-flight repos finish
9. Write `manifest.json` (per-repo record) and `stats.json` (totals, license breakdown, language breakdown)
10. Zip everything: `/data`, `manifest.json`, `stats.json`, copy of `plan.me`
11. Checkpoint state written after every repo, so a killed process resumes from the last completed repo instead of restarting

## Output structure

```
dataset.zip
├── plan.me
├── manifest.json
├── stats.json
├── metadata.jsonl
└── data/
    └── owner__repo/
        └── ...filtered source files, path-preserved
```

## Build order

1. `config/schema.ts` + `parser.ts` — validation first, everything downstream depends on it
2. `discovery/` — search, user, explicit, merged and deduped
3. `license/detect.ts` — filter early, before spending bandwidth on tarballs
4. `fetch/tarball.ts` + `extract.ts`
5. `filter/` chain: binary → extension → path → secretScan → size
6. `dedupe/hashIndex.ts` + `budget/sizeManager.ts`
7. `metadata/` + `package/zipper.ts`
8. `state/checkpoint.ts` — bolt on last, once happy path works

## Known risks / open questions

- **License detection is best-effort, not legal certainty.** GitHub's API license field can miss dual-licensed or per-file-licensed repos. `requireDetected: true` reduces risk, doesn't eliminate it.
- **Secrets in scraped code are common.** `secretScan` needs to be on by default, not opt-in. Decide: hard-drop the file, or redact just the matched line and keep the rest? (Currently unresolved — set in plan.me as `action: drop | redact`.)
- **Global size cap skews composition.** Stopping at `maxSizeGB` favors whichever repos got queued first. Consider per-license or per-language sub-quotas in v2.
- **Rate limits.** Search API and REST API have separate, tighter limits than tarball downloads. Discovery and license-check phases need their own backoff/rate limiter, independent of fetch concurrency.
- **No git dependency** by design — tarball-only fetch means no submodules, no LFS content. Acceptable for v1, worth flagging if `.gitattributes`/`.gitmodules` heavy repos matter to you.

## v2 ideas (not building now)

- Per-license and per-language quota system instead of one global GB cap
- Optional AST-based filtering (drop test files, drop generated code by heuristic)
- Incremental re-scrape mode: re-run a plan.me and only pull repos updated since last run
- Language-aware near-dedup (not just exact content hash) to catch boilerplate variants