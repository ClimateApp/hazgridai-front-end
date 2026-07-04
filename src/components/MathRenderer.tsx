import { useMemo } from "react";
import katex from "katex";
import "katex/dist/katex.min.css";

interface MathRendererProps {
  math: string;
  display?: boolean;
  className?: string;
}

/**
 * Renders LaTeX math using KaTeX
 * @param math - LaTeX math string
 * @param display - If true, renders as block (display) math; otherwise inline
 */
const MathRenderer = ({ math, display = false, className = "" }: MathRendererProps) => {
  const html = useMemo(() => {
    try {
      return katex.renderToString(math, {
        displayMode: display,
        throwOnError: false,
        errorColor: "#ef4444",
        trust: false,
        strict: false,
      });
    } catch (error) {
      console.error("KaTeX rendering error:", error);
      return `<span class="text-destructive">${math}</span>`;
    }
  }, [math, display]);

  return (
    <span
      className={`katex-container ${display ? "block my-3" : "inline"} ${className}`}
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
};

export default MathRenderer;
