import { ReactNode, useEffect, useMemo, useState } from "react";

export type TypeSeg = { text: string; bold?: boolean };

type Props = {
  /** Paragraphs, each an ordered list of text segments (some bold). */
  paragraphs: TypeSeg[][];
  /** ms per character. */
  speed?: number;
  /** Change this value to (re)start the animation from the beginning. */
  startKey?: number | string;
  boldClassName?: string;
  /** Per-paragraph className, by paragraph index. */
  paraClassName?: (index: number) => string;
  className?: string;
};

/**
 * Types out rich text (with bold spans) character by character. A hidden,
 * full-text layer reserves the final height so surrounding content doesn't
 * jump while typing. Respects prefers-reduced-motion (renders instantly).
 */
export function Typewriter({
  paragraphs,
  speed = 7,
  startKey = 0,
  boldClassName = "font-semibold text-foreground",
  paraClassName,
  className,
}: Props) {
  const total = useMemo(
    () =>
      paragraphs.reduce(
        (sum, segs) => sum + segs.reduce((s, seg) => s + seg.text.length, 0),
        0,
      ),
    [paragraphs],
  );

  const reduceMotion =
    typeof window !== "undefined" &&
    window.matchMedia?.("(prefers-reduced-motion: reduce)").matches === true;

  const [count, setCount] = useState(reduceMotion ? total : 0);

  useEffect(() => {
    if (reduceMotion) {
      setCount(total);
      return;
    }
    setCount(0);
    const start = performance.now();
    // Elapsed-time based: count is derived from wall-clock, so it stays smooth at
    // 60fps in a foreground tab and still lands correctly if timers are throttled
    // (a per-tick counter would stall on render cost or background throttling).
    const id = window.setInterval(() => {
      const n = Math.min(total, Math.floor((performance.now() - start) / speed));
      setCount(n);
      if (n >= total) window.clearInterval(id);
    }, 16);
    return () => window.clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [startKey, total, speed]);

  const done = count >= total;

  // Paragraph the caret currently sits in (last one that has started).
  const paraStart = useMemo(() => {
    let acc = 0;
    return paragraphs.map((segs) => {
      const start = acc;
      acc += segs.reduce((s, seg) => s + seg.text.length, 0);
      return start;
    });
  }, [paragraphs]);
  let activePara = 0;
  for (let p = paragraphs.length - 1; p >= 0; p--) {
    if (count > paraStart[p]) {
      activePara = p;
      break;
    }
  }

  const renderFull = (segs: TypeSeg[]) =>
    segs.map((seg, si) =>
      seg.bold ? (
        <strong key={si} className={boldClassName}>
          {seg.text}
        </strong>
      ) : (
        <span key={si}>{seg.text}</span>
      ),
    );

  // Typed overlay.
  let offset = 0;
  const typed = paragraphs.map((segs, pi) => {
    const nodes: ReactNode[] = [];
    segs.forEach((seg, si) => {
      const start = offset;
      offset += seg.text.length;
      const shown = Math.max(0, Math.min(seg.text.length, count - start));
      if (shown <= 0) return;
      const slice = seg.text.slice(0, shown);
      nodes.push(
        seg.bold ? (
          <strong key={si} className={boldClassName}>
            {slice}
          </strong>
        ) : (
          <span key={si}>{slice}</span>
        ),
      );
    });
    return (
      <p key={pi} className={paraClassName?.(pi)}>
        {nodes}
        {!done && pi === activePara && (
          <span className="ml-0.5 inline-block animate-pulse text-foreground" aria-hidden="true">
            |
          </span>
        )}
      </p>
    );
  });

  return (
    <div className={`relative ${className ?? ""}`}>
      {/* Height reservation: full text, invisible, out of the a11y tree. */}
      <div aria-hidden="true" className="invisible">
        {paragraphs.map((segs, pi) => (
          <p key={pi} className={paraClassName?.(pi)}>
            {renderFull(segs)}
          </p>
        ))}
      </div>
      {/* Typed text on top. */}
      <div className="absolute inset-0">{typed}</div>
    </div>
  );
}
