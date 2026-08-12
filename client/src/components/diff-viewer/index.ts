/* diff-viewer — unified-diff viewer with optional inline GitHub comments.
   Public surface: the DiffViewer component + the DiffCommentApi contract, plus
   the patch parser itself — SmartDiffViewer renders its own decorated file cards
   but must read patches exactly the way this viewer does, so it reuses
   `parsePatch` rather than growing a second parser that can drift. */
export { DiffViewer } from "./DiffViewer";
export type { DiffCommentApi } from "./comments";
export { parsePatch, type Line } from "./helpers";
