import { Editor, type Content } from "@tiptap/core";
import { StarterKit } from "@tiptap/starter-kit";
import { describe, expect, it } from "vitest";
import { normalizeEditorContent } from "./normalize-editor-content";

const document: Content = {
  type: "doc",
  content: [
    {
      type: "heading",
      attrs: { level: 2 },
      content: [{ type: "text", text: "文章标题" }],
    },
    {
      type: "paragraph",
      content: [{ type: "text", text: "正文", marks: [{ type: "bold" }] }],
    },
  ],
};

function renderContent(content: Content | null) {
  const editor = new Editor({
    extensions: [StarterKit],
    editable: false,
    content: normalizeEditorContent(content),
  });
  try {
    return { html: editor.getHTML(), text: editor.getText() };
  } finally {
    editor.destroy();
  }
}

describe("normalizeEditorContent", () => {
  it.each([
    ["serialized JSON", JSON.stringify(document)],
    ["JSON objects from the editor cache", document],
  ])("renders %s as formatted content on the first render", (_, content) => {
    expect(renderContent(content).html).toBe(
      "<h2>文章标题</h2><p><strong>正文</strong></p>",
    );
  });

  it("preserves HTML content", () => {
    expect(renderContent("<p><em>正文</em></p>").html).toBe(
      "<p><em>正文</em></p>",
    );
  });

  it.each([
    "普通正文",
    '{"example": true}',
    '{"type":"doc","content":"example"}',
    '{"type":"doc",',
    "null",
    "42",
  ])("preserves text that is not a serialized document: %s", (text) => {
    expect(renderContent(text).text).toBe(text);
  });

  it.each([null, undefined, "", '{"type":"doc"}'])(
    "renders empty content safely: %s",
    (content) => {
      expect(renderContent(content).text).toBe("");
    },
  );
});
