// Masked text reveal: each word rises into view through its own clip, staggered. CSS only (.mask-word in globals.css);
// remount it (key) to replay. Screen readers get the plain text once.
export function MaskText({ text }: { text: string }) {
  const words = text.split(/\s+/).filter(Boolean);
  return (
    <>
      <span className="sr-only">{text}</span>
      <span aria-hidden>
        {words.map((w, i) => (
          <span key={i}>{i > 0 && " "}<span className="mask-word"><span style={{ ["--i" as string]: i }}>{w}</span></span></span>
        ))}
      </span>
    </>
  );
}
