# Tests for Zoekplaatje modules

`run-module.mjs` runs a module on saved results pages, outside the browser. It calls the module in the same way as `js/background.js`: with the HTML of the results page first, then with each data request that the page made. It keeps every row, as `background.js` does, and reports ids that come more than once on a page: a module must not return the same item twice.

For each page, it writes the rows as a CSV file to `tests/out/<module>/`. Then it compares the rows with the expected rows in `tests/expected/<module>/`. The `timestamp` field is not compared, because the export makes it. In ids that start with the parse time (older modules), the time is not compared.

## Saved pages

Saved pages contain the content of search engines, so they are not in git. Make them with SERP Sampler, which saves each results page with the data requests that the page made, a screenshot and `meta.json`.

Put the pages in `tests/fixtures/`, or set the environment variable `ZOEKPLAATJE_FIXTURES` to another folder. The folder has an `index.json` with one entry for each page:

```json
[{"engine": "naver", "fixture": "naver/손흥민_p1", "query": "손흥민", "results_page": 1, "url": "https://search.naver.com/..."}]
```

Each page folder has `raw.html` (the HTML that the server sent), `meta.json`, and the data requests (`xhr-*`). `events.json` (from SERP Sampler 0.2) lists all data requests.

## Run the tests

You need Node.js 20 or newer. Install the packages once:

```bash
cd tests
npm install
```

Run a module:

```bash
node run-module.mjs modules/naver.js
```

The first run reports each page as `NEW`. If the rows are correct, store them as the expected rows:

```bash
node run-module.mjs modules/naver.js --update
```

After that, a run reports `PASS` if the rows did not change, and `FAIL` with the first changed row if they did. To run one page, add `--only naver/손흥민_p1`.

Without Node.js on your computer, use Docker. From the root of the repository:

```bash
docker run --rm -v "$PWD:/repo" -w /repo/tests node:22 node run-module.mjs modules/naver.js
```
