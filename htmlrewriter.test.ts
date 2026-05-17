import { describe, test, expect } from "bun:test";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function rewrite(html: string, rewriter: HTMLRewriter): string {
  return rewriter.transform(html);
}

// ---------------------------------------------------------------------------
// Element handlers — tag name, attributes
// ---------------------------------------------------------------------------

describe("HTMLRewriter — element handler", () => {
  test("element() is called for matching selector", () => {
    const tags: string[] = [];
    const result = rewrite(
      "<div><span>hello</span></div>",
      new HTMLRewriter().on("span", {
        element(el) {
          tags.push(el.tagName);
        },
      }),
    );
    expect(tags).toEqual(["span"]);
    expect(result).toContain("hello");
  });

  test("tagName is lowercase", () => {
    let name = "";
    rewrite(
      "<DIV>x</DIV>",
      new HTMLRewriter().on("div", {
        element(el) {
          name = el.tagName;
        },
      }),
    );
    expect(name).toBe("div");
  });

  test("getAttribute returns existing attribute", () => {
    let href = "";
    rewrite(
      '<a href="https://example.com">link</a>',
      new HTMLRewriter().on("a", {
        element(el) {
          href = el.getAttribute("href") ?? "";
        },
      }),
    );
    expect(href).toBe("https://example.com");
  });

  test("getAttribute returns null for missing attribute", () => {
    let val: string | null = "NOT_NULL";
    rewrite(
      "<p>text</p>",
      new HTMLRewriter().on("p", {
        element(el) {
          val = el.getAttribute("data-missing");
        },
      }),
    );
    expect(val).toBeNull();
  });

  test("hasAttribute returns true/false", () => {
    let hasClass = false;
    let hasId = false;
    rewrite(
      '<div class="foo">x</div>',
      new HTMLRewriter().on("div", {
        element(el) {
          hasClass = el.hasAttribute("class");
          hasId = el.hasAttribute("id");
        },
      }),
    );
    expect(hasClass).toBe(true);
    expect(hasId).toBe(false);
  });

  test("setAttribute mutates the attribute in output", () => {
    const result = rewrite(
      '<a href="old">link</a>',
      new HTMLRewriter().on("a", {
        element(el) {
          el.setAttribute("href", "https://bun.sh");
        },
      }),
    );
    expect(result).toContain('href="https://bun.sh"');
    expect(result).not.toContain("old");
  });

  test("removeAttribute removes it from output", () => {
    const result = rewrite(
      '<img src="x.png" alt="img">',
      new HTMLRewriter().on("img", {
        element(el) {
          el.removeAttribute("alt");
        },
      }),
    );
    expect(result).not.toContain("alt");
    expect(result).toContain("src");
  });

  test("attributes iterator yields all pairs", () => {
    const attrs: [string, string][] = [];
    rewrite(
      '<div id="a" class="b">x</div>',
      new HTMLRewriter().on("div", {
        element(el) {
          attrs.push(...el.attributes);
        },
      }),
    );
    expect(attrs.map(([k]) => k).sort()).toEqual(["class", "id"]);
  });
});

// ---------------------------------------------------------------------------
// Content mutation — prepend / append / before / after / replace / remove
// ---------------------------------------------------------------------------

describe("HTMLRewriter — content mutation", () => {
  test("prepend inserts before element inner content", () => {
    const result = rewrite(
      "<div>world</div>",
      new HTMLRewriter().on("div", {
        element(el) {
          el.prepend("hello ");
        },
      }),
    );
    expect(result).toContain("hello world");
  });

  test("append inserts after element inner content", () => {
    const result = rewrite(
      "<div>hello</div>",
      new HTMLRewriter().on("div", {
        element(el) {
          el.append(" world");
        },
      }),
    );
    expect(result).toContain("hello world");
  });

  test("before inserts before the element", () => {
    const result = rewrite(
      "<p>text</p>",
      new HTMLRewriter().on("p", {
        element(el) {
          el.before("<b>BEFORE</b>", { html: true });
        },
      }),
    );
    expect(result.indexOf("BEFORE")).toBeLessThan(result.indexOf("text"));
  });

  test("after inserts after the element", () => {
    const result = rewrite(
      "<p>text</p>",
      new HTMLRewriter().on("p", {
        element(el) {
          el.after("<b>AFTER</b>", { html: true });
        },
      }),
    );
    expect(result.indexOf("AFTER")).toBeGreaterThan(result.indexOf("text"));
  });

  test("replace substitutes the element", () => {
    const result = rewrite(
      "<p>old</p>",
      new HTMLRewriter().on("p", {
        element(el) {
          el.replace("<span>new</span>", { html: true });
        },
      }),
    );
    expect(result).toContain("new");
    expect(result).not.toContain("<p>");
  });

  test("remove removes the element and its content", () => {
    const result = rewrite(
      "<div>keep</div><span>remove-me</span>",
      new HTMLRewriter().on("span", {
        element(el) {
          el.remove();
        },
      }),
    );
    expect(result).not.toContain("remove-me");
    expect(result).toContain("keep");
  });

  test("removeAndKeepContent removes tag but keeps inner text", () => {
    const result = rewrite(
      "<b>bold text</b>",
      new HTMLRewriter().on("b", {
        element(el) {
          el.removeAndKeepContent();
        },
      }),
    );
    expect(result).toContain("bold text");
    expect(result).not.toContain("<b>");
  });

  test("setInnerContent replaces inner HTML", () => {
    const result = rewrite(
      "<div>old content</div>",
      new HTMLRewriter().on("div", {
        element(el) {
          el.setInnerContent("<em>new</em>", { html: true });
        },
      }),
    );
    expect(result).toContain("<em>new</em>");
    expect(result).not.toContain("old content");
  });
});

