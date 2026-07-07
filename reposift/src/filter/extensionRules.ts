import { extname } from "node:path";

export function isExtensionAllowed(
  filePath: string,
  blockedExtensions: string[],
): boolean {
  const ext = extname(filePath).toLowerCase();
  return !blockedExtensions.includes(ext);
}

export function isLanguageExtensionAllowed(
  filePath: string,
  allowedLanguages?: string[],
): boolean {
  if (!allowedLanguages || allowedLanguages.length === 0) return true;

  const ext = extname(filePath).toLowerCase();
  const langMap: Record<string, string> = {
    ".ts": "typescript",
    ".tsx": "typescript",
    ".js": "javascript",
    ".jsx": "javascript",
    ".mjs": "javascript",
    ".cjs": "javascript",
    ".py": "python",
    ".go": "go",
    ".rs": "rust",
    ".java": "java",
    ".rb": "ruby",
    ".php": "php",
    ".c": "c",
    ".h": "c",
    ".cpp": "cpp",
    ".hpp": "cpp",
    ".cs": "csharp",
    ".swift": "swift",
    ".kt": "kotlin",
    ".scala": "scala",
    ".r": "r",
    ".lua": "lua",
    ".sh": "shell",
    ".bash": "shell",
    ".zsh": "shell",
    ".pl": "perl",
    ".pm": "perl",
    ".vue": "vue",
    ".svelte": "svelte",
    ".astro": "astro",
  };

  const lang = langMap[ext];
  if (!lang) return true; // unknown extension, allow it
  return allowedLanguages.some((a) => a.toLowerCase() === lang);
}
