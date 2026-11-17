# Data dictionary: Naver and Daum

## Version of the code

| | |
|---|---|
| **Branch** | `feature/page-records` |
| **Commit** | `0eeacdc39d74469687bfb5777dbc85446b4de31e` (6 November 2026) |
| **Release** | Not in a release yet. Builds of this commit report version 1.12.91. The latest tagged release, `v1.12`, does not have the Naver and Daum modules. |
| **Updated** | 17 November 2026 |

This document is derived from the code at the commit above: it describes what `modules/naver.js` and `modules/daum.js` do at that commit. When those modules change, the document must be checked again. Rows captured with another version of Zoekplaatje (see the column `capture_zoekplaatje_version`) can follow other rules.

## About this document

This document describes the columns that the Naver and Daum modules of Zoekplaatje write, and where each value comes from. It covers the results file (`zoekplaatje-export-naver.com-….csv`, `zoekplaatje-export-daum.net-….csv`) and the fields that these modules add to the pages file (`zoekplaatje-pages-….csv`).

## Where a value comes from

Each column has one of these sources:

| Source | Meaning |
|---|---|
| **Platform** | Copied from what Naver or Daum sent: text, a URL, an id or a flag. Text is only cleaned: HTML tags (for example the highlighting of query words) and HTML entities are removed, and runs of whitespace become one space. |
| **Platform, parsed** | Taken from platform text with a pattern in the module, for example a price from "12,000원" or a rating from "4.5 (1,234)". The value is the platform's, but the module decides which part of the text it is. |
| **Zoekplaatje** | Made by the module: a category, a position, a count, a constant or a note. Naver and Daum do not send this value. |
| **Capture** | Describes the browser and the computer that made the capture, not the search engine. |

Some columns have more than one source. The notes say which source applies when.

## How a page becomes rows

The module splits the results page into **blocks**: the parts of the page that each show one kind of content, such as web results, news, a weather panel or ads. Daum calls these "collections". The module reads the blocks in page order: first the main column, then the sidebar. Each block gives one row for each **item** in it: a web page, an article, a product, a place, and so on.

A block in which the module finds no items still gives one row, with `item_rank` 0, the heading of the block and the start of its text, so that every block on the page appears in the data. On that row, `type` is the same as `block_type`, except for the Daum encyclopedia (`encyclopedia-article`).

Some blocks load their items with a separate request after the page has loaded, for example Naver's related queries. When that request arrives, the module adds its items to the block that they belong to, with the rank of that block. These rows have a later `timestamp` than the rows of the page. If the request never comes (it does not come on every page view), the block has only its own row.

- **Naver**: most blocks have their data as JSON in the page. The code calls these Fender blocks, after the framework that Naver builds them with. The module reads that JSON, not the layout. Ads, shopping, places, books and most info panels have only HTML, which the module reads.
- **Daum**: the module reads the HTML. Many collections keep their items in `<template>` elements that the page shows later; the module also reads those. The AI summary is read from JSON in a script on the page.

## block_id, block_title and block_type

These three columns describe the block that a row belongs to. They differ in who decides the value.

| Column | Source | What it is | Use it for |
|---|---|---|---|
| `block_id` | Platform | The platform's own code for the block, copied as is. | Exact matching: which block the platform says this is. |
| `block_title` | Platform | The heading of the block, in Korean, as the page gives it. | What the page called the block. |
| `block_type` | Zoekplaatje | A category in English that the module assigns with its own rules. | Counting and comparing blocks across queries, pages and engines. |

### block_id

Naver:

- **Blocks with JSON**: Naver's area code of the block (`meta.area` in the JSON), or else the block id in the JSON (`refs.blockId`). It is not the id of the element (`fdr-…`), which is different on every page view.
- **Web result groups** (web documents, blogs and cafes, KnowledgeiN, videos): the area code of the documents. Documents that follow one another with the same area code form one block, unless a group of documents has its own title in the JSON; that group starts a new block.
- **Blocks with HTML only**: the `id` attribute of the element of the block, for example `place-app-root` or `shp_…_root`. **Empty** when the element has no id, which is common for info panels.

Daum:

- **Collections**: the `id` attribute of the collection element, for example `dnsColl` (news) or `poiColl` (places).
- **Parts of a column outside a collection** that have text, for example the sponsor box in the sidebar: the id of the element if it has one, or else a **class name**: the first class of the element, or, for `g_comp…` wrappers, the first class of the first element inside it. For these rows `block_id` is a CSS class, not an id.

These codes are internal to Naver and Daum. The platforms do not document them and can change them. One `block_type` can have several `block_id` values: on Daum, `n0nlColl` and `n0flColl` are both `power-links`; on Naver, web results come with several area codes.

### block_title

Naver:

- **Blocks with JSON**: the title in the header of the block in the JSON. A header can give the title in parts (before, highlighted, after); these are joined with spaces. Without a title in the JSON: the first `h2` or `h3` heading of the block, without the button label "펴고 접기" (unfold/fold) at its end.
- **Web result groups**: the title in the JSON of the first group of documents (`data.state.title`), if it has one. The module does not fall back to a heading on the page for these blocks, so this title can be empty.
- **Blocks with HTML only**: the first `h2` or `h3` heading of the block, without text for screen readers, and without "펴고 접기" at its end.

Daum:

- The `data-title` attribute of the header of the collection (`c-header-collection`). Without it: the first `h2` or `h3` heading, **with** text for screen readers. Daum gives some collections a heading for screen readers only, so `block_title` can be a label that is not visible on the page.