// ---------------------------------------------------------------------------
// Text handlers
// ---------------------------------------------------------------------------

describe("HTMLRewriter — text handler", () => {
  test("text() is called with text chunks", () => {
    const chunks: string[] = [];
    rewrite(
      "<p>hello world</p>",
      new HTMLRewriter().on("p", {
        text(t) {
          if (t.text) chunks.push(t.text);
        },
      }),
    );
    expect(chunks.join("")).toContain("hello world");
  });

  test("text can be replaced", () => {
    const result = rewrite(
      "<h1>Old Title</h1>",
      new HTMLRewriter().on("h1", {
        text(t) {
          if (t.text) t.replace("New Title");
        },
      }),
    );
    expect(result).toContain("New Title");
    expect(result).not.toContain("Old Title");
  });
});

// ---------------------------------------------------------------------------
// Multiple selectors and chaining
// ---------------------------------------------------------------------------

describe("HTMLRewriter — multiple selectors", () => {
  test("two .on() calls both fire", () => {
    const seen: string[] = [];
    rewrite(
      "<h1>title</h1><p>body</p>",
      new HTMLRewriter()
        .on("h1", {
          element() {
            seen.push("h1");
          },
        })
        .on("p", {
          element() {
            seen.push("p");
          },
        }),
    );
    expect(seen.sort()).toEqual(["h1", "p"]);
  });

  test("attribute selector [href] matches elements with that attribute", () => {
    const hrefs: string[] = [];
    rewrite(
      '<a href="https://a.com">A</a><a>B</a>',
      new HTMLRewriter().on("a[href]", {
        element(el) {
          hrefs.push(el.getAttribute("href")!);
        },
      }),
    );
    expect(hrefs).toEqual(["https://a.com"]);
  });

  test("class selector .foo matches by class", () => {
    const matched: string[] = [];
    rewrite(
      '<div class="foo">yes</div><div class="bar">no</div>',
      new HTMLRewriter().on(".foo", {
        element(el) {
          matched.push(el.tagName);
        },
      }),
    );
    expect(matched).toEqual(["div"]);
  });
});

// ---------------------------------------------------------------------------
// onDocument — doctype / text / end
// ---------------------------------------------------------------------------

describe("HTMLRewriter — onDocument()", () => {
  test("end handler fires at document end", () => {
    let ended = false;
    rewrite(
      "<html><body>hi</body></html>",
      new HTMLRewriter().onDocument({
        end() {
          ended = true;
        },
      }),
    );
    expect(ended).toBe(true);
  });

  test("end.append adds content after document", () => {
    const result = rewrite(
      "<html><body>hi</body></html>",
      new HTMLRewriter().onDocument({
        end(e) {
          e.append("<!-- appended -->", { html: true });
        },
      }),
    );
    expect(result).toContain("<!-- appended -->");
  });

  test("doctype handler receives name", () => {
    let dtName: string | null = null;
    rewrite(
      "<!DOCTYPE html><html></html>",
      new HTMLRewriter().onDocument({
        doctype(dt) {
          dtName = dt.name;
        },
      }),
    );
    expect(dtName).toBe("html");
  });
});

// ---------------------------------------------------------------------------
// transform() with Response input
// ---------------------------------------------------------------------------

describe("HTMLRewriter — transform(Response)", () => {
  test("transform(Response) returns a Response", () => {
    const response = new Response("<p>hello</p>", {
      headers: { "content-type": "text/html" },
    });
    const result = new HTMLRewriter()
      .on("p", {
        element(el) {
          el.setAttribute("data-ok", "1");
        },
      })
      .transform(response);
    expect(result).toBeInstanceOf(Response);
  });

  test("transformed Response body contains mutations", async () => {
    const response = new Response("<p>hello</p>", {
      headers: { "content-type": "text/html" },
    });
    const result = new HTMLRewriter()
      .on("p", {
        element(el) {
          el.append(" world");
        },
      })
      .transform(response);
    const text = await result.text();
    expect(text).toContain("hello world");
  });
});
