import { Children, ReactNode, useEffect, useRef, useState } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";

type Props = {
  children: ReactNode;
  /** Auto-advance interval in ms. */
  intervalMs?: number;
  className?: string;
};

/**
 * Lightweight auto-advancing carousel. Each child is one full-width slide; the
 * track slides horizontally and advances on a timer (paused on hover). Dots and
 * arrows allow manual control. No external dependency.
 */
export function AutoCarousel({ children, intervalMs = 5000, className }: Props) {
  const slides = Children.toArray(children);
  const n = slides.length;
  const [index, setIndex] = useState(0);
  const [paused, setPaused] = useState(false);
  const timer = useRef<number>();

  useEffect(() => {
    if (paused || n <= 1) return;
    timer.current = window.setInterval(() => setIndex((i) => (i + 1) % n), intervalMs);
    return () => window.clearInterval(timer.current);
  }, [paused, n, intervalMs]);

  const go = (i: number) => setIndex(((i % n) + n) % n);

  return (
    <div
      className={className}
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
    >
      <div className="flex items-center gap-2 sm:gap-4">
        {n > 1 && (
          <button
            type="button"
            aria-label="Previous"
            onClick={() => go(index - 1)}
            className="shrink-0 flex items-center justify-center w-10 h-10 rounded-full bg-background text-foreground shadow-sm ring-1 ring-border transition-colors hover:bg-muted"
          >
            <ChevronLeft className="w-5 h-5" />
          </button>
        )}

        <div className="relative overflow-hidden rounded-xl flex-1 min-w-0">
          <div
            className="flex transition-transform duration-700 ease-in-out"
            style={{ transform: `translateX(-${index * 100}%)` }}
          >
            {slides.map((slide, i) => (
              <div key={i} className="min-w-full">
                {slide}
              </div>
            ))}
          </div>
        </div>

        {n > 1 && (
          <button
            type="button"
            aria-label="Next"
            onClick={() => go(index + 1)}
            className="shrink-0 flex items-center justify-center w-10 h-10 rounded-full bg-background text-foreground shadow-sm ring-1 ring-border transition-colors hover:bg-muted"
          >
            <ChevronRight className="w-5 h-5" />
          </button>
        )}
      </div>

      {n > 1 && (
        <div className="flex justify-center gap-2 mt-6">
          {slides.map((_, i) => (
            <button
              key={i}
              type="button"
              aria-label={`Go to slide ${i + 1}`}
              onClick={() => go(i)}
              className={`h-2.5 rounded-full transition-all ${
                i === index ? "w-8 bg-primary" : "w-2.5 bg-muted-foreground/30 hover:bg-muted-foreground/50"
              }`}
            />
          ))}
        </div>
      )}
    </div>
  );
}
