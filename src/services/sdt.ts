/**
 * Structured Document Text (SDT) pack reader.
 *
 * Zotero stores a structured, page-anchored representation of every indexed
 * PDF/EPUB in the SDT pack cache. This module decodes that pack so the
 * assistant can cite page numbers and jump to them in the reader.
 *
 * The pack format is documented in the zotero/structured-document-text repo.
 * We only implement the read path we need: header, index, metadata, catalog
 * and top-level content blocks.
 */

const MAGIC = [0x89, 0x53, 0x44, 0x54, 0x0d, 0x0a, 0x1a, 0x0a]; // \x89SDT\r\n\x1a\n
const HEADER_SIZE = 16;
const INDEX_FIXED_SIZE = 8;
const U32_BYTES = 4;

export interface SDTBlock {
  type?: string;
  content?: (SDTTextNode | SDTBlock)[];
  anchor?: any;
  text?: string;
  [key: string]: any;
}

export interface SDTTextNode {
  text?: string;
  [key: string]: any;
}

export interface SDTPageInfo {
  label?: string;
  textSource?: "born-digital" | "ocr";
  extractionDegraded?: boolean;
  [key: string]: any;
}

export interface SDTCatalog {
  outline: any[];
  pages: SDTPageInfo[];
  pageMappingType?: "physical" | "locations";
  [key: string]: any;
}

export interface SDTPack {
  schemaVersion: string;
  metadata: any;
  catalog: SDTCatalog;
  content: SDTBlock[];
}

function readU32LE(bytes: Uint8Array, offset: number): number {
  // Matches structured-document-text/src/pack/bytes.js readU32LE.
  return (
    (bytes[offset] +
      bytes[offset + 1] * 0x100 +
      bytes[offset + 2] * 0x10000 +
      bytes[offset + 3] * 0x1000000) >>>
    0
  );
}

function readJSONBytes(bytes: Uint8Array): any {
  const decoder = new TextDecoder();
  return JSON.parse(decoder.decode(bytes));
}

/**
 * Decode a raw deflate stream.
 *
 * Uses the pako bundle that ships with Zotero (the same library Zotero's own
 * sdt.js uses). `DecompressionStream` is not exposed reliably in the plugin
 * sandbox.
 */
async function inflateRaw(data: Uint8Array): Promise<Uint8Array> {
  const pako = require("pako") as {
    inflateRaw(input: Uint8Array): Uint8Array;
  };
  return pako.inflateRaw(data);
}

function assertMagic(bytes: Uint8Array, offset: number) {
  for (let i = 0; i < MAGIC.length; i++) {
    if (bytes[offset + i] !== MAGIC[i]) {
      throw new Error("Invalid SDTPack: bad magic number");
    }
  }
}

interface PackIndex {
  metadataLength: number;
  catalogLength: number;
  chunkByteOffsets: number[];
  chunkBlockStarts: number[];
}

class PackReader {
  private source: Uint8Array;
  private header: any;
  private index: PackIndex;

  constructor(source: Uint8Array, header: any, index: PackIndex) {
    this.source = source;
    this.header = header;
    this.index = index;
  }

  get topLevelBlockCount(): number {
    const starts = this.index.chunkBlockStarts;
    return starts.length ? starts[starts.length - 1] : 0;
  }

  private range(offset: number, length: number): Uint8Array {
    if (offset + length > this.source.byteLength) {
      throw new Error("Invalid SDTPack: read out of bounds");
    }
    return this.source.subarray(offset, offset + length);
  }

  private async inflatedChunk(chunkIndex: number): Promise<Uint8Array> {
    // Content starts after the header, index, metadata and catalog.
    const contentStart =
      HEADER_SIZE +
      this.header.indexLength +
      this.index.metadataLength +
      this.index.catalogLength;
    const offset = this.index.chunkByteOffsets[chunkIndex];
    const next = this.index.chunkByteOffsets[chunkIndex + 1];
    if (offset > next) {
      throw new Error("Invalid SDTPack chunk bounds");
    }
    const compressed = this.range(contentStart + offset, next - offset);
    return inflateRaw(compressed);
  }

