# RepoSift Commands

> Full reference for every command, option, and flag.

---

## `reposift ui`

Open an interactive menu that guides you through every command via prompts.

```bash
reposift ui
npm run dev ui
```

The menu presents: **📝 Init**, **🚀 Run**, **🔍 Inspect**, **🎯 Filter**, **🧠 Prepare**, **📦 Export**, **🚪 Exit**. Each command collects its required options interactively then executes. After completion, the menu returns so you can run the next step.

**When to use:** Exploration, first-time use, or when you prefer prompts over CLI flags.

---

## `reposift init`

Create a `plan.me` config file interactively.

```bash
reposift init                     # writes to ./plan.me
reposift init ./configs/my.yml    # writes to custom path
npm run dev -- init
```

Prompts walk through:
- **Dataset basics** — name, max size (GB)
- **Discovery sources** — GitHub search query, user/org repos, explicit repos (any combination)
- **Filters** — languages, minimum stars, allowed licenses
- **Processing** — deduplication, secret scanning (drop/redact), concurrency

Output: a YAML file at the specified path (default `./plan.me`).

---

## `reposift run`

Build a dataset from a `plan.me` config. This is the main pipeline command.

```bash
reposift run plan.me
reposift run plan.me -o output/mydataset
reposift run plan.me -o output/mydataset --verbose
reposift run plan.me --resume          # resume interrupted build
npm run dev -- run plan.me -o output/mydataset
```

### Options

| Flag | Description |
|------|-------------|
| `-o, --output <dir>` | Output directory (default: `./output/<name>`) |
| `-v, --verbose` | Verbose debug output |
| `--resume` | Resume from last checkpoint |

### What it does

