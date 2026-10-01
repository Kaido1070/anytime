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

test("Team-X parser attaches each relative timestamp to the correct chapter", () => {
  const now = Date.UTC(2026, 8, 20, 18, 0, 0);
  const html = `
    <div>
      <a href="/series/TES/129">الفصل 129 العزلة</a>
      <span>18 hours ago</span>
    </div>
    <div>
      <a href="/series/TES/128">الفصل 128 السادة الغامضون</a>
      <span>1 week ago</span>
    </div>
  `;
  const chapters = __test.parseTeamXChapters(
    html,
    "https://olympustaff.com/series/TES",
    now,
  );
  assert.equal(chapters[0].number, 129);
  assert.equal(
    chapters[0].publishedAt,
    new Date(now - 18 * 60 * 60 * 1000).toISOString(),
  );
  assert.equal(chapters[1].number, 128);
  assert.equal(chapters[1].publishedAt, null);
});

test("Team-X strict date parser accepts minutes and hours only", () => {
  const now = Date.UTC(2026, 8, 20, 18, 0, 0);
  assert.equal(
    __test.parseTeamXPublishedAt("<span>7 hours ago</span>", now),
    new Date(now - 7 * 60 * 60 * 1000).toISOString(),
  );
  assert.equal(
    __test.parseTeamXPublishedAt("<span>14 minutes ago</span>", now),
    new Date(now - 14 * 60 * 1000).toISOString(),
  );
  assert.equal(__test.parseTeamXPublishedAt("<span>1 day ago</span>", now), null);
  assert.equal(__test.parseTeamXPublishedAt("<span>1 week ago</span>", now), null);
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


test("3asq extracts Madara post id for AJAX chapter loading", () => {
  const html = '<div id="manga-chapters-holder" data-id="12345"></div>';
  assert.equal(__test.asqPostId(html), "12345");
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

test("3asq parser extracts relative and absolute chapter publication dates", () => {
  const now = Date.UTC(2026, 8, 20, 12, 0, 0);
  assert.equal(
    __test.parseAsqPublishedAt('<span class="chapter-release-date">منذ 15 ساعة</span>', now),
    new Date(now - 15 * 60 * 60 * 1000).toISOString(),
  );
  assert.equal(
    __test.parseAsqPublishedAt('<span class="chapter-release-date">10 سبتمبر، 2026</span>', now),
    "2026-09-10T00:00:00.000Z",
  );
  assert.equal(
    __test.parseAsqPublishedAt('<span class="chapter-release-date">منذ ساعتين</span>', now),
    new Date(now - 2 * 60 * 60 * 1000).toISOString(),
  );
});

test("3asq chapter dates stay attached to their own chapter block", () => {
  const html = `
    <ul>
      <li class="wp-manga-chapter">
        <a href="https://3asq.online/manga/wistoria/chapter-66/">الفصل 66</a>
        <span class="chapter-release-date">منذ 15 ساعة</span>
      </li>
      <li class="wp-manga-chapter">
        <a href="https://3asq.online/manga/wistoria/chapter-65/">الفصل 65</a>
        <span class="chapter-release-date">10 سبتمبر، 2026</span>
      </li>
    </ul>
  `;
  const chapters = __test.parseAsqChapters(html, "https://3asq.online/manga/wistoria/");
  assert.equal(chapters[0].number, 66);
  assert.ok(Date.parse(chapters[0].publishedAt) > Date.parse(chapters[1].publishedAt));
  assert.equal(chapters[1].publishedAt, "2026-09-10T00:00:00.000Z");
});

test("3asq latest parser keeps chapter dates attached to the exact chapter row", () => {
  const html = `
    <div class="page-item-detail">
      <a href="https://3asq.online/manga/wistoria/" title="WISTORIA: WAND AND SWORD"><img src="https://cdn.example.com/wistoria.webp" alt="WISTORIA: WAND AND SWORD"></a>
      <li class="wp-manga-chapter">
        <a href="https://3asq.online/manga/wistoria/chapter-66/">الفصل 66</a>
        <span class="chapter-release-date">منذ 15 ساعة</span>
        <span>AddText_06-16-01.19.28</span>
      </li>
      <li class="wp-manga-chapter">
        <a href="https://3asq.online/manga/wistoria/chapter-65/">الفصل 65</a>
        <span class="chapter-release-date">10 سبتمبر، 2026</span>
      </li>
    </div>
  `;
  const items = __test.asqLatestItemsFromHtml(html);
  assert.equal(items.length, 1);
  assert.equal(items[0].title, "WISTORIA: WAND AND SWORD");
  assert.equal(items[0].cover, "https://cdn.example.com/wistoria.webp");
  assert.equal(items[0].chapters.length, 2);
  const chapter66 = items[0].chapters.find((chapter) => chapter.number === 66);
  const chapter65 = items[0].chapters.find((chapter) => chapter.number === 65);
  assert.ok(chapter66?.publishedAt);
  assert.equal(chapter65?.publishedAt, "2026-09-10T00:00:00.000Z");
  assert.notEqual(chapter66?.publishedAt, chapter65?.publishedAt);
  assert.notEqual(items[0].title, "AddText_06-16-01.19.28");
});

test("3asq latest card parser pairs each chapter with its own date", () => {
  const now = Date.UTC(2026, 8, 20, 18, 0, 0);
  const html = `
    <div>
      <a href="https://3asq.online/manga/wistoria/chapter-66/">الفصل 66</a>
      <span class="chapter-release-date">منذ ساعتين</span>
      <a href="https://3asq.online/manga/wistoria/chapter-65/">الفصل 65</a>
      <span class="chapter-release-date">10 سبتمبر، 2026</span>
    </div>
  `;
  const chapters = __test.parseAsqLatestCardChapters(
    html,
    "https://3asq.online/manga/wistoria/",
    now,
  );
  assert.equal(chapters.length, 2);
  assert.equal(chapters[0].number, 66);
  assert.equal(chapters[0].publishedAt, new Date(now - 2 * 60 * 60 * 1000).toISOString());
  assert.equal(chapters[1].number, 65);
  assert.equal(chapters[1].publishedAt, "2026-09-10T00:00:00.000Z");
});

test("3asq latest card parser prefers dates inside each chapter li", () => {
  const now = Date.UTC(2026, 8, 20, 18, 0, 0);
  const html = `
    <li class="wp-manga-chapter">
      <a href="https://3asq.online/manga/kengan-omega/chapter-370/">الفصل 370</a>
      <span class="chapter-release-date">منذ 3 ساعات</span>
    </li>
    <li class="wp-manga-chapter">
      <a href="https://3asq.online/manga/kengan-omega/chapter-369/">الفصل 369</a>
      <span class="chapter-release-date">10 سبتمبر، 2026</span>
    </li>
  `;
  const chapters = __test.parseAsqLatestCardChapters(
    html,
    "https://3asq.online/manga/kengan-omega/",
    now,
  );
  assert.equal(chapters.length, 2);
  assert.equal(chapters[0].publishedAt, new Date(now - 3 * 60 * 60 * 1000).toISOString());
  assert.equal(chapters[1].publishedAt, "2026-09-10T00:00:00.000Z");
});

test("3asq latest archive parser keeps nested card boundaries intact", () => {
  const now = Date.UTC(2026, 8, 20, 18, 0, 0);
  const html = `
    <div class="c-tabs-item__content">
      <div class="page-item-detail">
        <a href="https://3asq.online/manga/wistoria/" title="WISTORIA: WAND AND SWORD">
          <img src="https://cdn.example.com/wistoria.webp" alt="WISTORIA: WAND AND SWORD">
        </a>
        <li class="wp-manga-chapter">
          <a href="https://3asq.online/manga/wistoria/chapter-64/">الفصل 64</a>
          <span class="chapter-release-date">منذ 32 دقيقة</span>
        </li>
        <li class="wp-manga-chapter">
          <a href="https://3asq.online/manga/wistoria/chapter-63/">الفصل 63</a>
          <span class="chapter-release-date">منذ يوم واحد</span>
        </li>
      </div>
      <div class="page-item-detail">
        <a href="https://3asq.online/manga/one-piece/" title="One Piece">
          <img src="https://cdn.example.com/one-piece.webp" alt="One Piece">
        </a>
        <li class="wp-manga-chapter">
          <a href="https://3asq.online/manga/one-piece/chapter-1193/">الفصل 1193</a>
          <span class="chapter-release-date">10 سبتمبر، 2026</span>
        </li>
      </div>
    </div>
  `;
  const items = __test.asqLatestItemsFromArchiveHtml(html, now);
  assert.equal(items.length, 2);
  const wistoria = items.find((item) => item.sourceId === "wistoria");
  assert.equal(wistoria.title, "WISTORIA: WAND AND SWORD");
  assert.equal(wistoria.chapters.length, 1);
  assert.equal(wistoria.chapters[0].number, 64);
  assert.equal(
    wistoria.chapters[0].publishedAt,
    new Date(now - 32 * 60 * 1000).toISOString(),
  );
});

test("3asq strict recent dates reject coarse day-relative labels", () => {
  const now = Date.UTC(2026, 8, 20, 18, 0, 0);
  assert.equal(
    __test.parseAsqRecentPublishedAt(
      '<span class="chapter-release-date">منذ 3 ساعات</span>',
      now,
    ),
    new Date(now - 3 * 60 * 60 * 1000).toISOString(),
  );
  assert.equal(
    __test.parseAsqRecentPublishedAt(
      '<span class="chapter-release-date">منذ يوم واحد</span>',
      now,
    ),
    null,
  );
  assert.equal(
    __test.parseAsqRecentPublishedAt(
      '<span class="chapter-release-date">منذ يومين</span>',
      now,
    ),
    null,
  );
});

test("3asq latest metadata guard rejects UI junk and malformed chapters", () => {
  assert.equal(__test.asqSafeSeriesTitle("AddText_06-16-01.19.28", "wistoria"), "wistoria");
  assert.equal(__test.asqSafeSeriesTitle("بدون اسم203", "kengan omega"), "kengan omega");
  assert.equal(__test.asqSafeSeriesTitle("Chapter 370", "kengan omega"), "kengan omega");
  assert.equal(__test.asqSafeSeriesTitle("Kengan Omega", "fallback"), "Kengan Omega");

  assert.equal(__test.asqLatestItemIsSane({
    source: "3asq",
    key: "aq:kengan-omega",
    slug: "kengan-omega",
    title: "Kengan Omega",
    chapters: [{
      number: 370,
      publishedAt: "2026-09-20T18:00:00.000Z",
      url: "https://3asq.online/manga/kengan-omega/chapter-370/",
    }],
  }), true);

  assert.equal(__test.asqLatestItemIsSane({
    source: "3asq",
    key: "aq:kengan-omega",
    slug: "kengan-omega",
    title: "Kengan Omega",
    chapters: [{
      number: 370,
      publishedAt: null,
      url: "https://3asq.online/manga/kengan-omega/chapter-370/",
    }],
  }), false);
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


test("chapter parsers preserve distinct same-number rows by URL identity", () => {
  const asqHtml = `
    <li class="wp-manga-chapter"><a href="https://3asq.online/manga/example/chapter-8/">الفصل 8</a></li>
    <li class="wp-manga-chapter"><a href="https://3asq.online/manga/example/chapter-8-extra/">الفصل 8 تكملة</a></li>
  `;
  const starzHtml = `
    <li class="wp-manga-chapter"><a href="https://starzmanga.com/manga/example/chapter-8/">الفصل 8</a></li>
    <li class="wp-manga-chapter"><a href="https://starzmanga.com/manga/example/chapter-8-extra/">الفصل 8 تكملة</a></li>
  `;
  const mangaLikHtml = `
    <li class="wp-manga-chapter"><a href="https://mangalik.net/manga/example/8/">الفصل 8</a></li>
    <li class="wp-manga-chapter"><a href="https://mangalik.net/manga/example/8-extra/">الفصل 8 تكملة</a></li>
  `;

  assert.equal(
    __test.parseAsqChapters(asqHtml, "https://3asq.online/manga/example/").length,
    2,
  );
  assert.equal(
    __test.parseStarzChapters(starzHtml, "https://starzmanga.com/manga/example/").length,
    2,
  );
  assert.equal(
    __test.parseMangalikChapters(mangaLikHtml, "https://mangalik.net/manga/example/").length,
    2,
  );
});

test("exact source chapter URL selects the right duplicate-number row", () => {
  const chapters = [
    {
      number: 8,
      title: "الفصل 8",
      url: "https://azorafly.com/series/example/chapter-8",
    },
    {
      number: 8,
      title: "الفصل 8 تكملة",
      url: "https://azorafly.com/series/example/chapter-8-continuation",
    },
  ];

  const selected = __test.selectChapterRow(
    chapters,
    8,
    "https://azorafly.com/series/example/chapter-8-continuation",
    "https://azorafly.com/series/example",
    "https://azorafly.com",
  );

  assert.equal(selected.selected.title, "الفصل 8 تكملة");
  assert.equal(
    selected.exactUrl,
    "https://azorafly.com/series/example/chapter-8-continuation",
  );
  assert.equal(
    __test.preferredChapterUrlForSeries(
      "https://evil.example/chapter-8",
      "https://azorafly.com/series/example",
      "https://azorafly.com",
    ),
    "",
  );
});


test("3asq type classifier distinguishes novels and web novels", () => {
  assert.equal(__test.normalizeAsqType("رواية"), "novel");
  assert.equal(__test.normalizeAsqType("رواية ويب"), "web-novel");
  assert.equal(__test.normalizeAsqType("Web Novel"), "web-novel");
  assert.equal(__test.normalizeAsqType("مانجا"), "manga");
});


test("priority windows use Saudi time and stay work-specific", () => {
  const tuesday20Riyadh = Date.UTC(2026, 8, 22, 17, 0, 0);
  assert.deepEqual(__test.priorityWindow(tuesday20Riyadh), {
    eleceed: true,
    magicEmperor: false,
  });
  assert.equal(__test.sourceRefreshIntervalMs(tuesday20Riyadh), 2 * 60_000);

  const friday05Riyadh = Date.UTC(2026, 8, 25, 2, 0, 0);
  assert.deepEqual(__test.priorityWindow(friday05Riyadh), {
    eleceed: false,
    magicEmperor: true,
  });
  assert.equal(__test.sourceRefreshIntervalMs(friday05Riyadh), 2 * 60_000);

  const mondayNoonRiyadh = Date.UTC(2026, 8, 21, 9, 0, 0);
  assert.deepEqual(__test.priorityWindow(mondayNoonRiyadh), {
    eleceed: false,
    magicEmperor: false,
  });
  assert.equal(__test.sourceRefreshIntervalMs(mondayNoonRiyadh), 5 * 60_000);
});

test("MangaTime follows paginated chapter responses until the real end", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url) => {
    const parsed = new URL(String(url));
    const rawInput = JSON.parse(parsed.searchParams.get("input"));
    const input = rawInput.json ?? rawInput["0"]?.json ?? {};

    let chapters = [];
    let hasMore = true;
    if (input.limit === -1) {
      chapters = Array.from({ length: 20 }, (_, index) => ({
        number: 1200 - index,
        title: "Chapter " + (1200 - index),
      }));
    } else {
      const page = Number(input.page ?? 1);
      const start = (page - 1) * 500 + 1;
      const end = Math.min(1200, start + 499);
      chapters = Array.from(
        { length: Math.max(0, end - start + 1) },
        (_, index) => ({
          number: start + index,
          title: "Chapter " + (start + index),
        }),
      );
      hasMore = end < 1200;
    }

    return new Response(
      JSON.stringify({
        result: {
          data: {
            json: {
              chapters,
              total: 1200,
              hasMore,
            },
          },
        },
      }),
      { status: 200, headers: { "Content-Type": "application/json" } },
    );
  };

  try {
    const chapters = await __test.mangaTimeAllChapters("series-1");
    assert.equal(chapters.length, 1200);
    assert.equal(chapters[0].number, 1200);
    assert.equal(chapters.at(-1).number, 1);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("MangaTime keeps exact publishedAt values from its chapter API", () => {
  const chapters = __test.mangaTimeChaptersFromPayload({
    chapters: [
      { number: "12", title: "Chapter 12", publishedAt: "2026-09-20T08:15:00.000Z" },
      { number: "11", title: "Chapter 11", publishedAt: "2026-09-19T07:00:00.000Z" },
      { number: "bad", title: "broken", publishedAt: "2026-09-20T09:00:00.000Z" },
    ],
  });
  assert.deepEqual(chapters.map((chapter) => chapter.number), [12, 11]);
  assert.equal(chapters[0].publishedAt, "2026-09-20T08:15:00.000Z");
  assert.equal(chapters[1].publishedAt, "2026-09-19T07:00:00.000Z");
});

test("MangaTime reader accepts current page payload variants", () => {
  assert.deepEqual(
    __test.mangaTimePagesFromPayload({
      pages: [
        "https://cdn.mangatime.org/ch/001.webp",
        { url: "https://cdn.mangatime.org/ch/002.webp" },
        { imageUrl: "https://cdn.mangatime.org/ch/003.webp" },
      ],
    }),
    [
      "https://cdn.mangatime.org/ch/001.webp",
      "https://cdn.mangatime.org/ch/002.webp",
      "https://cdn.mangatime.org/ch/003.webp",
    ],
  );

  assert.deepEqual(
    __test.mangaTimePagesFromPayload({
      data: {
        pages: [
          { src: "https://cdn.mangatime.org/ch/004.webp" },
          { path: "/reader/ch/005.webp" },
        ],
      },
    }),
    [
      "https://cdn.mangatime.org/ch/004.webp",
      "https://mangatime.org/reader/ch/005.webp",
    ],
  );
});

test("MangaTime reader can recover pages from chapter HTML", () => {
  const html = `
    <main id="chapter-reader">
      <img src="https://mangatime.org/assets/logo.webp">
      <img data-src="https://cdn.mangatime.org/chapters/a/001.webp">
      <script>
        window.__reader = {"pages":["https:\\/\\/cdn.mangatime.org\\/chapters\\/a\\/002.webp"]};
      </script>
    </main>
    <footer><img src="https://mangatime.org/assets/footer.webp"></footer>
  `;
  assert.deepEqual(__test.parseMangaTimePages(html), [
    "https://cdn.mangatime.org/chapters/a/001.webp",
    "https://cdn.mangatime.org/chapters/a/002.webp",
  ]);
  assert.equal(
    __test.mangaTimeChapterUrl({ type: "manhwa", slug: "academys-genius-swordmaster" }, 119),
    "https://mangatime.org/manhwa/academys-genius-swordmaster/chapter/119",
  );
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

test("StarzManga strict New accepts precise times and rejects date-only labels", () => {
  const now = Date.UTC(2026, 8, 20, 12, 0, 0);
  assert.equal(
    __test.parseStarzPublishedAt('<time datetime="2026-09-20T08:30:00Z">20 سبتمبر، 2026</time>', now),
    "2026-09-20T08:30:00.000Z",
  );
  assert.equal(
    __test.parseStarzPublishedAt('<span class="chapter-release-date">منذ 3 ساعات</span>', now),
    "2026-09-20T09:00:00.000Z",
  );
  assert.equal(
    __test.parseStarzPublishedAt('<span class="chapter-release-date">20 سبتمبر، 2026</span>', now),
    null,
  );
});

test("StarzManga parses Arabic singular and dual relative times", () => {
  const now = Date.UTC(2026, 8, 20, 12, 0, 0);
  assert.equal(
    __test.parseStarzPublishedAt("<span>منذ دقيقة</span>", now),
    "2026-09-20T11:59:00.000Z",
  );
  assert.equal(
    __test.parseStarzPublishedAt("<span>منذ دقيقتين</span>", now),
    "2026-09-20T11:58:00.000Z",
  );
  assert.equal(
    __test.parseStarzPublishedAt("<span>منذ ساعة</span>", now),
    "2026-09-20T11:00:00.000Z",
  );
  assert.equal(
    __test.parseStarzPublishedAt("<span>منذ ساعتين</span>", now),
    "2026-09-20T10:00:00.000Z",
  );
});

test("StarzManga latest card keeps chapter timestamps scoped to each row", () => {
  const now = Date.UTC(2026, 8, 20, 12, 0, 0);
  const html = `
    <div class="page-item-detail">
      <a href="https://starzmanga.com/manga/example-work/" title="Example Work">
        <img src="https://cdn.example.com/example.webp" alt="Example Work">
      </a>
      <a href="https://starzmanga.com/manga/example-work/chapter-12/">12</a>
      <span>منذ ساعتين</span>
      <a href="https://starzmanga.com/manga/example-work/chapter-11/">11</a>
      <span>20 سبتمبر، 2026</span>
    </div>
  `;
  const items = __test.starzLatestItemsFromHtml(html, now);
  assert.equal(items.length, 1);
  assert.equal(items[0].chapters.length, 1);
  assert.equal(items[0].chapters[0].number, 12);
  assert.equal(items[0].chapters[0].publishedAt, "2026-09-20T10:00:00.000Z");
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

test("XSano paginates chapter feeds until the source-reported end", async () => {
  const originalFetch = globalThis.fetch;
  const starts = [];
  globalThis.fetch = async (url) => {
    const parsed = new URL(String(url));
    const start = Number(parsed.searchParams.get("start-index"));
    starts.push(start);
    const total = 1200;
    const remaining = Math.max(0, total - start + 1);
    const count = Math.min(500, remaining);
    const entries = Array.from({ length: count }, (_, offset) => {
      const number = start + offset;
      return {
        id: { "$t": "chapter-" + number },
        title: { "$t": "Chapter " + number },
        published: { "$t": "2026-01-01T00:00:00.000Z" },
        category: [{ term: "Chapter" }],
        link: [{
          rel: "alternate",
          href: "https://www.xsano-manga.com/2026/01/chapter-" + number + ".html",
        }],
      };
    });

    return new Response(
      JSON.stringify({
        feed: {
          "openSearch$totalResults": { "$t": String(total) },
          entry: entries,
        },
      }),
      { status: 200, headers: { "Content-Type": "application/json" } },
    );
  };

  try {
    const chapters = await __test.xsanoFetchChapters(
      "https://www.xsano-manga.com/feeds/posts/default/-/Chapter/Test?alt=json",
    );
    assert.equal(chapters.length, 1200);
    assert.deepEqual(starts, [1, 501, 1001]);
  } finally {
    globalThis.fetch = originalFetch;
  }
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


test("MangaLik parses its explicit Arabic chapter dates", () => {
  assert.equal(
    __test.parseMangalikPublishedAt('<span class="chapter-release-date">سبتمبر 17, 2026</span>'),
    "2026-09-17T00:00:00.000Z",
  );
  assert.equal(
    __test.parseMangalikPublishedAt('<span class="chapter-release-date">17 سبتمبر، 2026</span>'),
    "2026-09-17T00:00:00.000Z",
  );
  assert.equal(
    __test.parseMangalikPublishedAt('<span class="chapter-release-date">بدون تاريخ</span>'),
    null,
  );
});

test("MangaLik keeps each chapter date scoped to its own row", () => {
  const html = `
    <ul>
      <li class="wp-manga-chapter">
        <a href="https://mangalik.net/manga/nano-machine/chapter-330/">330</a>
        <span class="chapter-release-date">سبتمبر 17, 2026</span>
      </li>
      <li class="wp-manga-chapter">
        <a href="https://mangalik.net/manga/nano-machine/chapter-329/">329</a>
        <span class="chapter-release-date">سبتمبر 10, 2026</span>
      </li>
    </ul>
  `;
  const chapters = __test.parseMangalikChapters(
    html,
    "https://mangalik.net/manga/nano-machine/",
  );
  assert.equal(chapters[0].number, 330);
  assert.equal(chapters[0].publishedAt, "2026-09-17T00:00:00.000Z");
  assert.equal(chapters[1].number, 329);
  assert.equal(chapters[1].publishedAt, "2026-09-10T00:00:00.000Z");
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

test("MangaLik latest parser reads newest chapter cards without series hydration", () => {
  const html = `
    <div class="page-item-detail">
      <a href="https://mangalik.net/manga/the-bully-in-charge/" title="The Bully In Charge">
        <img src="https://cdn.example.com/bully.webp" alt="The Bully In Charge">
      </a>
      <li class="wp-manga-chapter">
        <a href="https://mangalik.net/manga/the-bully-in-charge/200/">200</a>
        <span class="chapter-release-date">سبتمبر 20, 2026</span>
      </li>
      <li class="wp-manga-chapter">
        <a href="https://mangalik.net/manga/the-bully-in-charge/199/">199</a>
        <span class="chapter-release-date">سبتمبر 15, 2026</span>
      </li>
    </div>
  `;
  const items = __test.mangalikLatestItemsFromHtml(html);
  assert.equal(items.length, 1);
  assert.equal(items[0].title, "The Bully In Charge");
  assert.equal(items[0].cover, "https://cdn.example.com/bully.webp");
  assert.deepEqual(items[0].chapters.map((chapter) => chapter.number), [200, 199]);
  assert.equal(items[0].chapters[0].publishedAt, "2026-09-20T00:00:00.000Z");
  assert.equal(items[0].chapters[1].publishedAt, "2026-09-15T00:00:00.000Z");
});

test("MangaLik latest parser supports flat chapter rows and strict relative times", () => {
  const now = Date.UTC(2026, 8, 20, 12, 0, 0);
  const html = `
    <div class="page-item-detail">
      <a href="https://mangalik.net/manga/magic-emperor/" title="Magic emperor">
        <img src="https://cdn.example.com/magic.webp" alt="Magic emperor">
      </a>
      <a href="https://mangalik.net/manga/magic-emperor/912/">912</a>
      <span class="chapter-release-date">5 ساعات ago</span>
      <a href="https://mangalik.net/manga/magic-emperor/911/">911</a>
      <span class="chapter-release-date">1 يوم ago</span>
    </div>
  `;
  const items = __test.mangalikLatestItemsFromHtml(html, now);
  assert.equal(items.length, 1);
  assert.equal(items[0].title, "Magic emperor");
  assert.equal(items[0].chapters.length, 1);
  assert.equal(items[0].chapters[0].number, 912);
  assert.equal(items[0].chapters[0].publishedAt, "2026-09-20T07:00:00.000Z");
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

test("MangaLik reader parser supports lazy srcset and inline reader URLs", () => {
  const lazyHtml = `
    <div class="reading-content">
      <div class="page-break">
        <img src="data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw=="
             data-srcset="https://cdn.mangalik.net/ch/001.webp 1x, https://cdn.mangalik.net/ch/001@2x.webp 2x">
      </div>
      <div class="page-break">
        <img data-original="https://cdn.mangalik.net/ch/002.webp">
      </div>
    </div>
  `;
  assert.deepEqual(__test.parseMangalikPages(lazyHtml), [
    "https://cdn.mangalik.net/ch/001@2x.webp",
    "https://cdn.mangalik.net/ch/002.webp",
  ]);

  const inlineHtml = `
    <div class="reading-content">
      <script>
        window.readerPages = ["https:\\/\\/cdn.mangalik.net\\/ch\\/003.webp"];
      </script>
    </div>
    <footer><img src="https://mangalik.net/logo.png"></footer>
  `;
  assert.deepEqual(__test.parseMangalikPages(inlineHtml), [
    "https://cdn.mangalik.net/ch/003.webp",
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


test("chapter list recovery prefers the more complete source response", () => {
  const preview = [{ number: 323 }, { number: 322 }, { number: 0 }];
  const full = Array.from({ length: 324 }, (_, number) => ({ number }));
  assert.equal(__test.moreCompleteChapters(preview, full).length, 324);
  assert.equal(__test.moreCompleteChapters(full, preview).length, 324);
});

test("chapter list recovery deduplicates the same chapter when only its title changes", () => {
  const merged = __test.mergeChapterLists(
    [{ number: 12, title: "الفصل 12" }],
    [{ number: 12, title: "Chapter 12" }],
  );
  assert.equal(merged.length, 1);
  assert.equal(merged[0].number, 12);
});

test("chapter list recovery preserves distinct same-number rows when source URLs differ", () => {
  const merged = __test.mergeChapterLists(
    [{ number: 8, title: "الفصل 8", url: "https://example.com/series/a/chapter-8" }],
    [{ number: 8, title: "الفصل 8 تكملة", url: "https://example.com/series/a/chapter-8-continuation" }],
  );
  assert.equal(merged.length, 2);
});

test("chapter list recovery unions disjoint preview and archive rows", () => {
  const preview = [
    { number: 10, title: "10", url: "https://example.com/chapter-10" },
    { number: 1, title: "1", url: "https://example.com/chapter-1" },
  ];
  const archive = [
    { number: 9, title: "9", url: "https://example.com/chapter-9" },
    { number: 8, title: "8", url: "https://example.com/chapter-8" },
  ];
  assert.deepEqual(
    __test.mergeChapterLists(preview, archive).map((chapter) => chapter.number),
    [10, 9, 8, 1],
  );
});

test("Madara chapter archive follows an explicit load-more page", async () => {
  const originalFetch = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async (_url, options = {}) => {
    calls += 1;
    const body = String(options.body ?? "");
    const page = Number(new URLSearchParams(body).get("page") ?? 1);
    const html = page === 1
      ? `
          <ul>
            <li class="wp-manga-chapter"><a href="/manga/example/chapter-3/">3</a></li>
            <li class="wp-manga-chapter"><a href="/manga/example/chapter-2/">2</a></li>
          </ul>
          <button class="chapter-load-more" data-page="2">عرض المزيد</button>
        `
      : `
          <ul>
            <li class="wp-manga-chapter"><a href="/manga/example/chapter-1/">1</a></li>
          </ul>
        `;

    return new Response(html, {
      status: 200,
      headers: { "Content-Type": "text/html" },
    });
  };

  try {
    const html = await __test.fetchMadaraCompleteChapterHtml(
      "https://example.com",
      "https://example.com/manga/example/",
      "TEST",
      "failed",
    );
    assert.match(html, /chapter-3/);
    assert.match(html, /chapter-1/);
    assert.ok(calls >= 2);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("Madara chapter archive probes hidden pagination without a visible marker", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (_url, options = {}) => {
    const body = String(options.body ?? "");
    const page = Number(new URLSearchParams(body).get("page") ?? 1);
    const html =
      page === 1
        ? '<li class="wp-manga-chapter"><a href="/manga/example/chapter-4/">4</a></li>'
        : page === 2
          ? '<li class="wp-manga-chapter"><a href="/manga/example/chapter-3/">3</a></li>'
          : page === 3
            ? '<li class="wp-manga-chapter"><a href="/manga/example/chapter-2/">2</a></li>'
            : page === 4
              ? '<li class="wp-manga-chapter"><a href="/manga/example/chapter-1/">1</a></li>'
              : '<li class="wp-manga-chapter"><a href="/manga/example/chapter-1/">1</a></li>';

    return new Response(html, {
      status: 200,
      headers: { "Content-Type": "text/html" },
    });
  };

  try {
    const html = await __test.fetchMadaraCompleteChapterHtml(
      "https://example.com",
      "https://example.com/manga/example/",
      "TEST",
      "failed",
    );
    assert.match(html, /chapter-4/);
    assert.match(html, /chapter-3/);
    assert.match(html, /chapter-2/);
    assert.match(html, /chapter-1/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("Azora Overgeared uses the current canonical series slug", () => {
  assert.equal(
    __test.azoraCanonicalSeriesUrl({
      title: "Overgeared",
      slug: "overgeared",
      url: "https://azorafly.com/series/overgeared",
    }),
    "https://azorafly.com/series/overgeared-12",
  );
});

test("Azora restores any provably sequential load-more list from the source count", () => {
  const html = `
    <div>الفصول ( 342 )</div>
    <a href="/series/overgeared-12/chapter-341">الفصل 341</a>
    <a href="/series/overgeared-12/chapter-340">الفصل 340</a>
    <a href="/series/overgeared-12/chapter-0">اقرأ الفصل 0</a>
  `;
  const parsed = __test.parseAzoraChapters(
    html,
    "https://azorafly.com/series/overgeared-12",
  );
  const chapters = __test.azoraCompleteSequentialChapters(
    html,
    "https://azorafly.com/series/overgeared-12",
    parsed,
  );

  assert.equal(__test.azoraDeclaredChapterCount(html), 342);
  assert.equal(chapters.length, 342);
  assert.equal(chapters[0].number, 341);
  assert.equal(chapters.at(-1).number, 0);
  assert.equal(
    chapters.find((chapter) => chapter.number === 292)?.url,
    "https://azorafly.com/series/overgeared-12/chapter-292",
  );
});

test("Azora keeps distinct same-number chapter rows instead of collapsing them", () => {
  const html = `
    <a href="/series/youth-set-menu/chapter-8">الفصل 8 قائمه طعام اليوم</a>
    <a href="/series/youth-set-menu/chapter-8-continuation">الفصل 8 تكملة الفصل 8</a>
    <a href="/series/youth-set-menu/chapter-7">الفصل 7</a>
  `;
  const chapters = __test.parseAzoraChapters(
    html,
    "https://azorafly.com/series/youth-set-menu",
  );
  assert.equal(chapters.length, 3);
  assert.deepEqual(chapters.map((chapter) => chapter.number), [8, 8, 7]);
  assert.notEqual(chapters[0].url, chapters[1].url);
});

test("Azora does not invent missing chapter rows for ordinary series", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () =>
    new Response("", {
      status: 200,
      headers: { "Content-Type": "text/html" },
    });

  try {
    const html = `
      <div>الفصول ( 10 )</div>
      <button>عرض المزيد</button>
      <a href="/series/example/chapter-10">الفصل 10</a>
      <a href="/series/example/chapter-9">الفصل 9</a>
    `;
    const result = await __test.azoraCompleteChapterList(
      html,
      "https://azorafly.com/series/example",
    );

    assert.equal(result.declaredCount, 10);
    assert.equal(result.chapters.length, 2);
    assert.equal(result.complete, false);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("Azora follows chapter load-more pages when the first HTML is incomplete", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url) => {
    const parsed = new URL(String(url));
    const page = Number(
      parsed.searchParams.get("chapterPage") ??
      parsed.searchParams.get("chaptersPage") ??
      parsed.searchParams.get("chapter_page") ??
      parsed.searchParams.get("chapters_page") ??
      parsed.searchParams.get("page") ??
      1,
    );

    const html = page === 2
      ? `
          <a href="/series/example/chapter-8">الفصل 8</a>
          <a href="/series/example/chapter-7">الفصل 7</a>
          <a href="/series/example/chapter-6">الفصل 6</a>
        `
      : "";

    return new Response(html, {
      status: 200,
      headers: { "Content-Type": "text/html" },
    });
  };

  try {
    const firstHtml = `
      <div>الفصول ( 5 )</div>
      <button>عرض المزيد</button>
      <a href="/series/example/chapter-10">الفصل 10</a>
      <a href="/series/example/chapter-9">الفصل 9</a>
    `;
    const result = await __test.azoraCompleteChapterList(
      firstHtml,
      "https://azorafly.com/series/example",
    );
    assert.equal(result.complete, true);
    assert.equal(result.chapters.length, 5);
    assert.deepEqual(result.chapters.map((chapter) => chapter.number), [10, 9, 8, 7, 6]);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("Azora follows load-more pages even when the source omits a total count", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url) => {
    const parsed = new URL(String(url));
    const page = Number(
      parsed.searchParams.get("chapterPage") ??
      parsed.searchParams.get("chaptersPage") ??
      parsed.searchParams.get("chapter_page") ??
      parsed.searchParams.get("chapters_page") ??
      parsed.searchParams.get("page") ??
      1,
    );

    const html =
      page === 2
        ? '<a href="/series/example/chapter-2">الفصل 2</a>'
        : page === 3
          ? '<a href="/series/example/chapter-1">الفصل 1</a>'
          : '<a href="/series/example/chapter-1">الفصل 1</a>';

    return new Response(html, {
      status: 200,
      headers: { "Content-Type": "text/html" },
    });
  };

  try {
    const firstHtml = `
      <button>عرض المزيد</button>
      <a href="/series/example/chapter-3">الفصل 3</a>
    `;
    const result = await __test.azoraCompleteChapterList(
      firstHtml,
      "https://azorafly.com/series/example",
    );
    assert.deepEqual(
      result.chapters.map((chapter) => chapter.number),
      [3, 2, 1],
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("Azora recovers chapters embedded in Next payloads beyond the visible preview", () => {
  const html = `
    <a href="/series/example/chapter-323">الفصل 323</a>
    <a href="/series/example/chapter-0">اقرأ الفصل 0</a>
    <script>
      self.__next_f.push([1,"\\/series\\/example\\/chapter-322 \\u002Fseries\\u002Fexample\\u002Fchapter-321"]);
    </script>
  `;
  const chapters = __test.parseAzoraChapters(
    html,
    "https://azorafly.com/series/example",
  );
  assert.deepEqual(chapters.map((chapter) => chapter.number), [323, 322, 321, 0]);
});

test("Azora parser reads series chapters and metadata", () => {
  const html = `
    <meta name="description" content="وصف Shadow Slave">
    <a href="/genres/action">أكشن</a>
    <a href="https://azorafly.com/series/shadow-slave/chapter-10">الفصل 10</a>
    <a href="/series/shadow-slave/chapter-9.5">الفصل 9.5</a>
    <a href="/series/shadow-slave/chapter-9">الفصل 9</a>
  `;
  assert.deepEqual(
    __test.parseAzoraChapters(html, "https://azorafly.com/series/shadow-slave").map((chapter) => chapter.number),
    [10, 9.5, 9],
  );
  assert.equal(__test.azoraDescription(html), "وصف Shadow Slave");
  assert.deepEqual(__test.azoraGenreCandidates(html), ["أكشن"]);
});

test("Azora list parser creates az source keys", () => {
  const html = `
    <article>
      <a href="/series/shadow-slave" title="Shadow Slave">
        <img alt="Shadow Slave" src="https://cdn.example.com/covers/shadow-slave.webp">
        <h3>Shadow Slave</h3>
      </a>
    </article>
  `;
  const items = __test.azoraItemsFromHtml(html);
  assert.equal(items.length, 1);
  assert.equal(items[0].key, "az:shadow-slave");
  assert.equal(items[0].source, "azora");
  assert.equal(items[0].title, "Shadow Slave");
});

test("Azora page parser unwraps Next image URLs in page order", () => {
  const html = `
    <main>
      <img alt="Shadow Slave الفصل 1 Page 1" src="/_next/image?url=https%3A%2F%2Fcdn.example.com%2Fshadow-slave%2F001.webp&w=1600&q=90">
      <img alt="Shadow Slave الفصل 1 Page 2" src="/_next/image?url=https%3A%2F%2Fcdn.example.com%2Fshadow-slave%2F002.webp&w=1600&q=90">
      <img alt="logo" src="/logo.webp">
    </main>
  `;
  assert.deepEqual(__test.parseAzoraPages(html), [
    "https://cdn.example.com/shadow-slave/001.webp",
    "https://cdn.example.com/shadow-slave/002.webp",
  ]);
});


test("Azora parses Arabic singular and dual minute/hour ages", () => {
  const now = Date.UTC(2026, 9, 1, 10, 0, 0);
  assert.equal(
    __test.parseAzoraRecentRelativeAt("منذ دقيقة", now),
    new Date(now - 60_000).toISOString(),
  );
  assert.equal(
    __test.parseAzoraRecentRelativeAt("منذ دقيقتين تقريباً", now),
    new Date(now - 2 * 60_000).toISOString(),
  );
  assert.equal(
    __test.parseAzoraRecentRelativeAt("منذ ساعة", now),
    new Date(now - 3_600_000).toISOString(),
  );
  assert.equal(
    __test.parseAzoraRecentRelativeAt("منذ ساعتين تقريباً", now),
    new Date(now - 2 * 3_600_000).toISOString(),
  );
});

test("Azora recent date parser accepts only strict minute/hour ages", () => {
  const now = Date.UTC(2026, 9, 1, 10, 0, 0);
  assert.equal(
    __test.parseAzoraRecentRelativeAt("منذ 3 ساعات تقريباً", now),
    new Date(now - 3 * 3_600_000).toISOString(),
  );
  assert.equal(__test.parseAzoraRecentRelativeAt("منذ يوم واحد", now), null);
  assert.equal(__test.parseAzoraRecentRelativeAt("جديد", now), null);
});

test("Azora chapter publication parser prefers machine timestamps", () => {
  const html = '<meta property="article:published_time" content="2026-10-01T05:12:34+03:00">';
  assert.equal(
    __test.parseAzoraChapterPublishedAt(html),
    "2026-10-01T02:12:34.000Z",
  );
});

test("Azora archive recent candidates reject coarse old rows", () => {
  const now = Date.UTC(2026, 9, 1, 10, 0, 0);
  const html = `
    <a href="/series/alpha/chapter-12">الفصل 12</a><span>منذ ساعتين تقريباً</span>
    <a href="/series/alpha/chapter-11">الفصل 11</a><span>منذ 3 أيام</span>
    <a href="/series/beta/chapter-7.5">الفصل 7.5</a><span>جديد</span>
  `;
  const rows = __test.azoraRecentArchiveCandidates(html, now);
  assert.deepEqual(
    rows.map((row) => [row.slug, row.number, Boolean(row.relativePublishedAt), row.isNew]),
    [
      ["alpha", 12, true, false],
      ["beta", 7.5, false, true],
    ],
  );
});
