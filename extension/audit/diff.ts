/**
 * Creates a simple unified diff between two strings.
 * No external dependency required -- produces a readable patch format.
 */
export function createPatch(filePath: string, oldContent: string, newContent: string): string {
  const oldLines = oldContent.split('\n');
  const newLines = newContent.split('\n');

  const hunks: string[] = [];
  hunks.push(`--- a/${filePath}`);
  hunks.push(`+++ b/${filePath}`);

  let i = 0;
  let j = 0;

  while (i < oldLines.length || j < newLines.length) {
    // Find next difference
    if (i < oldLines.length && j < newLines.length && oldLines[i] === newLines[j]) {
      i++;
      j++;
      continue;
    }

    // Found a difference - collect context
    const contextStart = Math.max(0, i - 3);
    const hunkLines: string[] = [];

    // Rewind to include context
    let oi = contextStart;
    let oj = j - (i - contextStart);

    // Add leading context
    while (oi < i && oi < oldLines.length) {
      hunkLines.push(` ${oldLines[oi]}`);
      oi++;
      oj++;
    }

    // Collect changed lines
    while (i < oldLines.length && (j >= newLines.length || oldLines[i] !== newLines[j])) {
      // Find how far the mismatch extends
      let foundSync = false;
      for (let look = 0; look < 5 && i + look < oldLines.length; look++) {
        if (j < newLines.length && oldLines[i + look] === newLines[j]) {
          // Old lines are removed
          for (let k = 0; k < look; k++) {
            hunkLines.push(`-${oldLines[i + k]}`);
          }
          i += look;
          foundSync = true;
          break;
        }
      }
      if (!foundSync) {
        if (i < oldLines.length) {
          hunkLines.push(`-${oldLines[i]}`);
          i++;
        }
        if (j < newLines.length) {
          hunkLines.push(`+${newLines[j]}`);
          j++;
        }
      }
    }

    // Add trailing context (up to 3 lines)
    let trailing = 0;
    while (trailing < 3 && i < oldLines.length && j < newLines.length && oldLines[i] === newLines[j]) {
      hunkLines.push(` ${oldLines[i]}`);
      i++;
      j++;
      trailing++;
    }

    if (hunkLines.length > 0) {
      hunks.push(`@@ -${contextStart + 1},${i - contextStart} +${oj + 1},${j - oj} @@`);
      hunks.push(...hunkLines);
    }
  }

  return hunks.join('\n');
}
