// Common patterns for secrets/API keys
const SECRET_PATTERNS: Array<{ name: string; regex: RegExp }> = [
  { name: "AWS Access Key", regex: /AKIA[0-9A-Z]{16}/g },
  { name: "AWS Secret Key", regex: /aws(.{0,20})?(?<key>[0-9a-zA-Z\/+]{40})/gi },
  { name: "GitHub Token", regex: /gh[pousr]_[A-Za-z0-9_]{36,251}/g },
  { name: "GitHub Fine-Grained Token", regex: /github_pat_[A-Za-z0-9_]{82,}/g },
  { name: "GitLab Token", regex: /glpat-[A-Za-z0-9\-_]{20,}/g },
  { name: "Slack Token", regex: /xox[baprs]-[0-9a-zA-Z\-]{10,}/g },
  { name: "Discord Token", regex: /[A-Za-z0-9_\-]{24}\.[A-Za-z0-9_\-]{6}\.[A-Za-z0-9_\-]{27}/g },
  { name: "Stripe Live Key", regex: /(?:sk|pk)_live_[0-9a-zA-Z]{24,}/g },
  { name: "Stripe Test Key", regex: /(?:sk|pk)_test_[0-9a-zA-Z]{24,}/g },
  { name: "Google API Key", regex: /AIza[0-9A-Za-z\-_]{35}/g },
  { name: "Heroku API Key", regex: /[hH][eE][rR][oO][kK][uU].*[0-9A-F]{8}-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{12}/g },
  { name: "JWT Token", regex: /eyJ[a-zA-Z0-9\-_]+\.[a-zA-Z0-9\-_]+\.[a-zA-Z0-9\-_]+/g },
  { name: "Private Key", regex: /-----BEGIN (RSA |EC |DSA |OPENSSH )?PRIVATE KEY-----/g },
  { name: "Password/Secret in ENV", regex: /(?:PASSWORD|SECRET|TOKEN|API_KEY|ACCESS_KEY)\s*[:=]\s*['"][^'"]{8,}['"]/gi },
  { name: "Generic High-Entropy String", regex: /[0-9a-zA-Z]{40,}/g },
];

export interface SecretMatch {
  name: string;
  line: number;
  index: number;
}

/**
 * Scan content for secrets and return all matches.
 */
export function scanForSecrets(content: string): SecretMatch[] {
  const matches: SecretMatch[] = [];
  const lines = content.split("\n");

  for (let lineIdx = 0; lineIdx < lines.length; lineIdx++) {
    const line = lines[lineIdx];
    for (const { name, regex } of SECRET_PATTERNS) {
      // Reset regex state
      regex.lastIndex = 0;
      let match;
      while ((match = regex.exec(line)) !== null) {
        // Skip if it looks like a placeholder or example
        const val = match[0];
        if (
          /^(your_|example_|my_|changeme|placeholder|xxxx)/i.test(val) ||
          val.includes("...")
        ) {
          continue;
        }
        matches.push({
          name,
          line: lineIdx + 1,
          index: match.index,
        });
      }
    }
  }

  return matches;
}

/**
 * Redact secrets from content by replacing matched lines with a redacted marker.
 */
export function redactSecrets(content: string, matches: SecretMatch[]): string {
  const lines = content.split("\n");
  const lineSet = new Set(matches.map((m) => m.line - 1));

  for (const lineIdx of lineSet) {
    if (lineIdx >= 0 && lineIdx < lines.length) {
      lines[lineIdx] = `// [REDACTED: potential secret on line ${lineIdx + 1}]`;
    }
  }

  return lines.join("\n");
}
