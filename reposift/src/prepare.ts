import {
  existsSync,
  readdirSync,
  statSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
  createWriteStream,
} from "node:fs";
import { join, extname, relative } from "node:path";
import picocolors from "picocolors";

// ── Types ──

export type PrepareMode = "explain" | "debug" | "all";

export interface PrepareOptions {
  output: string;
  mode: PrepareMode;
  maxExamples?: number;
  maxFileSizeKB?: number;
  verbose?: boolean;
}

interface TrainingExample {
  id: string;
  type: string;
  repo: string;
  file: string;
  instruction: string;
  input: string;
  output: string;
}

// ── Extraction utilities ──

/**
 * Extract JSDoc-commented function declarations.
 * Returns array of [docComment, functionSignature, fullMatch].
 */
const FUNCTION_RE = /\/\*\*[\s\S]*?\*\/\s*(?:export\s+)?(?:async\s+)?function\s+(?:\*\s*)?(\w+)\s*\([\s\S]*?\)\s*(?::\s*[\w<>[\]|&,\s'"]+)?\s*\{/g;

function extractFunctions(code: string): Array<{ doc: string; signature: string }> {
  const results: Array<{ doc: string; signature: string }> = [];
  let match: RegExpExecArray | null;
  while ((match = FUNCTION_RE.exec(code)) !== null) {
    const full = match[0];
    const funcName = match[1];
    // Extract the doc comment part
    const docEnd = full.indexOf("*/") + 2;
    const doc = full.slice(0, docEnd).trim();
    // Get signature: from after doc to opening brace
    const afterDoc = full.slice(docEnd).trim();
    // Shorten to: "function name(...)" 
    const sigEnd = afterDoc.indexOf("{");
    const sig = (sigEnd > 0 ? afterDoc.slice(0, sigEnd) : afterDoc).trim();
    const shortSig = `${sig} { ... }`;
    results.push({ doc, signature: shortSig });
  }
  return results;
}

/**
 * Extract type/interface definitions and generate a description.
 */
const TYPE_RE = /(?:export\s+)?(?:type|interface)\s+(\w+)(?:\s*<[\s\S]*?>)?(?:\s+extends\s+([\w.\s,]+))?\s*\{([\s\S]*?)\}\s*[;]?/g;

function extractTypeDefs(code: string): Array<{ name: string; definition: string; description: string }> {
  const results: Array<{ name: string; definition: string; description: string }> = [];
  let match: RegExpExecArray | null;
  while ((match = TYPE_RE.exec(code)) !== null) {
    const name = match[1];
    const extendsClause = match[2]?.trim();
    const body = match[3].trim();
    const definition = match[0].trim();

    // Count properties and extract their names/types
    // Support ;, ,, or newline as separators
    const lines = body.split(/[;,\n]/).map((l) => l.trim()).filter(Boolean);
    const props: string[] = [];
    for (const line of lines) {
      // Match `name?: Type` or `name: Type` — skip comments and index signatures
      if (line.startsWith("//") || line.startsWith("/*") || line.startsWith("[")) continue;
      const propMatch = line.match(/^\s*(\w+)\s*(\?)?\s*:\s*([^\s;=,]+)/);
      if (propMatch) {
        const optional = propMatch[2] ? "?" : "";
        props.push(`${propMatch[1]}${optional}: ${propMatch[3]}`);
      }
    }

    // Build description
    const parts: string[] = [];
    const kind = definition.startsWith("export interface") || definition.startsWith("interface") ? "interface" : "type alias";
    parts.push(`The \`${name}\` ${kind} defines ${props.length > 0 ? `${props.length} propert${props.length === 1 ? "y" : "ies"}` : "no properties"}.`);
    if (props.length > 0 && props.length <= 8) {
      parts.push(`Properties: ${props.join(", ")}.`);
    }
    if (extendsClause) {
      parts.push(`The \`${name}\` extends \`${extendsClause}\`.`);
    }

    results.push({ name, definition, description: parts.join(" ") });
  }
  return results;
}

/**
 * Extract @ts-expect-error / @ts-ignore patterns with context.
 */
const TS_ERROR_RE = /\/\/\s*@ts-(?:expect-error|ignore)(?:\s+(.+?))?\n([\s\S]*?)(?=\n\n|\n\/\/|\n$)/g;

function extractErrorContexts(
  code: string,
  filePath: string,
): Array<{ errorMsg: string; context: string }> {
  const results: Array<{ errorMsg: string; context: string }> = [];
  let match: RegExpExecArray | null;
  while ((match = TS_ERROR_RE.exec(code)) !== null) {
    const errorMsg = (match[1] ?? "TypeScript error").trim();
    const context = match[2].trim();
    if (context.length > 20 && context.length < 2000) {
      results.push({ errorMsg, context });
    }
  }
  return results;
}

/**
 * Detect if a file path looks like a test file.
 */
function isTestFilePath(filePath: string): boolean {
  const normalized = filePath.replace(/\\/g, "/");
  return (
    normalized.includes("/test/") ||
    normalized.includes("/tests/") ||
    normalized.includes("/__tests__/") ||
    normalized.includes("/spec/") ||
    normalized.includes("/specs/") ||
    normalized.endsWith(".test.ts") ||
    normalized.endsWith(".test.tsx") ||
    normalized.endsWith(".test.js") ||
    normalized.endsWith(".spec.ts") ||
    normalized.endsWith(".spec.js")
  );
}

/**
 * Extract test describe/it blocks.
 */
const TEST_BLOCK_RE = /(?:describe|it|test)\s*\(\s*["'`](.+?)["'`]\s*,\s*(?:async\s*)?\(?\s*(?:[\w]+\s*)?=>\s*\{[\s\S]*?\}\s*\)\s*\)/g;

function extractTestBlocks(code: string): string[] {
  const results: string[] = [];
  let match: RegExpExecArray | null;
  while ((match = TEST_BLOCK_RE.exec(code)) !== null) {
    if (match[0].length < 3000) {
      results.push(match[0].trim());
    }
  }
  return results;
}

/**
 * Extract error-related patterns from code (try/catch, throw, error types).
 */
const ERROR_PATTERN_RE = /(?:try\s*\{[\s\S]*?\}\s*catch\s*\([\s\S]*?\)\s*\{[\s\S]*?\}|throw\s+(?:new\s+)?(\w+(?:Error|Exception))\s*\([^)]*\)[\s\S]{0,200})/g;

function extractErrorPatterns(code: string): string[] {
  const results: string[] = [];
  let match: RegExpExecArray | null;
  while ((match = ERROR_PATTERN_RE.exec(code)) !== null) {
    if (match[0].length < 2000) {
      results.push(match[0].trim());
    }
  }
  return results;
}

// ── Example generators ──

interface GeneratorContext {
  repoDirName: string;
  repo: string;
  filePath: string;
  content: string;
  ext: string;
  fileSize: number;
}

let exampleCounter = 0;

function nextId(prefix: string): string {
  exampleCounter++;
  return `${prefix}-${String(exampleCounter).padStart(5, "0")}`;
}

function generateExplainExamples(ctx: GeneratorContext): TrainingExample[] {
  const examples: TrainingExample[] = [];
  const { repo, filePath, content } = ctx;

  // 1. Function doc examples
  if (content.includes("/**")) {
    const funcs = extractFunctions(content);
    for (const f of funcs) {
      const cleanDoc = f.doc.replace(/^\/\*\*|\*\/$/g, "").replace(/^\s*\*\s?/gm, "").trim();
      examples.push({
        id: nextId("func"),
        type: "function_explain",
        repo,
        file: filePath,
        instruction: "Explain what this function does based on its documentation",
        input: `${cleanDoc}\n\n${f.signature}`,
        output: cleanDoc,
      });
    }
  }

  // 2. Type/interface definition examples
  const types = extractTypeDefs(content);
  for (const t of types.slice(0, 5)) {
    examples.push({
      id: nextId("type"),
      type: "type_definition",
      repo,
      file: filePath,
      instruction: "Explain this TypeScript type definition",
      input: t.definition,
      output: t.description,
    });
  }

  return examples;
}

function generateDebugExamples(ctx: GeneratorContext): TrainingExample[] {
  const examples: TrainingExample[] = [];
  const { repo, filePath, content } = ctx;

  // 1. @ts-expect-error / @ts-ignore contexts
  if (content.includes("@ts-expect-error") || content.includes("@ts-ignore")) {
    const errors = extractErrorContexts(content, filePath);
    for (const err of errors) {
      // Generate a description based on the error context
      const output = generateErrorDescription(err.errorMsg, err.context);
      examples.push({
        id: nextId("tserr"),
        type: "error_context",
        repo,
        file: filePath,
        instruction: "Debug this TypeScript error",
        input: err.context,
        output,
      });
    }
  }

  // 2. Test assertion examples (from test files)
  if (isTestFilePath(filePath) && (content.includes("describe") || content.includes("it(") || content.includes("test("))) {
    const blocks = extractTestBlocks(content);
    for (const block of blocks.slice(0, 5)) {
      const testDescription = extractTestDescription(block);
      examples.push({
        id: nextId("test"),
        type: "test_assertion",
        repo,
        file: filePath,
        instruction: "Analyze this test case and explain what it validates",
        input: block,
        output: `This test validates that "${testDescription}". It uses expectations to verify the behavior is correct.`,
      });
    }
  }

  // 3. Error handling patterns (try/catch, throw)
  if (content.includes("catch") || content.includes("throw")) {
    const patterns = extractErrorPatterns(content);
    for (const p of patterns.slice(0, 3)) {
      const output = generateErrorHandlingDescription(p);
      examples.push({
        id: nextId("error"),
        type: "error_handling",
        repo,
        file: filePath,
        instruction: "Explain how this code handles errors",
        input: p,
        output,
      });
    }
  }

  return examples;
}

function generateFileContextExamples(ctx: GeneratorContext): TrainingExample[] {
  const { repo, filePath, content } = ctx;

  // Extract file-level statistics for the description
  const importCount = (content.match(/^(?:import\s+|const\s+.*?=\s*require\s*\()/gm) || []).length;
  const exportCount = (content.match(/^(?:export\s+(?:default\s+)?(?:function|class|const|let|var|interface|type|enum|async\s+function))/gm) || []).length;
  const funcCount = (content.match(/\b(?:async\s+)?function\s+\w+\s*\(/g) || []).length;
  const classCount = (content.match(/\bclass\s+\w+/g) || []).length;
  const lines = content.split("\n").length;

  const parts: string[] = [];
  parts.push(`This ${ctx.ext === ".ts" || ctx.ext === ".tsx" ? "TypeScript" : "JavaScript"} file (${lines} lines) `);
  if (funcCount > 0 || classCount > 0 || exportCount > 0 || importCount > 0) {
    const details: string[] = [];
    if (importCount > 0) details.push(`${importCount} import${importCount !== 1 ? "s" : ""}`);
    if (exportCount > 0) details.push(`${exportCount} export${exportCount !== 1 ? "s" : ""}`);
    if (funcCount > 0) details.push(`${funcCount} function${funcCount !== 1 ? "s" : ""}`);
    if (classCount > 0) details.push(`${classCount} class${classCount !== 1 ? "es" : ""}`);
    parts.push(`contains ${details.join(", ")}.`);
  } else {
    parts.push("contains module-level code and definitions.");
  }

  return [
    {
      id: nextId("file"),
      type: "file_context",
      repo,
      file: filePath,
      instruction: "Analyze this code and describe its purpose, structure, and key patterns",
      input: content.length > 4000 ? content.slice(0, 4000) + "\n// ... (truncated)" : content,
      output: parts.join(""),
    },
  ];
}

// ── Dataset walking ──

interface DatasetLayout {
  codeDir: string;
  docsDir: string | null;
  repoDirs: string[];
}

function findDatasetLayout(rootPath: string): DatasetLayout | null {
  // Check for split-docs layout: code/ + docs/
  const codeDir = join(rootPath, "code");
  const docsDir = join(rootPath, "docs");
  const hasCode = existsSync(codeDir) && statSync(codeDir).isDirectory();
  const hasDocs = existsSync(docsDir) && statSync(docsDir).isDirectory();

  if (hasCode) {
    const repoDirs = readdirSync(codeDir).filter((e) => {
      const f = join(codeDir, e);
      return statSync(f).isDirectory() && e.includes("__");
    });
    return { codeDir, docsDir: hasDocs ? docsDir : null, repoDirs };
  }

  // Check for flat data/ layout
  const dataDir = join(rootPath, "data");
  if (existsSync(dataDir) && statSync(dataDir).isDirectory()) {
    const repoDirs = readdirSync(dataDir).filter((e) => {
      const f = join(dataDir, e);
      return statSync(f).isDirectory() && e.includes("__");
    });
    return { codeDir: dataDir, docsDir: null, repoDirs };
  }

  // Check root itself
  const entries = readdirSync(rootPath);
  const repoDirs = entries.filter((e) => {
    const f = join(rootPath, e);
    return statSync(f).isDirectory() && e.includes("__");
  });
  if (repoDirs.length > 0) {
    return { codeDir: rootPath, docsDir: null, repoDirs };
  }

  return null;
}

function walkFiles(
  dirPath: string,
  baseDir: string,
  callback: (relPath: string, fullPath: string, ext: string, size: number) => boolean | void,
  stopFlag?: { stopped: boolean },
): boolean {
  if (stopFlag?.stopped) return false;

  let entries: string[];
  try {
    entries = readdirSync(dirPath);
  } catch {
    return false;
  }

  for (const entry of entries) {
    if (stopFlag?.stopped) return false;

    const fullPath = join(dirPath, entry);
    let fileStat;
    try {
      fileStat = statSync(fullPath);
    } catch {
      continue;
    }

    if (fileStat.isDirectory()) {
      walkFiles(fullPath, baseDir, callback, stopFlag);
    } else if (fileStat.isFile()) {
      const relPath = relative(baseDir, fullPath);
      const ext = extname(entry).toLowerCase();
      const result = callback(relPath, fullPath, ext, fileStat.size);
      if (result === false && stopFlag) {
        stopFlag.stopped = true;
        return false;
      }
    }
  }

  return true;
}

// ── Main ──

export async function prepareCommand(
  inputPath: string,
  options: PrepareOptions,
): Promise<void> {
  const resolvedInput = join(process.cwd(), inputPath);
  const resolvedOutput = join(process.cwd(), options.output);

  const mode = options.mode ?? "all";
  const maxFileSize = (options.maxFileSizeKB ?? 50) * 1024;
  const maxExamples = options.maxExamples ?? 0; // 0 = unlimited

  exampleCounter = 0;

  console.log(`\n${picocolors.bold(picocolors.cyan("Preparing Training Examples"))}`);
  console.log(picocolors.dim("═".repeat(50)));
  console.log(`  ${picocolors.bold("Dataset:")}  ${picocolors.dim(resolvedInput)}`);
  console.log(`  ${picocolors.bold("Mode:")}     ${picocolors.white(mode)}`);
  console.log(`  ${picocolors.bold("Output:")}   ${picocolors.white(resolvedOutput)}`);

  if (!existsSync(resolvedInput)) {
    console.error(`\n${picocolors.red("✘")} Dataset not found: "${resolvedInput}"`);
    process.exitCode = 1;
    return;
  }

  // Find dataset layout
  const layout = findDatasetLayout(resolvedInput);
  if (!layout || layout.repoDirs.length === 0) {
    console.error(`\n${picocolors.red("✘")} No dataset found. Expected 'code/' or 'data/' directory with repo subdirectories.`);
    process.exitCode = 1;
    return;
  }

  mkdirSync(resolvedOutput, { recursive: true });

  const codeWriter = createWriteStream(join(resolvedOutput, "training.jsonl"), { flags: "a" });
  const metaWriter = createWriteStream(join(resolvedOutput, "examples.jsonl"), { flags: "a" });

  let totalExamples = 0;
  let totalFilesProcessed = 0;
  let totalFilesSkipped = 0;
  let examplesByType: Record<string, number> = {};
  let reposProcessed = 0;
  const stopFlag = maxExamples > 0 ? { stopped: false } : undefined;

  const generateExamples = (ctx: GeneratorContext): TrainingExample[] => {
    const examples: TrainingExample[] = [];

    if (mode === "explain" || mode === "all") {
      examples.push(...generateExplainExamples(ctx));
    }
    if (mode === "debug" || mode === "all") {
      examples.push(...generateDebugExamples(ctx));
    }

    return examples;
  };

  for (const repoDirName of layout.repoDirs) {
    const repoDir = join(layout.codeDir, repoDirName);
    const repo = repoDirName.replace("__", "/");
    reposProcessed++;

    if (options.verbose) {
      console.log(`\n  ${picocolors.dim("▸")} Processing ${picocolors.white(repo)}...`);
    }

    let repoExamples = 0;

    walkFiles(repoDir, layout.codeDir, (relPath: string, fullPath: string, ext: string, size: number): boolean | void => {
      if (size > maxFileSize) {
        totalFilesSkipped++;
        return;
      }

      // Only process code files
      const codeExts = new Set([".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs"]);
      if (!codeExts.has(ext)) {
        totalFilesSkipped++;
        return;
      }

      totalFilesProcessed++;

      let content: string;
      try {
        content = readFileSync(fullPath, "utf-8");
      } catch {
        totalFilesSkipped++;
        return;
      }

      // Skip empty or tiny files
      if (content.length < 30) {
        totalFilesSkipped++;
        return;
      }

      const ctx: GeneratorContext = {
        repoDirName,
        repo,
        filePath: relPath,
        content,
        ext,
        fileSize: size,
      };

      const examples = generateExamples(ctx);

      // Also add one file context example per repo (sampled)
      if (mode === "all" && repoExamples === 0 && totalFilesProcessed > 0) {
        examples.push(...generateFileContextExamples(ctx));
      }

      for (const ex of examples) {
        const jsonLine = JSON.stringify(ex) + "\n";
        codeWriter.write(jsonLine);
        metaWriter.write(jsonLine);
        totalExamples++;
        repoExamples++;
        examplesByType[ex.type] = (examplesByType[ex.type] ?? 0) + 1;

        if (stopFlag && totalExamples >= maxExamples) {
          stopFlag.stopped = true;
          return false; // signal stop
        }
      }
    }, stopFlag);

    if (options.verbose) {
      console.log(`    ${picocolors.green(`✔ ${repoExamples} examples`)}`);
    }

    if (stopFlag?.stopped) break;
  }

  // Also process docs if available (respecting maxExamples limit)
  if (layout.docsDir && (mode === "all" || mode === "explain") && !stopFlag?.stopped) {
    const docsDir: string = layout.docsDir;
    const docRepoDirs = readdirSync(docsDir).filter((e) => {
      const f = join(docsDir, e);
      return statSync(f).isDirectory() && e.includes("__");
    });

    if (docRepoDirs.length > 0) {
      if (options.verbose) {
        console.log(`\n  ${picocolors.dim("▸")} Processing docs...`);
      }

      for (const repoDirName of docRepoDirs) {
        if (stopFlag?.stopped) break;

        const repoDir = join(docsDir, repoDirName);
        const repo = repoDirName.replace("__", "/");

        walkFiles(repoDir, docsDir, (relPath, fullPath, ext, size) => {
          if (size > maxFileSize) return;
          if (stopFlag?.stopped) return false;
          totalFilesProcessed++;

          let content: string;
          try {
            content = readFileSync(fullPath, "utf-8");
          } catch {
            return;
          }
          if (content.length < 50) return;

          const docSummary = extractDocSummary(content);
          const ex: TrainingExample = {
            id: nextId("doc"),
            type: "doc_context",
            repo,
            file: relPath,
            instruction: "Explain what this documentation describes and how it helps developers",
            input: content.length > 3000 ? content.slice(0, 3000) + "\n\n... (truncated)" : content,
            output: docSummary,
          };

          const jsonLine = JSON.stringify(ex) + "\n";
          codeWriter.write(jsonLine);
          metaWriter.write(jsonLine);
          totalExamples++;
          examplesByType[ex.type] = (examplesByType[ex.type] ?? 0) + 1;
        }, stopFlag);
      }
    }
  }

  // Close writers
  await new Promise<void>((resolve, reject) => codeWriter.end((err: Error | undefined) => err ? reject(err) : resolve()));
  await new Promise<void>((resolve, reject) => metaWriter.end((err: Error | undefined) => err ? reject(err) : resolve()));

  // Write examples-by-type summary
  const summaryPath = join(resolvedOutput, "examples_summary.json");
  const summary = {
    totalExamples,
    totalFilesProcessed,
    totalFilesSkipped,
    reposProcessed,
    mode,
    examplesByType,
    generatedAt: new Date().toISOString(),
  };
  writeFileSync(summaryPath, JSON.stringify(summary, null, 2));

  // Print summary
  console.log(`\n${picocolors.bold(picocolors.cyan("Prepare Complete"))}`);
  console.log(picocolors.dim("═".repeat(50)));
  console.log(`  ${picocolors.bold("Examples:")}    ${picocolors.white(formatCount(totalExamples))}`);
  console.log(`  ${picocolors.bold("Files read:")}   ${picocolors.white(formatCount(totalFilesProcessed))}`);
  console.log(`  ${picocolors.bold("Files skip:")}   ${picocolors.dim(formatCount(totalFilesSkipped))}`);
  console.log(`  ${picocolors.bold("Repos:")}        ${picocolors.white(formatCount(reposProcessed))}`);
  console.log(`  ${picocolors.bold("Output:")}       ${picocolors.white(resolvedOutput)}`);
  console.log(picocolors.dim("═".repeat(50)));

  const typeEntries = Object.entries(examplesByType).sort((a, b) => b[1] - a[1]);
  if (typeEntries.length > 0) {
    console.log(`\n${picocolors.bold("Examples by Type:")}`);
    for (const [type, count] of typeEntries) {
      const pct = ((count / totalExamples) * 100).toFixed(1);
      console.log(`  ${picocolors.cyan(type.padEnd(25))} ${picocolors.white(formatCount(count).padStart(8))}  ${picocolors.dim(`(${pct}%)`)}`);
    }
  }

  console.log(`\n  ${picocolors.dim("Files:")}`);
  console.log(`    ${picocolors.cyan("training.jsonl")}      — all examples (for training)`);
  console.log(`    ${picocolors.cyan("examples.jsonl")}      — all examples with metadata`);
  console.log(`    ${picocolors.cyan("examples_summary.json")} — generation summary`);
  console.log("");
}

// ── Description generators ──

function generateErrorDescription(errorMsg: string, context: string): string {
  const lines = context.split("\n").filter((l) => l.trim().length > 0);
  const firstLine = lines[0]?.trim() || "";
  const lowerMsg = errorMsg.toLowerCase();

  // Detect the kind of error context — ordered by specificity
  const isUndefinedError = lowerMsg.includes("possibly 'undefined'") || lowerMsg.includes("possibly undefined");
  const isTypeError = lowerMsg.includes("assignable") || /type .* not assignable/i.test(errorMsg);
  const isPropertyError = (lowerMsg.includes("property") && lowerMsg.includes("not exist")) || lowerMsg.includes("has no");

  const parts: string[] = [];
  parts.push(`The code contains a TypeScript error suppressed with `);
  parts.push(`@ts-expect-error. The error message indicates: "${errorMsg}".`);

  if (isTypeError) {
    parts.push(` This is a type compatibility issue where a value's type does not match the expected type.`);
    if (firstLine) {
      parts.push(` The problematic code is: \`${firstLine}\``);
    }
    parts.push(` The fix would be to ensure the types are compatible, use a type assertion, or add proper type guards.`);
  } else if (isPropertyError) {
    parts.push(` This occurs when trying to access a property that does not exist on the type.`);
    if (firstLine) {
      parts.push(` The expression \`${firstLine}\` accesses a member that may not be present.`);
    }
    parts.push(` Checking for the property's existence or using optional chaining (?.) would resolve this.`);
  } else if (isUndefinedError) {
    parts.push(` This happens when a value that could be \`undefined\` is used without a null check.`);
    if (firstLine) {
      parts.push(` The value in \`${firstLine}\` may be undefined at runtime.`);
    }
    parts.push(` Adding a defensive check or default value would fix this.`);
  } else {
    parts.push(` This is a general type safety issue that TypeScript detects at compile time.`);
    parts.push(` Reviewing the types involved and ensuring proper type annotations would resolve it.`);
  }

  return parts.join("");
}

function extractTestDescription(block: string): string {
  // Extract the description from describe/it/test("description", ...)
  const match = block.match(/(?:describe|it|test)\s*\(\s*["'`]([^"'`]+)["'`]/);
  return match ? match[1].trim() : "test case";
}

function generateErrorHandlingDescription(pattern: string): string {
  const isTryCatch = pattern.includes("try") && pattern.includes("catch");
  const isThrow = pattern.includes("throw");

  // Extract error type from throw new SomeError(...)
  const errorTypeMatch = pattern.match(/throw\s+(?:new\s+)?(\w+(?:Error|Exception))/);
  const catchTypeMatch = pattern.match(/catch\s*\(\s*(\w+)(?:\s*:\s*(\w+))?/);

  const parts: string[] = [];

  if (isTryCatch) {
    parts.push("This code uses a try/catch block to handle errors gracefully.");
    if (catchTypeMatch) {
      const errVar = catchTypeMatch[1];
      const errType = catchTypeMatch[2];
      if (errType) {
        parts.push(` It catches \`${errType}\` exceptions as \`${errVar}\`.`);
      } else {
        parts.push(` It catches all exceptions as \`${errVar}\`.`);
      }
    } else {
      parts.push(" It catches all exceptions without filtering by type.");
    }
    parts.push(" The catch block can log errors, display user-friendly messages, or attempt recovery.");
  }

  if (isThrow) {
    if (errorTypeMatch) {
      parts.push(` It throws \`${errorTypeMatch[1]}\` to signal error conditions.`);
    } else {
      parts.push(" It throws errors to signal exceptional conditions.");
    }
    parts.push(" Throwing errors allows calling code to handle failures appropriately.");
  }

  if (parts.length === 0) {
    parts.push("This code implements error handling logic to manage exceptional conditions.");
  }

  return parts.join("");
}

function extractDocSummary(content: string): string {
  // Try to extract a meaningful summary from the doc
  // First check for a heading
  const headingMatch = content.match(/^#\s+(.+)/m);
  if (headingMatch) {
    return `This documentation covers "${headingMatch[1].trim()}". It provides information about usage, configuration, and API details relevant to developers working with this code.`;
  }

  // Try the first paragraph
  const paraMatch = content.match(/^(?:[A-Z][^\n]{10,}?)(?:\.|\n)/m);
  if (paraMatch) {
    const firstSentence = paraMatch[0].replace(/\n/g, " ").trim();
    if (firstSentence.length > 20 && firstSentence.length < 300) {
      return `Summary: ${firstSentence}`;
    }
  }

  // Fallback: use first non-empty line
  const firstLine = content.split("\n").find((l) => l.trim().length > 10);
  if (firstLine) {
    const trimmed = firstLine.trim();
    return `This document describes: ${trimmed}`;
  }

  return "This document provides reference information for developers.";
}

function formatCount(n: number): string {
  return n.toLocaleString("en-US");
}
