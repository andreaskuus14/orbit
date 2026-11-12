import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";

/** sha256 of a file, streamed (readFile refuses files over 2 GiB); "" when it can't be read. */
export const sha256File = (f: string): Promise<string> =>
  new Promise((res) => {
    const h = createHash("sha256");
    createReadStream(f).on("data", (c) => h.update(c)).on("error", () => res("")).on("end", () => res(h.digest("hex")));
  });