  private getChunkBlockCount(chunkIndex: number): number {
    const starts = this.index.chunkBlockStarts;
    return starts[chunkIndex + 1] - starts[chunkIndex];
  }

  async getMetadata(): Promise<any> {
    // Metadata and catalog are deflate-compressed, like the content chunks.
    const contentStart = HEADER_SIZE + this.header.indexLength;
    const raw = this.range(contentStart, this.index.metadataLength);
    const bytes = await inflateRaw(raw);
    return readJSONBytes(bytes);
  }

  async getCatalog(): Promise<SDTCatalog> {
    const contentStart = HEADER_SIZE + this.header.indexLength;
    const raw = this.range(
      contentStart + this.index.metadataLength,
      this.index.catalogLength,
    );
    const bytes = await inflateRaw(raw);
    return readJSONBytes(bytes) as SDTCatalog;
  }

  async materialize(): Promise<SDTPack> {
    const [metadata, catalog] = await Promise.all([
      this.getMetadata(),
      this.getCatalog(),
    ]);
    const content: SDTBlock[] = [];
    const starts = this.index.chunkBlockStarts;

    for (let chunkIndex = 0; chunkIndex < starts.length - 1; chunkIndex++) {
      const chunkBytes = await this.inflatedChunk(chunkIndex);
      const blockCount = this.getChunkBlockCount(chunkIndex);
      const headerByteLength = blockCount * 4;

      // Offset table: blockCount little-endian u32 values, followed by the
      // concatenated JSON blocks. The last block runs to the end of the
      // payload, i.e. byteLength - headerByteLength (not byteLength).
      const offsets: number[] = [];
      for (let i = 0; i < blockCount; i++) {
        offsets.push(readU32LE(chunkBytes, i * 4));
      }

      for (let local = 0; local < blockCount; local++) {
        const start = offsets[local];
        const end =
          local + 1 < blockCount
            ? offsets[local + 1]
            : chunkBytes.byteLength - headerByteLength;
        if (start > end) {
          throw new Error(
            `Invalid SDTPack content chunk block range at ${local} (start ${start} > end ${end})`,
          );
        }
        content.push(
          readJSONBytes(
            chunkBytes.subarray(headerByteLength + start, headerByteLength + end),
          ),
        );
      }
    }

    return {
      schemaVersion: this.header.schemaVersion,
      metadata,
      catalog,
      content,
    };
  }
}

/** Open a raw SDT pack (as returned by Zotero.SDT.getPack). */
export async function openSDTPack(
  bytes: Uint8Array,
): Promise<PackReader> {
  if (bytes.byteLength < HEADER_SIZE) {
    throw new Error("Invalid SDTPack: file too small");
  }
  assertMagic(bytes, 0);
  const header = {
    packVersion: bytes[8],
    schemaVersion: `${bytes[9]}.${bytes[10]}.${bytes[11]}`,
    indexLength: readU32LE(bytes, 12),
  };
  const indexEnd = HEADER_SIZE + header.indexLength;
  if (indexEnd > bytes.byteLength) {
    throw new Error("Invalid SDTPack index bounds");
  }
  const indexBytes = bytes.subarray(HEADER_SIZE, indexEnd);

  // Index layout (see structured-document-text/src/pack/format.js decodeIndex):
  //   metadataLength, catalogLength, then ALL chunkByteOffsets, then ALL
  //   chunkBlockStarts — two separate arrays, not interleaved.
  //
  // Both arrays already start at 0, so the leading zero must NOT be prepended.
  const entryCount =
    (header.indexLength - INDEX_FIXED_SIZE) / (U32_BYTES * 2);
  if (!Number.isInteger(entryCount) || entryCount < 1) {
    throw new Error("Invalid SDTPack index shape");
  }

  const index: PackIndex = {
    metadataLength: readU32LE(indexBytes, 0),
    catalogLength: readU32LE(indexBytes, 4),
    chunkByteOffsets: [],
    chunkBlockStarts: [],
  };
  for (let i = 0; i < entryCount; i++) {
    index.chunkByteOffsets.push(
      readU32LE(indexBytes, INDEX_FIXED_SIZE + i * U32_BYTES),
    );
  }
  for (let i = 0; i < entryCount; i++) {
    index.chunkBlockStarts.push(
      readU32LE(
        indexBytes,
        INDEX_FIXED_SIZE + entryCount * U32_BYTES + i * U32_BYTES,
      ),
    );
  }

  // The last chunk offset must land exactly at the end of the file.
  const contentEnd =
    HEADER_SIZE +
    header.indexLength +
    index.metadataLength +
    index.catalogLength +
    index.chunkByteOffsets[index.chunkByteOffsets.length - 1];
  if (contentEnd !== bytes.byteLength) {
    throw new Error(
      `Invalid SDTPack layout: content ends at ${contentEnd}, file is ${bytes.byteLength}`,
    );
  }

  return new PackReader(bytes, header, index);
}

