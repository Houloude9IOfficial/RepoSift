import * as p from "@clack/prompts";
import picocolors from "picocolors";
import { initCommand } from "./init.js";
import { inspectCommand } from "./inspect.js";
import { filterCommand } from "./filter.js";
import { prepareCommand } from "./prepare.js";
import { exportCommand } from "./export.js";

export async function uiCommand(): Promise<void> {
  console.log(`\n${picocolors.bold(picocolors.cyan("RepoSift"))} ${picocolors.dim("— Interactive Menu")}`);
  console.log(picocolors.dim("Scrape, filter, and prepare GitHub repos for AI training data.\n"));

  while (true) {
    const action = await p.select({
      message: "What would you like to do?",
      options: [
        { value: "init", label: "📝 Init", hint: "Create a plan.me config interactively" },
        { value: "run", label: "🚀 Run", hint: "Build a dataset from plan.me" },
        { value: "inspect", label: "🔍 Inspect", hint: "Analyze a dataset folder or .zip" },
        { value: "filter", label: "🎯 Filter", hint: "Remove generated/vendor files from a dataset" },
        { value: "prepare", label: "🧠 Prepare", hint: "Generate training examples for agent training" },
        { value: "export", label: "📦 Export", hint: "Export to standardized dataset format" },
        { value: "exit", label: "🚪 Exit", hint: "Close RepoSift" },
      ],
    });

    if (p.isCancel(action)) break;

    switch (action) {
      case "exit":
        p.outro("See you!");
        return;

      case "init":
        await doInit();
        break;

      case "run":
        await doRun();
        break;

      case "inspect":
        await doInspect();
        break;

      case "filter":
        await doFilter();
        break;

      case "prepare":
        await doPrepare();
        break;

      case "export":
        await doExport();
        break;
    }

    // Pause so the user can read output before seeing the menu again
    await p.select({
      message: "Press Enter to return to the menu",
      options: [{ value: "ok", label: "Continue" }],
    });
  }
}

// ── Command handlers ──

async function doInit(): Promise<void> {
  console.log(`\n${picocolors.cyan("📝 Init — Create a plan.me config")}\n`);
  const outputPath = await p.text({
    message: "Output path for plan.me",
    placeholder: "plan.me",
    defaultValue: "plan.me",
  });
  if (p.isCancel(outputPath)) return;
  await initCommand(outputPath as string);
}

async function doRun(): Promise<void> {
  console.log(`\n${picocolors.cyan("🚀 Run — Build a dataset from plan.me")}\n`);

  const planMePath = await p.text({
    message: "Path to plan.me config file",
    placeholder: "plan.me",
    validate: (v) => {
      if (!v || v.trim().length === 0) return "Path is required";
    },
  });
  if (p.isCancel(planMePath)) return;

  const outputDir = await p.text({
    message: "Output directory (leave empty for default ./output/<name>)",
    placeholder: "",
    defaultValue: "",
  });
  if (p.isCancel(outputDir)) return;

  const verbose = await p.confirm({
    message: "Enable verbose debug output?",
    initialValue: false,
  });
  if (p.isCancel(verbose)) return;

  const resume = await p.confirm({
    message: "Resume from last checkpoint?",
    initialValue: false,
  });
  if (p.isCancel(resume)) return;

  console.log(`\n${picocolors.dim("Options:")} ${outputDir ? `--output ${outputDir} ` : ""}${verbose ? "--verbose " : ""}${resume ? "--resume " : ""}\n`);

  // Dynamic import to avoid circular dependency (cli.ts → ui.ts → cli.ts)
  const { runCommand } = await import("./cli.js");
  await runCommand(planMePath as string, {
    output: (outputDir as string) || undefined,
    verbose: verbose as boolean,
    resume: resume as boolean,
  });
}

async function doInspect(): Promise<void> {
  console.log(`\n${picocolors.cyan("🔍 Inspect — Analyze a dataset")}\n`);

  const inputPath = await p.text({
    message: "Path to dataset folder or .zip",
    placeholder: ".",
    defaultValue: ".",
  });
  if (p.isCancel(inputPath)) return;

  const verbose = await p.confirm({
    message: "Enable verbose output?",
    initialValue: false,
  });
  if (p.isCancel(verbose)) return;

  await inspectCommand(inputPath as string, { verbose: verbose as boolean });
}

