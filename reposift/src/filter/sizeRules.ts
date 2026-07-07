export function isWithinSizeLimit(
  sizeBytes: number,
  maxSizeKB: number,
): boolean {
  return sizeBytes <= maxSizeKB * 1024;
}
