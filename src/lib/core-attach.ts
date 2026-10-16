import { attachmentPrompt, type Attachment } from "./attach-pure";
import { extractText } from "./extract";
import type { PromptImage } from "./claude";

/** Turn validated attachments into CORE's prompt block (document text) and the images sent with every step.
 *  Everything stays in memory: nothing is written to disk. */
export async function prepareAttachments(files: Attachment[]): Promise<{ block: string; images: PromptImage[] } | undefined> {
  if (!files.length) return undefined;
  const docs = await Promise.all(files.filter((f) => f.kind === "doc").map(async (f) => ({
    name: f.name,
    text: await extractText(Buffer.from(f.data), f.type).catch((e) => `(couldn't read this file: ${e instanceof Error ? e.message : "unknown error"})`),
  })));
  const images = files.filter((f) => f.kind === "image");
  return { block: attachmentPrompt(docs, images.map((f) => f.name)), images: images.map((f) => ({ type: f.type, data: f.data })) };
}
