// Run a Zoekplaatje module on saved results pages, the way the background page
// calls it, and compare the rows with stored expected rows.
//
//   node run-module.mjs <module file> [--only <fixture>] [--update]
//
// The module file is relative to the repository, for example modules/naver.js.
// Without --update, a page without expected rows is reported as NEW.
import fs from 'node:fs';
import path from 'node:path';
import {TESTS, FIXTURES, module_context, load, read_fixture, to_csv} from './lib.mjs';

const args = process.argv.slice(2);
const module_file = args[0];
const option = name => {
    const i = args.indexOf('--' + name);
    return i >= 0 ? args[i + 1] : null;
};
const update = args.includes('--update');
if (!module_file) {
    console.error('usage: node run-module.mjs <module file> [--only <fixture>] [--update]');
    process.exit(2);
}

const context = module_context();
load(context, module_file);
const modules = Object.values(context.zoekplaatje.modules);
if (modules.length !== 1) {
    console.error(`expected one registered module in ${module_file}, found ${modules.length}`);
    process.exit(2);
}
const module = modules[0];
const engine = module.domain.split('.')[0];
const name = path.basename(module_file, '.js');
const out_dir = path.join(TESTS, 'out', name);
const expected_dir = path.join(TESTS, 'expected', name);

const index_file = path.join(FIXTURES, 'index.json');
if (!fs.existsSync(index_file)) {
    console.error(`no saved pages: ${index_file} does not exist (see tests/README.md)`);
    process.exit(2);
}
const fixtures = JSON.parse(fs.readFileSync(index_file, 'utf8'))
    .filter(entry => entry.engine === engine)
    .filter(entry => !option('only') || entry.fixture === option('only'));

// the export makes the timestamp; ids of older modules start with the parse time
const normalise = rows => rows.map(row => {
    const copy = {...row};
    delete copy.timestamp;
    if (typeof copy.id === 'string') {
        copy.id = copy.id.replace(/^\d{13}(?=-)/, '<time>');
    }
    return copy;
});
const counts = {PASS: 0, FAIL: 0, NEW: 0, ERROR: 0};

for (const entry of fixtures) {
    const fixture = read_fixture(entry.fixture);
    const nav_index = `test:${entry.fixture}:0`;
    const rows = [];
    const seen = new Set();
    let duplicates = 0;
    const errors = [];
    for (const response of [fixture.main, ...fixture.xhr]) {
        try {
            for (const item of module.callback(response.body, fixture.page_url, response.url, nav_index) || []) {
                // background.js stores every item, also one with an id that it has stored
                // for the page before, so the same id twice means the same row twice
                if (!item) {
                    continue;
                }
                duplicates += seen.has(item.id) ? 1 : 0;
                seen.add(item.id);
                rows.push(item);
            }
        } catch (error) {
            errors.push(`${response.url.split('?')[0]}: ${error.stack.split('\n').slice(0, 2).join(' / ')}`);
        }
    }

    const csv_file = path.join(out_dir, entry.fixture + '.csv');
    fs.mkdirSync(path.dirname(csv_file), {recursive: true});
    fs.writeFileSync(csv_file, to_csv(rows));

    const blocks = new Set(rows.map(row => row.block_rank).filter(rank => rank !== undefined));
    const unknown = new Set(rows.filter(row => row.block_type === 'unknown').map(row => row.block_rank));
    const expected_file = path.join(expected_dir, entry.fixture + '.json');
    const actual = normalise(rows);

    let status;
    let detail = duplicates ? `${duplicates} duplicate ids` : '';
    if (errors.length) {
        status = 'ERROR';
        detail = errors.join(' | ');
    } else if (update) {
        fs.mkdirSync(path.dirname(expected_file), {recursive: true});
        fs.writeFileSync(expected_file, JSON.stringify(actual, null, 1));
        status = 'PASS';
    } else if (!fs.existsSync(expected_file)) {
        status = 'NEW';
    } else {
        const expected = JSON.parse(fs.readFileSync(expected_file, 'utf8'));
        if (JSON.stringify(expected) === JSON.stringify(actual)) {
            status = 'PASS';
        } else {
            status = 'FAIL';
            const i = actual.findIndex((row, n) => JSON.stringify(row) !== JSON.stringify(expected[n]));
            detail = i < 0
                ? `expected ${expected.length} rows, got ${actual.length}`
                : `row ${i}: expected ${JSON.stringify(expected[i])} got ${JSON.stringify(actual[i])}`.slice(0, 300);
        }
    }
    counts[status]++;
    console.log(`${status.padEnd(5)} ${entry.fixture.padEnd(34)} rows=${String(rows.length).padEnd(4)} blocks=${String(blocks.size || '-').padEnd(3)} unknown=${unknown.size} ${detail}`);
}

console.log(`\n${name}: ${Object.entries(counts).map(([k, v]) => `${k} ${v}`).join(', ')}. CSV files in ${path.relative(TESTS, out_dir)}`);
process.exit(counts.FAIL || counts.ERROR ? 1 : 0);
