export function isLicenseAllowed(
  detected: string | null,
  allowed: string[],
  requireDetected: boolean,
): boolean {
  if (detected === null) {
    return !requireDetected;
  }
  return allowed.some((a) => a.toLowerCase() === detected.toLowerCase());
}
