import type { Content } from "@tiptap/core";

// Tiptap treats strings as HTML, including serialized ProseMirror documents.
export function normalizeEditorContent(content: Content | null): Content {
  if (typeof content !== "string") return content ?? "";

  try {
    const parsed: unknown = JSON.parse(content);
    if (
      parsed !== null &&
      typeof parsed === "object" &&
      "type" in parsed &&
      parsed.type === "doc" &&
      (!("content" in parsed) || Array.isArray(parsed.content))
    ) {
      return parsed as Content;
    }
  } catch {
    // HTML and plain text remain valid editor input.
  }

  return content;
}
