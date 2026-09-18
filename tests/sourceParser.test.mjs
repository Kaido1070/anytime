import test from "node:test";
import assert from "node:assert/strict";
import { __test } from "../functions/api/source/[[path]].js";

test("Team-X parser finds real chapter links and synthesizes gaps", () => {
  const html = `
    <a href="/series/villain-is-here/357"><div>الفصل 357 معركة</div></a>
    <a href="/series/villain-is-here/355"><div>الفصل 355</div></a>
    <a href="/series/villain-is-here/1"><div>الفصل 1</div></a>
  `;
  const chapters = __test.parseTeamXChapters(
    html,
    "https://olympustaff.com/series/villain-is-here",
  );
  assert.equal(chapters[0].number, 357);
  assert.equal(chapters.at(-1).number, 1);
  assert.ok(chapters.some((chapter) => chapter.number === 356));
});

test("Team-X page parser prefers the image_list area", () => {
  const html = `
    <img src="/logo.png">
    <div class="image_list">
      <img src="https://cdn.example.com/chapter/1.webp">
      <img data-src="https://cdn.example.com/chapter/2.webp">
    </div>
    <div id="comments"><img src="/avatar.png"></div>
  `;
  const pages = __test.parseTeamXPages(html);
  assert.deepEqual(pages.slice(0, 2), [
    "https://cdn.example.com/chapter/1.webp",
    "https://cdn.example.com/chapter/2.webp",
  ]);
});

test("source status normalization supports Arabic and English", () => {
  assert.equal(__test.normalizeStatus("مستمرة"), "ongoing");
  assert.equal(__test.normalizeStatus("Completed"), "completed");
  assert.equal(__test.normalizeStatus("متوقف"), "hiatus");
});


test("3asq parser reads Madara chapter numbers and URLs", () => {
  const html = `
    <ul>
      <li class="wp-manga-chapter"><a href="https://3asq.online/manga/one-piece/chapter-1193/">الفصل 1193</a></li>
      <li class="wp-manga-chapter"><a href="/manga/one-piece/1037_1/">الفصل 1037.1</a></li>
    </ul>
  `;
  const chapters = __test.parseAsqChapters(html, "https://3asq.online/manga/one-piece/");
  assert.deepEqual(chapters.map((chapter) => chapter.number), [1193, 1037.1]);
  assert.ok(chapters[0].url.includes("/manga/one-piece/chapter-1193/"));
});

test("3asq page parser prefers lazy Madara page images", () => {
  const html = `
    <div class="reading-content">
      <div class="page-break"><img src="data:image/gif;base64,placeholder" data-src="https://cdn.example.com/001.webp"></div>
      <div class="page-break"><img data-lazy-src="https://cdn.example.com/002.webp"></div>
    </div>
    <footer><img src="/logo.png"></footer>
  `;
  assert.deepEqual(__test.parseAsqPages(html), [
    "https://cdn.example.com/001.webp",
    "https://cdn.example.com/002.webp",
  ]);
});

test("3asq chapter number parser handles Madara slugs", () => {
  assert.equal(__test.asqChapterNumber("الفصل 12.5", "chapter-12-5"), 12.5);
  assert.equal(__test.asqChapterNumber("", "1037_1"), 1037.1);
});


test("3asq type classifier distinguishes novels and web novels", () => {
  assert.equal(__test.normalizeAsqType("رواية"), "novel");
  assert.equal(__test.normalizeAsqType("رواية ويب"), "web-novel");
  assert.equal(__test.normalizeAsqType("Web Novel"), "web-novel");
  assert.equal(__test.normalizeAsqType("مانجا"), "manga");
});


test("MangaTime novel types receive the Arabic novels category", () => {
  assert.deepEqual(__test.mangaTimeTypeGenres("novel"), ["novel", "روايات"]);
  assert.deepEqual(__test.mangaTimeTypeGenres("web_novel"), ["web_novel", "روايات"]);
  assert.deepEqual(__test.mangaTimeTypeGenres("manga"), ["manga"]);
  assert.equal(__test.isNovelLabel("Light Novel"), true);
  assert.equal(__test.isNovelLabel("رواية ويب"), true);
});


test("StarzManga extracts Madara post id and chapter list", () => {
  const detail = '<div id="manga-chapters-holder" data-id="82737"></div>';
  assert.equal(__test.starzPostId(detail), "82737");

  const html = `
    <ul>
      <li class="wp-manga-chapter"><a href="https://starzmanga.com/manga/getter-robo-go/chapter-12/">الفصل 12</a></li>
      <li class="wp-manga-chapter"><a href="/manga/getter-robo-go/chapter-11-5/">Chapter 11.5</a></li>
    </ul>
  `;
  const chapters = __test.parseStarzChapters(html, "https://starzmanga.com/manga/getter-robo-go/");
  assert.deepEqual(chapters.map((chapter) => chapter.number), [12, 11.5]);
});

test("StarzManga page parser keeps chapter images only", () => {
  const html = `
    <div class="reading-content">
      <div class="page-break"><img data-src="https://cdn.example.com/chapter/001.webp"></div>
      <div class="page-break"><img src="https://cdn.example.com/chapter/002.webp"></div>
    </div>
    <footer><img src="https://starzmanga.com/logo.png"></footer>
  `;
  assert.deepEqual(__test.parseStarzPages(html), [
    "https://cdn.example.com/chapter/001.webp",
    "https://cdn.example.com/chapter/002.webp",
  ]);
});