A title is not a stable label for a kind of block. It can include the query, it can change over time, and blocks of different kinds can have the same title. Use `block_type` or `block_id` to group blocks, and `block_title` to see what the page called a block.

### block_type

The module assigns `block_type` with rules that look at what the page says about the block. What it looks at differs by engine.

**Daum**: the collection id (`block_id`), with a fixed table. So on Daum, `block_type` is a translation of `block_id`. The exceptions are the sponsor box and the box with more results, which the module finds by their class names, and `unknown`.

**Naver**, in this order:

1. **Blocks with JSON**: Naver's internal name of the service that made the block (`meta.ssuid` in the JSON), with a table. **If the name is not in the table, `block_type` is Naver's name itself, unchanged.** A `block_type` that is not in the list below is therefore a raw Naver value, not a category of Zoekplaatje.
2. **Web result groups**: `web-results` if the area code starts with `urB_`; else by the kind of documents in the group: `blogs-cafes`, `knowledge-in` or `videos`. A group with more than one kind is `web-results`.
3. **Blocks with HTML only**: the id and the class names of the element (and of the first three elements in it with a class), then the links in the block, then words in its heading. Finance blocks are told apart by their heading. `unknown` if no rule matches.

`block_type` is an interpretation. Two blocks with the same `block_type` are blocks that the module treats as the same kind; that does not mean that the platform calls them the same. A change of the rules in a new version of Zoekplaatje can give the same block another `block_type`.

