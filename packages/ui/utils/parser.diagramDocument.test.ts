import { describe, expect, test } from "bun:test";
import { diagramDocumentBlocks, parseMarkdownToBlocks } from "./parser";
import { isGraphvizLanguage, isMermaidLanguage } from "../components/diagramLanguages";

const SOURCE = ["flowchart TD", "  A[Start] --> B{Choice}", "  B --> C[Done]"].join("\n");

describe("diagramDocumentBlocks", () => {
  test("produces one block whose language routes to the right engine", () => {
    const [mermaid] = diagramDocumentBlocks(SOURCE, "mermaid");
    expect(diagramDocumentBlocks(SOURCE, "mermaid")).toHaveLength(1);
    expect(mermaid.type).toBe("code");
    expect(mermaid.content).toBe(SOURCE);
    expect(isMermaidLanguage(mermaid.language)).toBe(true);

    const [graphviz] = diagramDocumentBlocks("digraph G { a -> b }", "graphviz");
    expect(isGraphvizLanguage(graphviz.language)).toBe(true);
    expect(isMermaidLanguage(graphviz.language)).toBe(false);
  });

  test("the line offset is 0, so a diagram comment names the FILE's own line", () => {
    // DiagramBlock passes block.startLine as the viewer's sourceLineOffset and
    // the codec adds it to the 1-based line within the diagram source. In a
    // document that offset is the fence's opening line, which sits one line
    // ABOVE the diagram's first line — so a synthesized "```mermaid\n" wrapper
    // would report every diagram comment one line too high. A diagram FILE has
    // no fence: its first line is document line 1, so the offset must be 0.
    const [block] = diagramDocumentBlocks(SOURCE, "mermaid");
    expect(block.startLine).toBe(0);

    // The same content inside a fence: offset 1, and line 1 of the fence body
    // is document line 2.
    const fenced = parseMarkdownToBlocks("```mermaid\n" + SOURCE + "\n```");
    const fence = fenced.find((b) => b.type === "code");
    expect(fence?.startLine).toBe(1);
    expect(fence?.content).toBe(SOURCE);

    // `B --> C[Done]` is line 3 of the file and line 4 of the fenced document.
    const lineInSource = SOURCE.split("\n").indexOf("  B --> C[Done]") + 1;
    expect(lineInSource + block.startLine).toBe(3);
    expect(lineInSource + (fence?.startLine ?? 0)).toBe(4);
  });

  test("an empty diagram file still yields the block the engine reports its error on", () => {
    const [block] = diagramDocumentBlocks("", "mermaid");
    expect(block.content).toBe("");
    expect(block.type).toBe("code");
  });
});