test("XSano detects its Zeist chapter feed", () => {
  const html = `
    <main>
      <div id="clwd"><script>clwd.run("Ao-Ashi")</script></div>
    </main>
  `;
  assert.equal(
    __test.xsanoChapterFeedUrl(html),
    "https://www.xsano-manga.com/feeds/posts/default/-/Chapter/Ao-Ashi?alt=json",
  );
});

test("XSano parses Blogger chapter entries", () => {
  const entries = [
    {
      title: { "$t": "الفصل 410" },
      published: { "$t": "2026-02-03T00:00:00.000Z" },
      category: [{ term: "Chapter" }],
      link: [{ rel: "alternate", href: "https://www.xsano-manga.com/2026/02/ao-ashi-410.html" }],
    },
    {
      title: { "$t": "Chapter 409.5" },
      category: [{ term: "Chapter" }],
      link: [{ rel: "alternate", href: "https://www.xsano-manga.com/2026/02/ao-ashi-409-5.html" }],
    },
  ];
  const chapters = __test.xsanoChaptersFromEntries(entries);
  assert.deepEqual(chapters.map((chapter) => chapter.number), [410, 409.5]);
});

test("XSano reader parser uses images inside reader separators", () => {
  const html = `
    <main>
      <div id="reader">
        <div class="separator"><img src="https://blogger.googleusercontent.com/001.webp"></div>
        <div class="separator"><img src="https://blogger.googleusercontent.com/002.webp"></div>
      </div>
    </main>
    <footer><img src="/logo.png"></footer>
  `;
  assert.deepEqual(__test.parseXsanoPages(html), [
    "https://blogger.googleusercontent.com/001.webp",
    "https://blogger.googleusercontent.com/002.webp",
  ]);
});

test("XSano category type recognizes novels", () => {
  assert.equal(__test.xsanoTypeFromCategories(["Series", "Manga", "Drama"]), "manga");
  assert.equal(__test.xsanoTypeFromCategories(["Series", "Novel", "Fantasy"]), "novel");
});


test("MangaLik parses Madara chapter numbers and URLs", () => {
  const html = `
    <ul>
      <li class="wp-manga-chapter"><a href="https://mangalik.net/manga/omniscient-readers-viewpoint/311/">311</a></li>
      <li class="wp-manga-chapter"><a href="/manga/omniscient-readers-viewpoint/290-5/">290.5</a></li>
    </ul>
  `;
  const chapters = __test.parseMangalikChapters(
    html,
    "https://mangalik.net/manga/omniscient-readers-viewpoint/",
  );
  assert.deepEqual(chapters.map((chapter) => chapter.number), [311, 290.5]);
  assert.ok(chapters[0].url.includes("/manga/omniscient-readers-viewpoint/311/"));
});

test("MangaLik reader parser keeps chapter images from its CDN", () => {
  const html = `
    <div class="reading-content">
      <div class="page-break"><img data-src="https://s2solo.mangalik.net/manga/a/chapter/image-01.jpg"></div>
      <div class="page-break"><img src="https://s2solo.mangalik.net/manga/a/chapter/image-02.jpg"></div>
    </div>
    <footer><img src="https://mangalik.net/logo.png"></footer>
  `;
  assert.deepEqual(__test.parseMangalikPages(html), [
    "https://s2solo.mangalik.net/manga/a/chapter/image-01.jpg",
    "https://s2solo.mangalik.net/manga/a/chapter/image-02.jpg",
  ]);
});


test("MangaTime transport uses current web headers and retries the batch shape", async () => {
  const mangaHeaders = __test.sourceHeaders("https://mangatime.org", "application/json");
  assert.equal(mangaHeaders["X-MT-Platform"], "web");
  assert.equal(mangaHeaders["X-MT-UIMode"], "standard");

  const otherHeaders = __test.sourceHeaders("https://olympustaff.com", "text/html");
  assert.equal(otherHeaders["X-MT-Platform"], undefined);
  assert.equal(otherHeaders["X-MT-UIMode"], undefined);

  const originalFetch = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (url, options = {}) => {
    calls.push({ url: String(url), options });
    if (calls.length === 1) {
      return new Response(
        JSON.stringify({ error: { json: { message: "single transport rejected" } } }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );
    }
    return new Response(
      JSON.stringify([{ result: { data: { json: { results: [{ id: "ok" }] } } } }]),
      { status: 200, headers: { "Content-Type": "application/json" } },
    );
  };

  try {
    const payload = await __test.mangaTimeTrpc("search.searchSeries", {
      page: 1,
      limit: 1,
      sortBy: "recent",
      sortOrder: "desc",
      query: null,
    });
    assert.equal(payload.results[0].id, "ok");
    assert.equal(calls.length, 2);
    assert.equal(new URL(calls[0].url).searchParams.get("batch"), null);
    assert.equal(new URL(calls[1].url).searchParams.get("batch"), "1");
    assert.equal(calls[0].options.headers["X-MT-Platform"], "web");
    assert.equal(calls[0].options.headers["X-MT-UIMode"], "standard");
  } finally {
    globalThis.fetch = originalFetch;
  }
});


test("MangaTime list input omits null query but keeps real searches", () => {
  assert.deepEqual(
    __test.mangaTimeSearchInput({ page: 1, sortBy: "recent", query: null }),
    { page: 1, limit: 24, sortBy: "recent", sortOrder: "desc" },
  );
  assert.deepEqual(
    __test.mangaTimeSearchInput({ page: 2, sortBy: "popularity", query: "  One Piece  " }),
    {
      page: 2,
      limit: 24,
      sortBy: "popularity",
      sortOrder: "desc",
      query: "One Piece",
    },
  );
});