async function doFilter(): Promise<void> {
  console.log(`\n${picocolors.cyan("🎯 Filter — Remove generated/vendor files from a dataset")}\n`);

  const inputPath = await p.text({
    message: "Path to input dataset folder or .zip",
    validate: (v) => {
      if (!v || v.trim().length === 0) return "Path is required";
    },
  });
  if (p.isCancel(inputPath)) return;

  const outputDir = await p.text({
    message: "Output directory for filtered dataset",
    validate: (v) => {
      if (!v || v.trim().length === 0) return "Output directory is required";
    },
  });
  if (p.isCancel(outputDir)) return;

  const debugMode = await p.confirm({
    message: "Keep test files, examples, and docs? (useful for debugging agent training)",
    initialValue: false,
  });
  if (p.isCancel(debugMode)) return;

  const splitDocs = await p.confirm({
    message: "Separate .md/.mdx files into a parallel docs/ directory?",
    initialValue: false,
  });
  if (p.isCancel(splitDocs)) return;

  const verbose = await p.confirm({
    message: "Enable verbose output?",
    initialValue: false,
  });
  if (p.isCancel(verbose)) return;

  await filterCommand(inputPath as string, {
    output: outputDir as string,
    debug: debugMode as boolean,
    splitDocs: splitDocs as boolean,
    verbose: verbose as boolean,
  });
}

async function doPrepare(): Promise<void> {
  console.log(`\n${picocolors.cyan("🧠 Prepare — Generate training examples")}\n`);

  const inputPath = await p.text({
    message: "Path to filtered dataset (output from 'reposift filter')",
    validate: (v) => {
      if (!v || v.trim().length === 0) return "Path is required";
    },
  });
  if (p.isCancel(inputPath)) return;

  const outputDir = await p.text({
    message: "Output directory for training examples",
    validate: (v) => {
      if (!v || v.trim().length === 0) return "Output directory is required";
    },
  });
  if (p.isCancel(outputDir)) return;

  const mode = await p.select({
    message: "Example generation mode",
    options: [
      { value: "all", label: "All", hint: "Generate all example types" },
      { value: "explain", label: "Explain", hint: "Function docs, type definitions, doc contexts" },
      { value: "debug", label: "Debug", hint: "Error patterns, test assertions, @ts-expect-error contexts" },
    ],
    initialValue: "all",
  });
  if (p.isCancel(mode)) return;

  const maxExamplesInput = await p.text({
    message: "Maximum number of examples to generate (leave empty for unlimited)",
    placeholder: "",
    defaultValue: "",
  });
  if (p.isCancel(maxExamplesInput)) return;

  const maxFileSizeInput = await p.text({
    message: "Skip files larger than (KB, default: 50)",
    placeholder: "50",
    defaultValue: "50",
  });
  if (p.isCancel(maxFileSizeInput)) return;

  const verbose = await p.confirm({
    message: "Enable verbose output?",
    initialValue: false,
  });
  if (p.isCancel(verbose)) return;

  const maxExamplesStr = maxExamplesInput as string;
  const maxExamples = maxExamplesStr ? parseInt(maxExamplesStr, 10) : undefined;
  const maxFileSizeKB = parseInt(maxFileSizeInput as string, 10) || 50;

  const validatedMode = (mode as string) as "explain" | "debug" | "all";

  await prepareCommand(inputPath as string, {
    output: outputDir as string,
    mode: validatedMode,
    maxExamples: maxExamples !== undefined && !isNaN(maxExamples) ? maxExamples : undefined,
    maxFileSizeKB,
    verbose: verbose as boolean,
  });
}

async function doExport(): Promise<void> {
  console.log(`\n${picocolors.cyan("📦 Export — Convert to standardized dataset format")}\n`);

  const inputPath = await p.text({
    message: "Path to prepare output (folder with training.jsonl)",
    validate: (v) => {
      if (!v || v.trim().length === 0) return "Path is required";
    },
  });
  if (p.isCancel(inputPath)) return;

  const outputDir = await p.text({
    message: "Output directory for the exported dataset",
    validate: (v) => {
      if (!v || v.trim().length === 0) return "Output directory is required";
    },
  });
  if (p.isCancel(outputDir)) return;

  const format = await p.select({
    message: "Output format",
    options: [
      { value: "instruction", label: "Instruction", hint: '{ "instruction": "...", "input": "...", "output": "..." }' },
      { value: "messages", label: "Messages", hint: "Chat format compatible with OpenAI, Hugging Face" },
    ],
    initialValue: "instruction",
  });
  if (p.isCancel(format)) return;

  const datasetName = await p.text({
    message: "Dataset name (for metadata)",
    placeholder: "reposift-dataset",
    defaultValue: "reposift-dataset",
  });
  if (p.isCancel(datasetName)) return;

  const hfLicense = await p.text({
    message: "License identifier (other, mit, apache-2.0, etc.)",
    placeholder: "other",
    defaultValue: "other",
  });
  if (p.isCancel(hfLicense)) return;

  const verbose = await p.confirm({
    message: "Enable verbose output?",
    initialValue: false,
  });
  if (p.isCancel(verbose)) return;

  await exportCommand(inputPath as string, {
    output: outputDir as string,
    format: (format as string) as "instruction" | "messages",
    name: datasetName as string,
    license: hfLicense as string,
    verbose: verbose as boolean,
  });
}
