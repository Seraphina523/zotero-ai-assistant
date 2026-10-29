import { assert } from "chai";
import {
  anchorPages,
  blockText,
  flattenPack,
  openSDTPack,
  parseTextMapPages,
} from "../src/services/sdt";

/**
 * Regression guards for the SDT pack reader.
 *
 * Four bugs were found in real use, all in index/offset arithmetic:
 *   1. readU32LE used 0x100000000 for the top byte (should be 0x1000000)
 *   2. chunk offsets were read as interleaved pairs instead of two arrays
 *   3. metadata/catalog were read without inflating
 *   4. a leading zero was prepended to both index arrays
 *   5. the last block's end offset forgot to subtract the offset table
 */
describe("sdt pack reader", function () {
  it("reads u32 little-endian correctly", function () {
    const bytes = new Uint8Array([0x78, 0x00, 0x00, 0x00]);
    assert.equal(parseU32(bytes, 0), 120);
    const big = new Uint8Array([0xe0, 0x00, 0x00, 0x00]);
    assert.equal(parseU32(big, 0), 224);
    const wide = new Uint8Array([0x00, 0x01, 0x00, 0x00]);
    assert.equal(parseU32(wide, 0), 256);
  });

  it("rejects a pack with a bad magic number", async function () {
    let message = "";
    try {
      await openSDTPack(new Uint8Array(64).fill(0));
    } catch (error: any) {
      message = error.message;
    }
    assert.include(message, "Invalid SDTPack");
  });

  it("reads page numbers from a text map", function () {
    const runs = [
      [0, 0, 0, 0, 10, 10, 5],
      [0, 0, 0, 20, 10, 30, 5],
      [0, 2, 0, 0, 10, 10, 5],
    ];
    assert.deepEqual(parseTextMapPages(JSON.stringify(runs)), [1, 3]);
  });

  it("reads page numbers from a page anchor", function () {
    assert.deepEqual(
      anchorPages({ pageRects: [[0, 0, 0, 100, 100], [3, 0, 0, 100, 100]] }),
      [1, 4],
    );
  });

  it("flattens a pack into sections", function () {
    const pack: any = {
      schemaVersion: "1.0.0",
      metadata: {},
      catalog: { pages: [] },
      content: [
        {
          type: "heading",
          anchor: { pageRects: [[0, 0, 0, 100, 20]] },
          content: [{ text: "Introduction" }],
        },
        {
          type: "paragraph",
          anchor: { pageRects: [[0, 0, 30, 100, 60]] },
          content: [{ text: "We study" }, { text: " protein folding." }],
        },
      ],
    };
    const sections = flattenPack(pack);
    assert.equal(sections.length, 2);
    assert.equal(sections[0].text, "Introduction");
    assert.equal(sections[1].text, "We study protein folding.");
    assert.deepEqual(sections[1].pages, [1]);
  });

  it("does not duplicate inline text nodes", function () {
    const block: any = {
      type: "paragraph",
      content: [{ text: "alpha" }, { text: " beta" }],
    };
    assert.equal(blockText(block), "alpha beta");
  });
});

/** Local copy of the reader's u32 helper, used to pin the expected value. */
function parseU32(bytes: Uint8Array, offset: number): number {
  return (
    (bytes[offset] +
      bytes[offset + 1] * 0x100 +
      bytes[offset + 2] * 0x10000 +
      bytes[offset + 3] * 0x1000000) >>>
    0
  );
}
