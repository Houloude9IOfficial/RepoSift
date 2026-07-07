# RepoSift

**Scrape → Filter → Prepare → Export** — a modular CLI pipeline for building AI training datasets from GitHub repositories.

RepoSift discovers repos by search, user/org, or explicit list; filters out generated/vendor files; extracts structured training examples (function docs, type definitions, error patterns, test assertions); and exports model-agnostic datasets ready for any training framework (Hugging Face, OpenAI, MLX, LlamaFactory).

*NOTE: To use `reposift ui` or any RepoSift command, you must add it to your path, or just use `npm run ui`.*

```bash
npm install
npm run dev -- run plan.me -o output/mydataset
```

---

## How It Works

RepoSift is a **six-stage pipeline**. Each stage is a separate command that feeds into the next:

```
Source repos (GitHub)
    │
    ▼
┌─────────────┐
│  1. init    │  Create a plan.me config
└──────┬──────┘
       │ plan.me
       ▼
┌─────────────┐
│  2. run     │  Fetch repos from GitHub, extract files
└──────┬──────┘
       │ output/<name>/  (data/ + manifest.json + .zip)
       ▼
┌─────────────┐
│  3. inspect │  Analyze what you got
└──────┬──────┘
       │ (optional — understand your dataset composition)
       ▼
┌─────────────┐
│  4. filter  │  Remove generated/vendor files, split docs
└──────┬──────┘
       │ output/filtered/  (code/ + docs/ + manifest.json)
       ▼
┌─────────────┐
│  5. prepare │  Generate training examples from source code
└──────┬──────┘
       │ output/traindata/  (training.jsonl + examples_summary.json)
       ▼
┌─────────────┐
│  6. export  │  Convert to standardized dataset format
└──────┬──────┘
       │ output/export/  (dataset.jsonl + metadata.json + README.md)
       ▼
   Any training framework
   (Hugging Face, OpenAI, MLX, LlamaFactory, …)
```

Every stage reads the output of the previous stage. You can stop at any point — the intermediate outputs are valid datasets you can use directly.

---

## Quick Start

### 1. Install & configure

```bash
cd reposift
npm install
cp .env.example .env
# Edit .env and add your GITHUB_TOKEN
```

### 2. Create a plan

```bash
npm run dev -- init                    # interactive wizard
# or write manually: example.plan.me
```

### 3. Run the full pipeline

```bash
# Interactive menu (recommended for exploration)
npm run dev ui

# Or CLI commands:
npm run dev -- run plan.me -o output/raw
npm run dev -- inspect output/raw
npm run dev -- filter output/raw -o output/filtered --split-docs
npm run dev -- prepare output/filtered -o output/traindata
npm run dev -- export output/traindata -o output/export --format messages
```

### 4. Train

```bash
# Hugging Face
python -c "from datasets import load_dataset; dataset = load_dataset('json', data_files='output/export/dataset.jsonl')"

# OpenAI
openai api fine_tuning.jobs.create --training-file output/export/dataset.jsonl --model gpt-4o-mini

# MLX
mlx_lm.lora --train --data ./output/export/dataset.jsonl
```

---

## Recommended Pipeline Order

This is the intended workflow. Each step is optional — skip what you don't need.

| Step | Command | Why |
|------|---------|-----|
| **1** | `init` | Create a `plan.me` config that controls which repos to scrape, what filters to apply, and how to process files. Run this once per dataset. |
| **2** | `run` | The heavy lifter — discovers repos via GitHub API, downloads tarballs, extracts files, applies filters, deduplicates, and packages the raw dataset. |
| **3** | `inspect` | **Always run this before filtering.** It tells you exactly what's in your dataset: file types, language breakdown, largest repos, duplicate %, and how much is generated/vendor trash vs useful source. |
| **4** | `filter` | Strips generated files (node_modules, dist, build, coverage), locks, minified assets, and optionally splits `.md`/`.mdx` docs into a parallel `docs/` directory with `--split-docs`. |
| **5** | `prepare` | Walks the filtered source code and generates structured training examples: function documentation pairs, type definitions, `@ts-expect-error` debugging contexts, test assertions, and error handling patterns. |
| **6** | `export` | Converts the prepared examples into a standardized, model-agnostic format (`instruction` or `messages`) with full metadata — ready for any training framework. |

