/**
 * Detect whether a file is binary by sniffing the first buffer.
 * Looks for null bytes (common in binaries) and checks for printable ratio.
 */
export function isBinary(buffer: Buffer): boolean {
  const sampleSize = Math.min(buffer.length, 8192);
  let nullBytes = 0;
  let nonPrintableCount = 0;
  let totalChecked = 0;

  for (let i = 0; i < sampleSize; i++) {
    const byte = buffer[i];
    if (byte === 0) nullBytes++;
    // Check for non-printable ASCII (excluding common whitespace: \t, \n, \r)
    if (byte < 32 && byte !== 9 && byte !== 10 && byte !== 13) {
      nonPrintableCount++;
    }
    totalChecked++;
  }

  // High null byte count or high non-printable ratio = binary
  if (nullBytes > 0) return true;
  if (totalChecked > 0 && nonPrintableCount / totalChecked > 0.3) return true;

  return false;
}
