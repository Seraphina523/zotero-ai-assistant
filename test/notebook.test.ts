import { assert } from "chai";
import { dedupeSections, renderSections } from "../src/services/notebook";

/**
 * Reproduces the note-creation path used by appendSection().
 *
 * Regression guard for two bugs found in real use:
 *   1. note.setField('title', ...) -> "'title' is not a valid field for type 'note'"
 *   2. calling saveTx() twice on a new item -> NOT NULL constraint failed:
 *      items.itemTypeID
 */
describe("notebook", function () {
  it("creates a note whose title comes from the note body", async function () {
    const parent = new Zotero.Item("journalArticle");
    parent.libraryID = Zotero.Libraries.userLibraryID;
    parent.setField("title", "AI notebook test paper");
    await parent.saveTx();

    // Same construction as src/services/notebook.ts
    const note = new Zotero.Item("note");
    note.libraryID = parent.libraryID;
    note.parentID = parent.id;
    note.setNote(
      "AI 助手\n\n本文档由 Zotero AI Assistant 生成。",
    );
    await note.saveTx();

    assert.isNumber(note.id, "note should have an id after save");
    assert.equal(note.itemTypeID, Zotero.ItemTypes.getID("note"));
    assert.equal(note.getNoteTitle(), "AI 助手");

    // A second save must not fail the NOT NULL constraint.
    note.setNote(`${note.getNote()}\n\n新的一节`);
    await note.saveTx();
    assert.include(note.getNote(), "新的一节");

    // Clean up
    note.deleted = true;
    await note.saveTx();
    parent.deleted = true;
    await parent.saveTx();
  });

  it("creates a note for a parent in a group library", async function () {
    const groups = Zotero.Groups.getAll();
    if (!groups.length) return; // no group library to test against
    const group = groups[0];

    const parent = new Zotero.Item("journalArticle");
    parent.libraryID = group.libraryID;
    parent.setField("title", "Group library test");
    await parent.saveTx();

    const note = new Zotero.Item("note");
    note.libraryID = parent.libraryID;
    note.parentID = parent.id;
    note.setNote("AI 助手\n\n内容");
    await note.saveTx();

    assert.isNumber(note.id);

    note.deleted = true;
    await note.saveTx();
    parent.deleted = true;
    await parent.saveTx();
  });
});

describe("note sections", function () {
  it("renders one block per section with headings and timestamps", function () {
    const html = renderSections([
      {
        id: "a",
        heading: "摘要",
        body: "**要点**：测试",
        time: 1761000000000,
        accent: "#4f6ef7",
      },
      {
        id: "b",
        heading: "图表解读",
        body: "- 图1 框架图",
        time: 1761000100000,
        accent: "#8b5cf6",
      },
    ]);
    assert.include(html, "摘要");
    assert.include(html, "图表解读");
    assert.include(html, "<strong>要点</strong>");
    assert.include(html, "<li>图1 框架图</li>");
    // Markdown must be rendered, not shown literally.
    assert.notInclude(html, "**要点**");
    assert.notInclude(html, "- 图1");
  });

  it("returns just the header when there are no sections", function () {
    const html = renderSections([]);
    assert.include(html, "AI 助手");
    assert.notInclude(html, "blockquote");
  });
});

describe("section dedupe", function () {
  it("keeps the newest section per heading", function () {
    const deduped = dedupeSections([
      { id: "1", heading: "摘要", body: "old", time: 100 },
      { id: "2", heading: "图表解读", body: "fig", time: 200 },
      { id: "3", heading: "摘要", body: "new", time: 300 },
    ]);
    assert.lengthOf(deduped, 2);
    assert.equal(deduped[0].heading, "摘要");
    assert.equal(deduped[0].body, "new", "should keep the newer summary");
    assert.equal(deduped[1].heading, "图表解读");
  });

  it("leaves distinct headings untouched", function () {
    const sections = [
      { id: "1", heading: "摘要", body: "a", time: 1 },
      { id: "2", heading: "翻译（中文）", body: "b", time: 2 },
      { id: "3", heading: "批判性分析", body: "c", time: 3 },
    ];
    assert.lengthOf(dedupeSections(sections), 3);
  });

  it("handles an empty list", function () {
    assert.deepEqual(dedupeSections([]), []);
  });
});
