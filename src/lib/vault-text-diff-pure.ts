type Change = { kind: "removed" | "added"; line: number; text: string };
const MAX_CELLS = 1_000_000;
const MAX_SHOWN = 400;

/** Compare preview lines. A null result leaves the side-by-side previews available. */
export function vaultTextDiff(first: string, second: string): { changes: Change[]; total: number } | null {
  const lines = (text: string) => (text ? text.replace(/\r\n/g, "\n").split("\n") : []);
  const left = lines(first), right = lines(second);
  let start = 0, leftEnd = left.length, rightEnd = right.length;
  while (start < leftEnd && start < rightEnd && left[start] === right[start]) start++;
  while (leftEnd > start && rightEnd > start && left[leftEnd - 1] === right[rightEnd - 1]) {
    leftEnd--;
    rightEnd--;
  }

  const height = leftEnd - start, width = rightEnd - start;
  const stride = width + 1;
  if ((height + 1) * stride > MAX_CELLS) return null;
  // Lengths of the longest common subsequence for each suffix of the changed range.
  const lengths = new Uint32Array((height + 1) * stride);
  for (let i = height - 1; i >= 0; i--) {
    for (let j = width - 1; j >= 0; j--) {
      const index = i * stride + j;
      lengths[index] = left[start + i] === right[start + j]
        ? 1 + lengths[index + stride + 1]
        : Math.max(lengths[index + stride], lengths[index + 1]);
    }
  }

  const changes: Change[] = [];
  let total = 0, i = 0, j = 0;
  const record = (kind: Change["kind"], offset: number, text: string) => {
    total++;
    if (changes.length < MAX_SHOWN) changes.push({ kind, line: start + offset + 1, text });
  };
  while (i < height || j < width) {
    if (i < height && j < width && left[start + i] === right[start + j]) {
      i++;
      j++;
    } else if (i < height && (j === width || lengths[(i + 1) * stride + j] >= lengths[i * stride + j + 1])) {
      record("removed", i, left[start + i]);
      i++;
    } else {
      record("added", j, right[start + j]);
      j++;
    }
  }
  return { changes, total };
}