1. **Discovery** — Searches GitHub via Search API, user/org repos, and explicit list (independently, failures don't block)
2. **Filtering** — Filters candidates by license (GitHub API → file fallback → SPDX allowlist), stars, and language
3. **Fetch & process** — Downloads tarballs from `codeload.github.com`, extracts, walks files, applies path/extension/binary/secret/dedup/size filters, writes to `data/`
4. **Package** — Generates `manifest.json`, `stats.json`, `metadata.jsonl`, and a `.zip` archive

### Progress bar

During Phase 3, a live progress bar shows:

```
 repos ━━━━━━━━━━━━━━━━━ 50% | 5/10 | sindresorhus/ora (filtering...)
  ✔ facebook/react — 150 files, 2.34MB
  ✔ vercel/next.js — 89 files, 1.12MB
```

### Resumability

If the process is interrupted (Ctrl+C), re-run with `--resume` to skip already-completed repos.

---

## `reposift inspect`

Analyze a dataset folder or `.zip` and print a detailed report to stdout.

```bash
reposift inspect output/mydataset
reposift inspect output/mydataset --verbose
reposift inspect output/mydataset.zip     # works with .zip too
reposift inspect                          # default: current directory
npm run dev -- inspect output/mydataset
```

### Options

| Flag | Description |
|------|-------------|
| `-v, --verbose` | Verbose debug output |

### Report sections

- **Dataset overview** — total files, size, repos, duplicate count
- **Most common languages** — grouped by language family (TypeScript, JavaScript, Markdown, JSON, etc.)
- **File type breakdown** — every extension with counts and percentages (top 20)
- **TypeScript files** — total `.ts`/`.tsx`/`.mts`/`.cts` count
- **Useful source analysis** — categorized into: source code, config/data, test files, docs/examples, generated/vendor, other
- **Largest repos** — top 10 by file count and by size (with star counts when available)
- **Summary** — what percentage of the dataset is useful for training

### Example output

```
Dataset Inspection Report
══════════════════════════════════════════
  Dataset:  mydataset
  Source:   /path/to/output
══════════════════════════════════════════
  Total files:  284,722
  Total size:   1.23 GB
  Total repos:  47

Most Common Languages:
  TypeScript         92,000  (32.3%)
  JavaScript         50,000  (17.6%)
  ...
  Generated/Vendor   54,722  (19.2%)
```

---

## `reposift filter`

Remove generated/vendor files from a dataset, keeping useful source files.

```bash
reposift filter output/raw -o output/filtered
reposift filter output/raw.zip -o output/filtered     # .zip input
reposift filter output/raw -o output/filtered --debug
reposift filter output/raw -o output/filtered --split-docs
reposift filter output/raw -o output/filtered --debug --split-docs
reposift filter output/raw -o output/filtered --verbose
npm run dev -- filter output/raw -o output/filtered
```

### Options

| Flag | Description |
|------|-------------|
| `-o, --output <dir>` | **Required.** Output directory for filtered dataset |
| `--debug` | Keep test files, examples, and docs (excluded by default) |
| `--split-docs` | Separate `.md`/`.mdx`/`.rst`/`.txt` files into a parallel `docs/` directory |
| `-v, --verbose` | Show which files were removed and why |

### Default filter rules

**Kept extensions:** `.ts`, `.tsx`, `.js`, `.jsx`, `.mjs`, `.cjs`, `.json`, `.md`

**Removed paths:** `node_modules`, `vendor`, `dist`, `build`, `coverage`, `.next`, `.nuxt`, `.git`, `.cache`, `__pycache__`, `.turbo`, `out`, `target`

**Removed files:** `*.min.js`, `*.min.css`, `*.lock`, `*.map`, `package-lock.json`, `yarn.lock`, `pnpm-lock.yaml`

**In default mode:** also removes `test/`, `tests/`, `__tests__/`, `__snapshots__/`, `fixture/`, `fixtures/`, `spec/`, `specs/`

**With `--debug`:** test/example/doc directories are kept (useful for debugging agent training)

### With `--split-docs`

Output structure:

```
output/filtered/
├── code/
│   └── owner__repo/
│       ├── src/file.ts
│       └── ...
├── docs/
│   └── owner__repo/
│       ├── README.md
│       ├── docs/guide.mdx
│       └── ...
├── manifest.json
└── stats.json
```

Empty `docs/` directories are automatically cleaned up if no doc files were copied.

---

## `reposift prepare`

Generate structured training examples from a filtered dataset.

```bash
reposift prepare output/filtered -o output/traindata
reposift prepare output/filtered -o output/traindata --mode debug
reposift prepare output/filtered -o output/traindata --mode explain
reposift prepare output/filtered -o output/traindata --mode all
reposift prepare output/filtered -o output/traindata --max-examples 5000
reposift prepare output/filtered -o output/traindata --max-file-size-kb 100
npm run dev -- prepare output/filtered -o output/traindata
```

### Options

| Flag | Description |
|------|-------------|
| `-o, --output <dir>` | **Required.** Output directory for training examples |
| `-m, --mode <mode>` | Example type: `explain`, `debug`, or `all` (default: `all`) |
| `--max-examples <n>` | Maximum number of examples to generate (default: unlimited) |
| `--max-file-size-kb <n>` | Skip files larger than this in KB (default: 50) |
| `-v, --verbose` | Show per-repo progress |

### Modes

| Mode | Example types generated |
|------|------------------------|
| `explain` | Function documentation pairs, type/interface definitions, doc contexts |
| `debug` | `@ts-expect-error` / `@ts-ignore` contexts, test assertions, error handling patterns |
| `all` | Everything above + file-level context examples |

### Example types

| Type | Description | Content |
|------|-------------|---------|
| `function_explain` | JSDoc + function signature pair | `instruction`: "Explain what this function does" |
| `type_definition` | TypeScript type/interface definition | Shows the definition, output is empty |
| `error_context` | Code with `@ts-expect-error` | `instruction`: "Debug this TypeScript error" |
| `test_assertion` | Describe/it/test blocks from test files | Shows the test case structure |
| `error_handling` | Try/catch and throw patterns | Shows error handling code |
| `file_context` | Entire file (truncated to 4KB) | One per repo in `all` mode |
| `doc_context` | Documentation content (from `docs/`) | `instruction`: "Explain what this documentation describes" |

### Output

```
output/traindata/
├── training.jsonl           # All examples (code + docs) for training
├── examples.jsonl           # Same examples with full metadata
└── examples_summary.json    # Generation stats (counts by type)
```

### Example generated entry

```json
{
  "id": "func-00001",
  "type": "function_explain",
  "repo": "sindresorhus/ora",
  "file": "index.js",
  "instruction": "Explain what this function does based on its documentation",
  "input": "Creates a spinner with the given options\n\nfunction createSpinner(options) { ... }",
  "output": "Creates a spinner with the given options"
}
```

```json
{
  "id": "tserr-00001",
  "type": "error_context",
  "repo": "microsoft/TypeScript",
  "file": "tests/cases/errors.ts",
  "instruction": "Debug this TypeScript error",
  "input": "const x: string = maybeUndefined;",
  "output": "// Error: Type 'string | undefined' is not assignable to type 'string'\n// Solution: (to be filled)"
}
```

---

## `reposift export`

Convert prepared training examples into a standardized, model-agnostic dataset format.

```bash
reposift export output/traindata -o output/export
reposift export output/traindata -o output/export --format messages
reposift export output/traindata -o output/export --format instruction
reposift export output/traindata -o output/export --name my-dataset
reposift export output/traindata -o output/export --verbose
npm run dev -- export output/traindata -o output/export
```

### Options

| Flag | Description |
|------|-------------|
| `-o, --output <dir>` | **Required.** Output directory for the exported dataset |
| `-f, --format <format>` | Output format: `instruction` or `messages` (default: `instruction`) |
| `--name <name>` | Dataset name for metadata (default: `reposift-dataset`) |
| `-v, --verbose` | Show format and name |

### Output formats

#### `instruction` format (default)

```json
{"instruction": "Explain what this function does based on its documentation", "input": "/** Creates a spinner */\n\nfunction createSpinner(opts) { ... }", "output": "Creates a spinner"}
```

Examples with empty output are automatically excluded.

#### `messages` format

```json
{"messages": [{"role": "user", "content": "Explain what this function does..."}, {"role": "assistant", "content": "Creates a spinner..."}]}
```

Compatible with OpenAI chat completions, Hugging Face chat templates, and LlamaFactory.

### Output

```
output/export/
├── dataset.jsonl       # Standardized training examples
├── metadata.json       # Dataset metadata
├── stats.json          # Detailed statistics
└── README.md           # Documentation with consumption examples
```

### metadata.json

```json
{
  "name": "my-dataset",
  "description": "RepoSift training dataset — instruction format. 123,312 examples across TypeScript, JavaScript.",
  "examples": 123312,
  "format": "instruction",
  "languages": ["JavaScript", "TypeScript"],
  "sourceRepos": 214,
  "license": "mixed",
  "created": "2026-07-07",
  "generatedBy": "RepoSift",
  "version": "1.0.0"
}
```

### Consumption

```bash
# Hugging Face
python -c "from datasets import load_dataset; dataset = load_dataset('json', data_files='dataset.jsonl')"

# OpenAI
openai api fine_tuning.jobs.create --training-file dataset.jsonl --model gpt-4o-mini

# MLX
mlx_lm.lora --train --data ./dataset.jsonl

# LlamaFactory (dataset_info.yaml)
reposift_dataset:
  file_name: dataset.jsonl
  format: instruction
```

---

## Common Workflows

### Full pipeline (scrape to train)

```bash
npm run dev -- init
npm run dev -- run plan.me -o output/raw
npm run dev -- inspect output/raw
npm run dev -- filter output/raw -o output/filtered --debug --split-docs
npm run dev -- prepare output/filtered -o output/traindata
npm run dev -- export output/traindata -o output/export --format messages
```

### Debugging agent training

```bash
npm run dev -- filter output/raw -o output/filtered --debug
npm run dev -- prepare output/filtered -o output/traindata --mode debug
npm run dev -- export output/traindata -o output/export --format messages
```

### Minimal (raw files only)

```bash
npm run dev -- init
npm run dev -- run plan.me -o output/raw
```

### Analyze an existing dataset

```bash
npm run dev -- inspect output/mydataset
npm run dev -- inspect output/mydataset.zip
```

### Interactive mode (all commands via menu)

```bash
npm run dev ui
```

---

## Notes

- **npm flag interception**: When running via `npm run dev`, npm intercepts `-o` and other short flags. Use `--` to pass them through: `npm run dev -- filter input -o output`, or use the long flag form: `--output output`.
- **GitHub token**: Required for `run`. Set `GITHUB_TOKEN` in `.env` or as an environment variable.
- **.zip support**: Both `inspect` and `filter` accept `.zip` files as input (extracted to a temp directory automatically).
