import { assert } from "chai";
import { markdownToHTML } from "../src/services/notebook";

/**
 * Reproduces renderAnswer's text-node replacement to prove [p.X] becomes a link.
 */
describe("page citations", function () {
  it("keeps [p.X] intact through markdown rendering", function () {
    const text =
      "The study applied RealESRGAN-x4plus at 2x, 3x, and 4x magnifications [p.502]. Errors occurred at 4x [p.502].";
    const html = markdownToHTML(text);
    assert.include(html, "[p.502]");

    const pattern = /\[p\.([^\]]+)\]/g;
    const matches = [...html.matchAll(pattern)].map((m) => m[0]);
    assert.lengthOf(matches, 2, "both citations should be found");
  });

  it("finds citations inside list items", function () {
    const html = markdownToHTML("- 降低精度：摘要指出低分辨率 [p.502]");
    const matches = [...html.matchAll(/\[p\.([^\]]+)\]/g)].map((m) => m[0]);
    assert.deepEqual(matches, ["[p.502]"]);
  });

  it("parses multi-page ranges", function () {
    assert.deepEqual("4-6".split(/[,\-–]/).map((p) => parseInt(p, 10)), [4, 6]);
    assert.deepEqual("3,5".split(/[,\-–]/).map((p) => parseInt(p, 10)), [3, 5]);
  });

  it("replaces citations in a real DOM", function () {
    const doc = Zotero.getMainWindow().document;
    const host = doc.createElement("div");
    host.innerHTML = markdownToHTML(
      "applied at 2x [p.502]. Errors at 4x [p.502].",
    );

    // Same walk + replace as renderAnswer.
    const collectTextNodes = (root: any): any[] => {
      const found: any[] = [];
      const visit = (node: any) => {
        if (node.nodeType === 3) {
          found.push(node);
          return;
        }
        let child = node.firstChild;
        while (child) {
          visit(child);
          child = child.nextSibling;
        }
      };
      visit(root);
      return found;
    };

    host.querySelectorAll("p, li, h2, h3, h4").forEach((node: any) => {
      for (const textNode of collectTextNodes(node)) {
        const value = textNode.nodeValue || "";
        const pattern = /\[p\.([^\]]+)\]/g;
        if (!pattern.test(value)) continue;
        pattern.lastIndex = 0;
        const fragment = doc.createDocumentFragment();
        let last = 0;
        let match: RegExpExecArray | null;
        while ((match = pattern.exec(value))) {
          if (match.index > last) {
            fragment.appendChild(doc.createTextNode(value.slice(last, match.index)));
          }
          const anchor = doc.createElement("a");
          anchor.textContent = match[0];
          anchor.setAttribute("href", "#");
          fragment.appendChild(anchor);
          last = match.index + match[0].length;
        }
        if (last < value.length) {
          fragment.appendChild(doc.createTextNode(value.slice(last)));
        }
        textNode.parentNode?.replaceChild(fragment, textNode);
      }
    });

    const links = host.querySelectorAll("a");
    assert.lengthOf(links, 2, "both citations should become links");
    assert.equal(links[0].textContent, "[p.502]");
    assert.isTrue(host.textContent.includes("applied at 2x [p.502]"));
  });
});