### When to skip steps

- **Already have a dataset?** Start at `inspect` or `filter`.
- **Only need raw files?** Stop after `run`.
- **Want a specific format?** Use `export --format messages` for chat models or `--format instruction` for completion models.

---

## Architecture

```
reposift/
├── src/
│   ├── cli.ts              # Commander CLI entry point
│   ├── init.ts             # Interactive plan.me wizard
│   ├── ui.ts               # Interactive menu (all commands)
│   ├── config/             # YAML parsing + Zod schema validation
│   ├── discovery/          # GitHub Search API, user/org fetcher, explicit repo fetcher
│   ├── license/            # License detection (GitHub API + file fallback + SPDX allowlist)
│   ├── fetch/              # codeload tarball download + tar.gz extraction
│   ├── filter/             # Path exclusion, extension rules, binary detection, secret scanning, size limits
│   ├── dedupe/             # SHA256 content deduplication
│   ├── budget/             # Global size budget enforcement
│   ├── metadata/           # Manifest, stats, JSONL writer
│   ├── state/              # Resumable checkpoints for crash recovery
│   ├── package/            # ZIP packaging with archiver
│   ├── inspect.ts          # Dataset analysis & report
│   ├── filter.ts           # Dataset filtering (remove generated/vendor)
│   ├── prepare.ts          # Training example extraction
│   └── export.ts           # Standardized dataset export
├── example.plan.me         # Example configuration
└── .env.example            # Token setup
```

### Design principles

- **Model-agnostic** — RepoSift produces standardized JSONL datasets that work with any training framework. It does not train models.
- **Streaming** — Large datasets are processed line-by-line (not loaded into memory).
- **Resumable** — The `run` command supports `--resume` for interrupted builds.
- **Graceful shutdown** — Ctrl+C triggers graceful shutdown with cleanup.
- **Checkpointed** — Each completed repo is checkpointed so interrupted runs can resume from where they left off.

---

## Dataset Formats

### Raw output (after `run`)

```
output/<name>/
├── data/
│   ├── owner__repo/
│   │   ├── src/file.ts
│   │   └── ...
├── manifest.json          # Per-repo metadata (file count, size, stars, license)
├── stats.json             # Aggregate statistics (total files, size, duplicates, language breakdown)
├── metadata.jsonl         # Per-file metadata (sha256, path, size, origin repo)
└── <name>.zip             # Packaged archive
```

### Filtered output (after `filter`)

```
output/filtered/
├── code/                  # Source files (with --split-docs)
│   └── owner__repo/...
├── docs/                  # Documentation files (with --split-docs)
│   └── owner__repo/...
├── data/                  # All files (without --split-docs)
├── manifest.json
└── stats.json
```

### Prepare output (after `prepare`)

```
output/traindata/
├── training.jsonl          # Training examples
├── examples.jsonl          # Examples with metadata
└── examples_summary.json   # Generation stats
```

### Export output (after `export`)

```
output/export/
├── dataset.jsonl           # Standardized examples (instruction or messages format)
├── metadata.json           # Dataset metadata (name, examples, languages, repos)
├── stats.json              # Per-type breakdown
└── README.md               # Documentation with consumption examples
```

---

## Commands

| Command | Description |
|---------|-------------|
| `ui` | Open interactive menu |
| `init` | Create plan.me config |
| `run` | Build dataset from plan.me |
| `inspect` | Analyze a dataset |
| `filter` | Remove generated/vendor files |
| `prepare` | Generate training examples |
| `export` | Export to standard format |

For full documentation of every command, option, and flag, see **[Commands.md](./Commands.md)**.

---

## License

MIT

Last updated July 7th 2026.