/** Collect the plain text of a block subtree, in document order. */
export function blockText(block: SDTBlock): string {
  const parts: string[] = [];
  const walk = (node: any) => {
    if (!node) return;
    if (typeof node.text === "string") {
      parts.push(node.text);
      return;
    }
    if (Array.isArray(node.content)) {
      for (const child of node.content) walk(child);
    }
  };
  walk(block);
  return parts.join("").trim();
}

/**
 * Collect the plain text of a block, ignoring inline text nodes.
 *
 * Inline text nodes are already part of the parent block's rendered text, so
 * they are appended directly rather than recursed into.
 */
function blockOwnText(block: SDTBlock): string {
  const inline: string[] = [];
  const nested: string[] = [];
  if (Array.isArray(block.content)) {
    for (const child of block.content) {
      if (!child || typeof child !== "object") continue;
      if (typeof (child as any).text === "string") {
        inline.push((child as any).text);
        continue;
      }
      if (Array.isArray((child as any).content)) {
        nested.push(blockOwnText(child as SDTBlock));
      }
    }
  }
  return [
    inline.join("").trim(),
    ...nested,
  ]
    .filter(Boolean)
    .join("\n\n");
}

export interface DocumentSection {
  ref: number[];
  type: string;
  text: string;
  /** 1-based page numbers this block spans, when the anchor provides them. */
  pages: number[];
}

/** Flatten a pack into a linear list of sections with page anchors. */
export function flattenPack(pack: SDTPack): DocumentSection[] {
  const sections: DocumentSection[] = [];
  let order = 0;
  const walk = (block: SDTBlock, parent: number[]) => {
    const ref = [...parent, order++];
    const text = blockOwnText(block);
    if (text) {
      sections.push({
        ref,
        type: block.type || "block",
        text,
        pages: anchorPages(block.anchor),
      });
    }
    if (Array.isArray(block.content)) {
      for (const child of block.content) {
        if (child && typeof child === "object" && !Array.isArray(child)) {
          walk(child as SDTBlock, ref);
        }
      }
    }
  };
  for (const block of pack.content || []) {
    walk(block, []);
  }
  return sections;
}

/** Extract 1-based page numbers from a PDF/DOM anchor. */
export function anchorPages(anchor: any): number[] {
  if (!anchor) return [];
  const pages = new Set<number>();
  const pageRects = anchor.pageRects;
  if (Array.isArray(pageRects)) {
    for (const rect of pageRects) {
      if (Array.isArray(rect) && rect.length >= 1) {
        const index = Number(rect[0]);
        if (Number.isFinite(index)) pages.add(index + 1);
      }
    }
  }
  const parsed = parseTextMapPages(anchor.textMap);
  for (const page of parsed) pages.add(page);
  return [...pages].sort((a, b) => a - b);
}

/**
 * Decode the packed text layout. Runs look like
 * `[header, pageIndex, minX, minY, maxX, maxY, ...widths]`, where widths may
 * be plain numbers or `[delta, width]` pairs. We only need the page index.
 */
export function parseTextMapPages(textMap: string | undefined): number[] {
  if (!textMap) return [];
  let runs: any[];
  try {
    runs = JSON.parse(textMap);
  } catch {
    return [];
  }
  if (!Array.isArray(runs)) return [];
  const pages = new Set<number>();
  for (const run of runs) {
    if (Array.isArray(run) && run.length >= 2) {
      const index = Number(run[1]);
      if (Number.isFinite(index)) pages.add(index + 1);
    }
  }
  return [...pages].sort((a, b) => a - b);
}