The values are listed below, under [Block types](#block-types).

## Results file: columns

The columns come in this order: `id`, `timestamp`, `source`, `query`, `type`, `domain`, `title`, `published`, `description`, `link`, `section`, `page_id`, `results_page`, `block_rank`, `block_type`, `block_id`, `block_title`, `item_rank`, `overall_rank`, `is_ad`, `publisher`, `gdid` (Naver) or `doc_id` (Daum), `extra`, and then the `capture_…` columns.

| Column | Source | Description |
|---|---|---|
| `id` | Zoekplaatje | `<page_id>:<block_rank>:<item_rank>`, for example `3:12:4:5:2`. Unique within an export. It is made from positions, so it is not an id of the result: the same web page has another id on another page view. |
| `timestamp` | Zoekplaatje | When Zoekplaatje parsed the response that gave the row, in UTC, as `YYYY-MM-DD HH:MM:SS`. All rows of one response have the same time. Rows from a later request have a later time than the rows of the page. |
| `source` | Platform (URL) | The host of the results page: `search.naver.com` or `search.daum.net`. Also for rows from later requests, which go to other hosts. |
| `query` | Platform (URL) | The search query from the URL of the results page (`query` on Naver, `q` on Daum), decoded. This is the query that was sent. If the engine corrected the query, the correction is not here. |
| `type` | Zoekplaatje | The kind of item, in English. See [Item types](#item-types). The module decides it, sometimes from platform data (for example `blog` or `cafe` from the host of the link). On rows with `item_rank` 0 it is the same as `block_type`. |
| `domain` | Zoekplaatje, from `link` | The host of `link`. For text ads, and on Daum for any item that shows an address: the host of the address that the item shows, because the link of an ad usually goes through the ad server of the platform. Empty for items without a site of their own: AI passages, related queries and searches, keywords, images, and some others. If `link` is a redirect or a page of the platform (Naver products link to Naver Shopping), `domain` is the host of the platform, not that of the final site. |
| `title` | Platform | The title of the item as the page shows it. Made by Zoekplaatje for: sports matches ("<team> vs <team>"), exchange rates (name and code of the currency), Naver discussion posts without a title (the first 80 characters of the post) and the rows of blocks (`item_rank` 0: the heading of the block or the title of the panel). Naver clips have their description as title, and images their alt text. |
| `published` | Platform | The date or time as the page shows it, **not converted**. It can be a date ("2024.06.26.") or relative to the time of capture ("3일 전", 3 days ago; "어제", yesterday). Use `timestamp` to work out relative dates. Naver lounge posts, Naver sports matches and Daum AI summary sources have the value of the data request, which can have another format. Daum web results: only text that looks like a date (other text in that place goes to `source_note` in `extra`). Daum songs, books, people and movies: the line under the description, which may not be a date. |
| `description` | Platform | The snippet or summary of the item. Some are cut: the rows of blocks (`item_rank` 0) have the first 1,000 characters of the text of the block (2,000 for Naver's AI issue briefing); Naver places, hotels and tickets 300; Naver discussion and lounge posts 500; Daum AI summary sources 300. AI passages are the text of the answer between two citations, from Markdown to plain text. Made by Zoekplaatje: travel courses (the stops, joined with →), sports matches (status · score · stadium), exchange rates (rate, direction, change). **Notes in English from Zoekplaatje**, not platform text: "The items of this block load with a separate request." (the row of Naver's related queries block), "The ads of this block load in a frame from Google." (Daum AdSense) and "The page has no data for the answer of this block." (Daum AI summary). |
| `link` | Platform | The URL of the item, made absolute. Images: the URL of the image file. AI passages: the URL of the first source that the passage cites (chosen by Zoekplaatje). Naver lounge posts: made from the id of the post (`https://lounge.naver.com/posts/<id>`). Rows of blocks: the link of the title of the panel, or the first link in the block. Links can be redirects or tracking links of the platform; the module does not follow them. |
| `section` | Zoekplaatje | `main` or `sidebar`: the column of the page with the block (Naver `#main_pack` or `#sub_pack`, Daum `#mArticle` or `#mAside`). |
| `page_id` | Zoekplaatje | The page view, as `<session>:<tab>:<navigation>`. The session counts the starts of the browser, the tab is Firefox's id of the tab, and the navigation counts the pages loaded in that tab. Connects the rows with the pages file. Unique within one installation of Zoekplaatje; exports from other computers, or after a new installation, can have the same ids. |
| `results_page` | Platform (URL) | The number of the results page in the URL (`page` on Naver, `p` on Daum). 1 if the URL has none. |
| `block_rank` | Zoekplaatje | The position of the block on the page, from 1: the main column from top to bottom, then the sidebar, counting on. In the order of the HTML that the server sent, which is normally the order on the screen. Every part of a column with text counts, also parts that the module does not know (`unknown`). |
| `block_type` | Zoekplaatje | See [above](#block_type) and [Block types](#block-types). |
| `block_id` | Platform | See [above](#block_id). |
| `block_title` | Platform | See [above](#block_title). |
| `item_rank` | Zoekplaatje | The position of the item in its block, from 1. 0 is the row of the block itself. In the order of the data (Naver JSON) or the HTML, which normally is the order on the screen. Items that are hidden when the page loads (later pages of a carousel, folded lists) also count. Within one block, kinds of items can follow one another in one count: Naver news (an article, then its related articles), Daum web results (a document, then its related documents), AI blocks (passages, then sources, then images), Daum shopping (keywords, then products, then the prices of stores), Daum places (places, then the trend ranking). Items of a later request count on after the items of the block. |
| `overall_rank` | Zoekplaatje (Naver); Platform plus Zoekplaatje (Daum) | The rank of a web document over the page, for the web results only. Empty for all other rows. **Naver, page 1**: Zoekplaatje counts the rows of all `web-results` blocks in page order. Rows of `blogs-cafes`, `knowledge-in` and `videos` blocks do not count. **Naver, next pages**: the `start` parameter of the URL − 1 + `item_rank`, for all web result groups. **Daum**: Daum's own rank of the document (`r` in the click log of the item), plus 15 for each results page after page 2 (Zoekplaatje assumes 15 documents per page). Not for topic cards (`web-topic`) and related documents. **Both**: results page 2 starts at 1 again, and mostly repeats the web documents of page 1. For Naver's own rank of a document, see `naver_rank` in `extra`. |
| `is_ad` | Platform flag or Zoekplaatje | `yes` if the module found that the item is an ad, else `no`. `no` means that the module found no sign of an ad, not that the item is not paid for. **Naver**: all items of the ads block (파워링크) and of Brand Search; blog and review items that the JSON marks as an ad; travel products that the JSON marks as an ad; products, places, books, hotels and tickets with their own label "광고" or a link through Naver's ad server (`ader.naver.com`). **Daum**: all items of the ad collections (see [Block types](#daum-block-types)); places with their own label "광고". |
| `publisher` | Platform | The name of the source: site, blog, cafe, newspaper, channel, store, author or advertiser, as the page shows it. Naver store names without "공식" (official) at the end. Daum web results: for blogs, cafes and pages on `v.daum.net` and `100.daum.net`, the source line after the host (joined with ›); empty for other web pages (their host is in `domain`). Daum encyclopedia: always "다음백과" (a constant of Zoekplaatje). Daum dictionary: the names of the dictionaries or languages. |
| `gdid` (Naver only) | Platform | Naver's id of the document, from the logging data of the item (`nlogParams.gdid`) or from the JSON of the item. Empty for blocks with HTML only. |
| `doc_id` (Daum only) | Platform | Daum's id of the document, from the click log of the item (`gd`, or else `d`), or the id of an AI summary source (`gsid`, or else `id`). |
| `extra` | Mixed | A JSON object with more fields for some kinds of items. See [Extra fields](#extra-fields). Empty if there are none. Fields without a value are left out. |
| `capture_…` | Capture | See [Capture columns](#capture-columns). |

## Item types

`type` is set by the module. On rows with `item_rank` 0, `type` is the `block_type`.

### Naver item types

| type | Block | What it is | How the module decides |
|---|---|---|---|
| `web` | web result groups | A web document | Kind `web` in the JSON |
| `blog` | web result groups | A blog post | Kind `review` in the JSON, and the host of the link starts with `blog.` |
| `cafe` | web result groups | A Naver Cafe post | Kind `review`, and the host starts with `cafe.` |
| `sponsored-content` | web result groups | A review that the JSON marks as an ad | Kind `review`, not a blog or cafe host, marked as an ad |
| `review` | web result groups | Another review document | Kind `review`, none of the above |
| `knowledge-in` | web result groups | A KnowledgeiN (지식iN) question | Kind `kin` |
| `video` | web result groups | A video | Kind `video` |
| `ai-briefing-passage` | `ai-briefing` | A passage of the AI answer | The answer split at its citations |
| `ai-briefing-source` | `ai-briefing` | A source of the AI answer | Sources list in the JSON |
| `ai-briefing-<kind>` | `ai-briefing` | Media of the AI answer; `<kind>` is Naver's media type (`ai-briefing-media` if there is none) | Multimedia list in the JSON |
| `clip` | `clips` | A clip (short video) | JSON |
| `news` | `news` | A news article | JSON |
| `news-related` | `news` | A related article under an article | JSON |
| `related-question` | `related-questions` | A question with an AI answer | JSON |
| `image` | `images` | An image | JSON |
| `short-form-topic` | `short-form-feed` | A topic of the short-form feed | JSON |
| `ai-pick-creator` | `ai-pick` | A creator that AI Pick recommends | JSON |
| `influencer-post` | `influencers` | A post of an influencer | JSON |
| `travel-product` | `travel` | A travel product | JSON |
| `related-query` | `related-queries` | A related query (함께 많이 찾는) | Separate request |
| `unknown` | a JSON block that the module does not know | Something in the JSON with a title and a link | JSON |
| `ad` | `ads` | A text ad (파워링크) | HTML |
| `brand-link` | `brand-search` | A link in Brand Search (브랜드검색) | HTML |
| `product` | `price-comparison`, `plus-store` | A product | HTML: links to Naver Shopping, Smart Store or Brand Store |
| `place` | `places` | A place | HTML |
| `ticket` | `place-tickets` | A ticket of a place | HTML: links to `booking.naver.com` |
| `book` | `books` | A book | HTML |
| `hotel` | `hotels` | A hotel | HTML: links to `hotels.naver.com` |
| `promotion` | `naver-promotions` | A banner of Naver for its own services | HTML: links to `mkt.naver.com` |
| `discussion-post` | `discussion-posts` | A post of a stock or coin discussion (토론방) | HTML |
| `expert-article` | `expert-content` | Expert content (전문 콘텐츠) | HTML |
| `etf` | `etf-list` | An ETF | HTML |
| `person` | `same-name-people` | A person with the same name | HTML |
| `smart-block-item` | `smart-block` | An item of a smart block | HTML |
| `ranking-item` | `ranking` | An item of a ranking | HTML |
| `asset` | `related-stocks`, `popular-stocks` | A stock or coin | HTML |
| `lounge-post` | `open-talk` | A post of a lounge (라운지) | Separate request |
| `sight` | `travel-destination` | A sight | Separate request |
| `travel-course` | `travel-destination` | A suggested travel course | Separate request |
| `travel-article` | `travel-destination` | A travel article | Separate request |
| `travel-place` | `travel-destination` | A place abroad | Separate request |
| `match` | `sports-schedule` | A match | Separate request |
| `exchange-rate-item` | `exchange-rate` | The rate of one currency at one bank | Separate request, only after a click on a bank tab |

### Daum item types

| type | Block | What it is | How the module decides |
|---|---|---|---|
| `web` | `web-results` | A web document | Card; the host of the link is not a blog or cafe host |
| `blog` | `web-results` | A blog post | Card; the host starts with `blog.` or `brunch.`, or ends with `.tistory.com` |
| `cafe` | `web-results` | A cafe post | Card; the host starts with `cafe.` |
| `web-topic` | `web-results` | A card under a topic heading (for example a place under "제주도 가볼만한 곳"), not one of the ranked documents | The click log of the card has a relation type (`rt`) |
| `web-related` | `web-results` | A related document from the same source, under a document | Links in the cluster of a card |
| `ad` | `power-links`, `premium-links`, `special-links`, `power-content`, `shortcut`, `sponsor-box` | An ad | Block type |
| `shopping-ad` | `power-shopping` | A product ad (파워쇼핑) | Block type |
| `site` | `sites` | A site (사이트) | Block type |
| `news` | `news` | A news article | Block type |
| `video` | `videos` | A video | Block type |
| `short-video` | `videos` | A short video (다음 루프) | In the short videos part of the block |
| `song` | `music` | A song | Block type |
| `book` | `books` | A book | Block type |
| `person` | `related-people` | A related person | Block type |
| `movie` | `movies` | A movie in the movie chart | Block type |
| `image` | `images` | An image | Block type |
| `shopping-keyword` | `shopping`, `shopping-keywords` | A shopping keyword: above the products of `shopping`, or in the ranked list of `shopping-keywords` | Block type and place in the block |
| `product` | `shopping` | A product (쇼핑하우) | Block type |
| `shopping-offer` | `shopping` | A store and its price for one product | In the price comparison part of the block |
| `place` | `places` | A place (장소) | Block type |
| `place-ranking` | `places` | A place in the local trend ranking (맛집 트렌드 랭킹) | In the ranking part of the block |
| `donation` | `donations` | A fundraiser | Block type |
| `dictionary-entry` | `dictionary` | A dictionary entry | Block type |
| `encyclopedia-article` | `encyclopedia` | An article of 다음백과 | Block type |
| `related-search` | `related-searches` | A related search (관련 검색어) | Block type |
| `trend` | `trends` | A trending keyword | Block type |
| `popular-keyword` | `category-keywords`, `theme-keywords` | A popular keyword | Block type |
| `cut-off-collection` | `more-results` | A collection that Daum left off the page, with a link to it (다른결과 더보기) | Block type |
| `ai-summary-passage` | `ai-summary` | A passage of the AI answer (AI 요약): an overview, then sections with a heading | JSON in a script |
| `ai-summary-source` | `ai-summary` | A source of the AI answer | JSON in a script |
| `unknown` | `unknown` | A document in a collection that the module does not know. Cards in such a collection get the web types above. | HTML |

## Block types

### Naver block types

Blocks with JSON, by Naver's service name (`meta.ssuid`):

| block_type | What it is | Naver's service name |
|---|---|---|
| `ai-briefing` | AI Briefing: Naver's AI answer, with its sources | `ex_csa` |
| `clips` | Clips | `clip` |
| `news` | News | `news` |
| `related-questions` | Related questions, with AI answers | `fuq` |
| `images` | Images | `image` |
| `short-form-feed` | Short-form feed | `shortents` |
| `related-queries` | Related queries (함께 많이 찾는) | `qra` |
| `travel` | Travel products | `smartblock_travel` |
| `ai-pick` | AI Pick | `influencer`, with `aipick` in the block id |
| `influencers` | Influencers | `influencer`, other |
| *(any other value)* | Naver's service name, unchanged | A name that is not in this table |

Web result groups, by area code and kind of documents:

| block_type | What it is | When |
|---|---|---|
| `web-results` | Web documents | The area code starts with `urB_`, or the group has only `web` documents, or more than one kind |
| `blogs-cafes` | Blogs, cafes and reviews | Only `review` documents |
| `knowledge-in` | KnowledgeiN (지식iN) | Only `kin` documents |
| `videos` | Videos | Only `video` documents |

Blocks with HTML only. The first rule that matches decides. "Class" means that the class name is in the classes of the block's element or of the first three elements in it with a class; the names are parts, so `cs_stock` also matches `cs_stock_same`, which is why the order matters.

| block_type | What it is | When |
|---|---|---|
| `ads` | Text ads (파워링크) | Class `ad_section` on or in the element |
| `price-comparison` | Naver Shopping price comparison | Element id `shp_…_root` |
| `plus-store` | Naver Plus Store | Element id `shs_…_root` |
| `place-tickets` | Tickets of a place | Element id `place-additional-info-root` |
| `place-detail` | One place with its details, no list of places | Contains `.place_pcnx_detail` |
| `places` | Places (플레이스) | Element id `place-app-root`, or "플레이스" in the heading |
| `books` | Books (네이버 도서) | Class `sp_nbook` on or in the element |
| `naver-promotions` | Banners of Naver for its own services | In the sidebar, with a link to `mkt.naver.com` |
| `brand-search` | Brand Search (브랜드검색): an ad of a brand | Class `brand_search` |
| `ai-issue-briefing` | AI summary of the news about a stock or coin | Class `cs_virtual_asset_aib` |
| `related-stocks` | Related stocks | Class `cs_stock_same`, or a finance block with "함께 찾는" in its heading |
| `popular-stocks` | Popular stocks | Class `cs_stock_top_ranking`, or a finance block with "많이 찾는" in its heading |
| `discussion-posts` | Discussion posts (토론방) | Finance block (class `cs_stock` or `cs_virtual_asset`) with "토론방" in its heading |
| `research` | Research | Finance block with "리서치" in its heading |
| `expert-content` | Expert content | Finance block with "전문 콘텐츠" in its heading |
| `etf-list` | ETFs | Finance block with "ETF" in its heading |
| `crypto-info` | Information about a coin | Other finance block with `cs_virtual_asset` in the start of its HTML |
| `stock-info` | Information about a stock | Other finance block |
| `hotels` | Hotels | Class `nx_hotel` |
| `flight-info` | Flight information | Class `cs_flight_info` |
| `subway-map` | Subway map | Class `cs_pc_subwayline` |
| `sports-schedule` | Sports schedule | Class `cs_sportsdb` |
| `exam-info` | College entrance exam (수능) information | Class `cs_suneung` |
| `lottery` | Lottery | Class `cs_lotto` |
| `spell-checker` | Spell checker | Class `cs_grammar_check` |
| `translator` | Translator | Class `cs_translator` |
| `search-tip` | Search suggestion | Class `cs_recommendation_new` |
| `disambiguation` | Same word, different meanings | Class `cs_same_different` |
| `weather` | Weather | Class `cs_kb_weather` |
| `exchange-rate` | Exchange rates | Class `cs_nexchangerate` |
| `person` | A person (also athletes) | Class `_cs_sports_people` or `_au_people_content_wrap` |
| `same-name-people` | People with the same name | Class `_au_people_content_same_name` |
| `series` | Web originals (series) | Class `cs_weboriginal` |
| `ranking` | A ranking chart | Class `cs_rank_chart` |
| `smart-block` | Smart block | Class `cs_smart_block` or `_athlete_expand` |
| `open-talk` | Open talk and lounge (라운지) | Class `ntalk_wrap` |
| `travel-destination` | A travel destination | Class `nx_ts_do`, or a link to `travel.naver.com/overseas/` or `travel.naver.com/domestic/` |
| `info-panel` | Another info panel | Class `cs_common_module` or `mcs_common_module` |
| `airport-wait-times` | Waiting times at an airport | "출국장" in the heading |
| `unknown` | A block that the module does not know | No rule matches |

Only these block types give a row for each item: the JSON blocks, the web result groups, `ads`, `price-comparison`, `plus-store`, `place-tickets`, `places`, `books`, `naver-promotions`, `brand-search`, `discussion-posts`, `expert-content`, `etf-list`, `hotels`, `same-name-people`, `smart-block`, `ranking`, `related-stocks` and `popular-stocks`, if the module finds items in them. The others give one row for the block (`item_rank` 0). `travel-destination`, `sports-schedule`, `exchange-rate` and `open-talk` then get items from a separate request, if it comes.

### Daum block types

On Daum, `block_type` follows from the collection id (`block_id`). Ad collections have `is_ad` `yes` for all their rows.

| block_type | What it is | block_id | Ad |
|---|---|---|---|
| `web-results` | Web results (통합웹) | `tw?Coll` (one letter for ?) | |
| `power-links` | Power links | `n0nlColl`, `n0flColl` | yes |
| `premium-links` | Premium links | `n0llColl`, `n0klColl` | yes |
| `power-shopping` | Product ads (파워쇼핑) | `n0nsColl` | yes |
| `power-content` | Power content | `n0ncColl` | yes |
| `shortcut` | Shortcut ad (바로가기) | `n0dlColl` | yes |
| `special-links` | Special links | `splinkColl` | yes |
| `adsense` | Google ads, which load in a frame after the page (no items) | `adSenseColl` | yes |
| `news` | News | `dnsColl` | |
| `videos` | Videos and short videos | `voiColl` | |
| `music` | Music | `musicColl` | |
| `books` | Books | `lb2Coll` | |
| `sites` | Sites (사이트) | `ivrColl` | |
| `images` | Images | `imageColl` | |
| `shopping` | Shopping (쇼핑하우) | `shoppingColl` | |
| `places` | Places (장소) | `poiColl` | |
| `donations` | Fundraisers | `tgvColl` | |
| `dictionary` | Dictionary | `ndictionaryColl`, `ndictionaryExactColl` | |
| `encyclopedia` | Encyclopedia (다음백과) | `totArticleColl` | |
| `related-searches` | Related searches (관련 검색어) | starts with `netizenColl` | |
| `trends` | Trending keywords | `rtlColl` | |
| `category-keywords` | Popular keywords of a category | `randomCategoryColl` | |
| `theme-keywords` | Popular keywords of a theme | `ratThemeColl` | |
| `shopping-keywords` | Shopping keywords | `dskColl` | |
| `person` | A person | `prfColl` | |
| `related-people` | Related people | `pr0Coll` | |
| `ai-summary` | AI summary (AI 요약) | `aioColl` | |
| `weather` | Weather | `z8tColl` | |
| `weather-video` | Weather video | `wmdColl` | |
| `exchange-rate` | Exchange rates | `exchangeColl` | |
| `movie` | A movie | `em1Coll` | |
| `tv-program` | A TV program | `tvpColl` | |
| `movies` | Movie chart (다음 영화) | `morColl` | |
| `stock-price` | Stock price | `comColl`, `nasColl` | |
| `related-stocks` | Related stocks | `comRightColl` | |
| `world-markets` | World markets | `worldStockRightColl` | |
| `crypto-price` | Coin price | `jupCurrencyColl` | |
| `spell-checker` | Spell checker | `jupSpellCheckerColl` | |
| `lottery` | Lottery | `lottoColl` | |
| `subway-station` | Subway station | `subwaystationColl` | |
| `subway-map` | Subway map | `subwayColl` | |
| `sports-league` | Sports league | `abtColl` | |
| `other-leagues` | Other leagues | `sportsWingColl` | |
| `category-search` | Category search | `tcsColl` | |
| `info-panel` | Another info panel (for example 단풍시기, the 수능 countdown) | other `jup…Coll` | |
| `sponsor-box` | Sponsor box (스폰서박스) in the sidebar | not a collection; class `content_sponsor` | yes |
| `more-results` | Collections that Daum left off the page (다른결과 더보기) | not a collection; class `wrap_cutoff` | |
| `unknown` | A block that the module does not know | any other | |

These block types give one row for the block (`item_rank` 0): `adsense`, `encyclopedia`, `person`, `weather`, `weather-video`, `exchange-rate`, `movie`, `tv-program`, the finance, lottery, subway and sports blocks, `spell-checker`, `category-search`, `info-panel`, and `ai-summary` when the page has no data for its answer. Their `extra` can have the `details` and `facts` of the panel. A click on a sort option or page button of `places` adds rows to that block.

## Extra fields

`extra` is a JSON object. The fields depend on `type`. Prices keep the "원" of the page. "Count" means that Zoekplaatje counted the elements of a list in the platform data.

### Naver extra fields

| type | Field | Source | Meaning |
|---|---|---|---|
| `web`, `blog`, `cafe`, `review`, `sponsored-content`, `knowledge-in`, `video` | `naver_rank` | Platform | Naver's rank of the document in its logging data (`cr_rank_legacy`) |
| `web` | `ai_generated_snippet` | Platform | `true` if Naver marks the snippet as made by AI |
| `web` | `sublinks` | Zoekplaatje (count) | Number of sublinks under the result |
| `blog`, `cafe`, `review`, `sponsored-content` | `official` | Platform | `true` if the source is marked as official |
| | `images` | Zoekplaatje (count) | Number of images |
| | `replies` | Zoekplaatje (count) | Number of replies shown |
| `knowledge-in` | `answer` | Platform | The text of the answer |
| | `answer_badge` | Platform | The badge of the answer |
| `video` | `platform` | Platform | The video platform or category of the profile |
| | `duration_seconds` | Platform | Length of the video (Naver's `playDuration`; the unit is assumed to be seconds) |
| `news` | `naver_news` | Platform | The link on the first line under the name of the newspaper (in the code: the article on Naver News) |
| `ai-briefing-passage` | `source_indexes` | Platform | The numbers of the sources that the passage cites |
| | `source_urls` | Platform | The URLs of those sources |
| | `disclaimer` | Platform | The disclaimer of the answer (first row of the block only) |
| `ai-briefing-source` | `footnote_index`, `order` | Platform | The number of the source in the answer, and its place in the list |
| | `official` | Platform | `true` if the source is marked as official |
| `ai-briefing-<kind>` | `thumbnail` | Platform | URL of the thumbnail |
| `clip` | `views` | Platform | The number of views as the page shows it (text) |
| | `certified` | Platform | `true` if the source is certified |
| `related-question` | `answer_source_urls` | Platform | The URLs of the sources of the answer |
| | `ai_generated` | Zoekplaatje | Always `true`: the module sets it for every row of this type |
| `short-form-topic` | `category` | Platform | Category of the topic |
| | `ai_generated_topic` | Zoekplaatje | Always `true`: the module sets it for every row of this type |
| `ai-pick-creator` | `citations` | Platform | Number of citations of the creator |
| `travel-product` | `price`, `duration`, `status`, `badge` | Platform | Price, length of the trip, status badge, badge on the image |
| `ad` | `shown_url` | Platform | The address that the ad shows |
| `product` | `price` | Platform, parsed | The price after a discount; or else the lowest price; or else the first amount that is not a list price, shipping fee or points |
| | `list_price` | Platform, parsed | The price before a discount (할인 전 판매가) |
| | `rating`, `reviews` | Platform, parsed | From "4.5 (1,234)" |
| | `sellers` | Platform, parsed | Number of stores (판매처) |
| `place` | `category` | Platform | Category of the place (the last part of its name link) |
| | `status` | Platform, parsed | Opening status, for example "영업 중" |
| | `rating` | Platform, parsed | Rating (별점) |
| | `reviews` | Platform, parsed | Number of reviews; "1.3만" becomes 13000 |
| | `phone` | Platform, parsed | Phone number |
| | `distance_from_current_location` | Platform, parsed | From "현재 위치에서 …", for "near me" queries |
| `book` | `author`, `price` | Platform, parsed | Author and price |
| | `store`, `sellers` | Platform, parsed | The name of the store, or the number of stores if there is more than one |
| `hotel`, `ticket` | `price` | Platform, parsed | A price range ("40,900~73,900원") or one price |
| `person`, `smart-block-item`, `ranking-item`, `asset` | `change` | Zoekplaatje | `up` or `down`, from the class of the item |
| `discussion-post` | `likes`, `comments` | Platform, parsed | Counts shown on the post |
| `expert-article` | `new` | Platform | `true` if the article has a "NEW" badge |
| `etf` | `code` or `full_name` | Platform | The code of a Korean fund, or the full name of a foreign one |
| | `weight`, `price`, `change`, `change_percent` | Platform, parsed | As shown |
| | `direction` | Zoekplaatje | `up` or `down`, from the class or the screen reader label |
| `ai-issue-briefing` (block row) | `ai_generated` | Zoekplaatje | Always `true` |
| | `source_urls` | Platform | The links in the block, without links to Naver Keep and Naver stock pages |
| `related-query` | `badge` | Platform | Badge of the query |
| `lounge-post` | `channel`, `pinned`, `on_air` | Platform | The lounge channel; pinned post; live post |
| | `comments` | Zoekplaatje (count) | Number of comments in the response |
| `sight` | `tags` | Platform | Tags |
| `travel-course` | `days`, `distance`, `duration`, `tags` | Platform | Days, total distance, total time, tags |
| | `stops` | Zoekplaatje (count) | Number of stops |
| `travel-article` | `category`, `source` | Platform | Kind of article, and where it is from |
| `travel-place` | `name_en`, `category`, `subcategory`, `rating`, `reviews`, `saves`, `geo_code` | Platform | English name, categories, average rating, number of reviews, number of saves, Naver's geo code |
| `match` | `status`, `home`, `away`, `score`, `winner`, `league`, `cancelled` | Platform | As in the schedule data; `score` only for matches that started or ended |
| | `list` | Zoekplaatje | `by date`, or `round <n>`: which schedule the match came from |
| `exchange-rate-item` | `rate`, `change`, `change_percent`, `direction` | Platform | As shown |
| | `bank` | Platform (URL) | The bank, from the request |
| | `trigger` | Zoekplaatje | Always `click`: these rows only come after a click on a bank tab |

### Daum extra fields

| type | Field | Source | Meaning |
|---|---|---|---|
| `web`, `blog`, `cafe`, `web-topic` | `daum_rank` | Platform | Daum's rank of the document (`r` in the click log) |
| | `collection` | Platform | Daum's code of the collection of the document (`dc` in the click log) |
| | `relation` | Platform | Relation type (`rt` in the click log); only on `web-topic` |
| | `source_line` | Platform | The source line of the card (host, then blog, cafe or channel, or parts of the path), joined with › |
| | `source_note` | Platform | The text under the card if it is not a date |
| `web-related` | `related_to` | Platform | The `doc_id` of the document above it |
| `ad` (text ads) | `shown_url` | Platform | The address that the ad shows |
| | `sublinks` | Zoekplaatje (count) | Number of other addresses that the ad links to |
| `ad` (shortcut), `site` | `shown_url`, `badges`, `buttons` | Platform | Address, badges, labels of the buttons (channel, phone) |
| | `phone` | Platform, parsed | Phone number |
| | `daum_rank` | Platform | `r` in the click log |
| `news`, `video`, `short-video`, `donation` | `shown_url` | Platform | The address shown, if any |
| `video`, `short-video` | `platform`, `duration` | Platform | Video platform; length as shown |
| `donation` | `status`, `raised` | Platform | Status of the fundraiser; amount raised |
| `song`, `book`, `person`, `movie`, `unknown` | `details` | Platform | Terms and values, for example {"저자": "…", "출간": "2024.6.26."} |
| | `list` | Platform | The list of the item, for blocks with more than one list (for example 실시간 예매율) |
| | `chart_rank` | Platform | The number on the badge of a chart item |
| | `daum_rank` | Platform | `r` in the click log (only without a chart rank) |
| `product` | `price`, `shipping`, `rating` | Platform | As shown |
| | `lowest_price` | Platform | `true` if marked as the lowest price (최저가) |
| | `reviews`, `sellers` | Platform, parsed | Number of reviews; number of stores (판매처) |
| | `tags` | Platform | Tags |
| `shopping-offer` | `price` | Platform, parsed | The price of the store |
| `shopping-ad` | `price`, `shipping`, `promotion` | Platform | As shown |
| | `hidden_at_load` | Platform | `true` if hidden in the carousel when the page loaded |
| `place` | `category`, `marker` | Platform | Category; the label of the place's marker |
| | `rating` | Platform | Rating |
| | `ratings`, `reviews`, `status`, `phone` | Platform, parsed | Number of ratings; number of reviews (text, can end with "+"); opening status; phone number |
| | `homepage` | Platform | Link of the homepage |
| | `trigger`, `sort`, `list_page` | Zoekplaatje; Platform (URL) | Only for places that loaded after a click on a sort option or page button: `click`, the sort order and page from the request |
| `place-ranking` | `rank`, `rating`, `ratings`, `category` | Platform, parsed | Position in the ranking, rating, number of ratings, category |
| `dictionary-entry` | `pronunciation` | Platform | Pronunciation |
| `related-search` | `daum_rank` | Platform | `r` in the click log |
| `trend`, `popular-keyword`, `shopping-keyword` | `rank` | Platform | The number shown |
| | `tab` | Platform | The tab of the list, if the block has more than one |
| | `change` | Platform | Change in the ranking, with screen reader labels |
| | `kind` | Platform | `data-type` of the link |
| `cut-off-collection` | `collection` | Platform | Daum's code of the collection that was left off |
| `ai-summary-passage` | `ui` | Platform | The form of the passage, if not plain text |
| | `source_urls`, `source_names` | Platform | The sources that the passage cites |
| | `ai_generated` | Zoekplaatje | Always `true` |
| | `topic`, `question_type`, `disclaimer`, `stale` | Platform | First row of the block only: Daum's topic and question type of the query, the disclaimer, and the stale flag of the answer |
| `ai-summary-source` | `kind` | Platform | The kind of the source (`collector`) |
| block rows, `encyclopedia-article` | `details` | Platform | Terms and values of the panel, for example birth date or genre |
| | `facts` | Platform | A strip of facts, for example {"현지시간": "8시간 느림"} |

## Pages file

One row for each page view with captured rows. `page_id` connects it with the results file. Most columns are the same for all modules:

| Column | Source | Description |
|---|---|---|
| `page_id` | Zoekplaatje | See the results file |
| `engine` | Zoekplaatje | `Naver` or `Daum` |
| `query`, `results_page` | Platform (URL) | As in the results file |
| `url` | Capture | The URL of the tab |
| `captured_at`, `last_captured_at` | Zoekplaatje | First and last capture of the page, UTC. The last capture is later than the first if later requests added rows. |
| `rows` | Zoekplaatje | Number of rows of the page, also from later requests |
| `blocks` | Zoekplaatje | Number of blocks that the module found in the HTML of the page |
| `problems` | Zoekplaatje | Errors of the module while it parsed the page |
| `screenshot_files`, `screenshot_status`, `archive_files` | Zoekplaatje | Saved files and the status of each screenshot |

Fields that the modules add:

| Column | Module | Source | Description |
|---|---|---|---|
| `places_sort` | Naver | Platform (URL) | Sort order of the places block (`sortingOrder` in its place links) |
| `places_radius_km` | Naver | Platform (URL) | Radius of the places block in km (`radius` in its place links) |
| `places_from_user_location` | Naver | Zoekplaatje | `yes` if the places block gives distances from the user's location ("현재 위치에서"). The page does not say which location Naver used; outside Korea it is central Seoul. |
| `places_area` | Daum | Platform | The area that the places block searched, as shown, for example "서울 강남구 강남역 주변 맛집" |

## Capture columns

These columns are in both files. They describe the browser at the time of capture, not the search engine.

| Column | Description |
|---|---|
| `capture_zoekplaatje_version` | Version of Zoekplaatje |
| `capture_user_agent` | User agent of the browser |
| `capture_accept_language` | Languages that Firefox asked for in the request of the page |
| `capture_languages` | Languages of the browser |
| `capture_time_zone`, `capture_utc_offset` | Time zone of the computer |
| `capture_window_width`, `capture_window_height` | Size of the window, in CSS pixels, measured when the page had loaded |
| `capture_page_width`, `capture_page_height` | Size of the whole page, in CSS pixels |
| `capture_device_pixel_ratio`, `capture_screen_width`, `capture_screen_height` | Screen |
| `capture_ip_country`, `capture_ip_datacenter`, `capture_ip` | Country and Cloudflare data center of the connection, and the IP address (only with these settings on; the answer is used for 10 minutes). `capture_ip_country` is "lookup failed" if Cloudflare did not answer. |
| `capture_privacy_…` | Privacy settings of Firefox (only with this setting on) |
| `capture_extensions` | Other add-ons (only with this setting on) |

The window and page sizes are missing if the tab went to another page before Zoekplaatje measured them.
