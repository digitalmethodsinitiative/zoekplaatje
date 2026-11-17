// Load Zoekplaatje scripts into a sandbox that looks like the extension
// background page, read saved results pages, and write rows as CSV.
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import {fileURLToPath} from 'node:url';
import {DOMParser, parseHTML} from 'linkedom';

export const TESTS = path.dirname(fileURLToPath(import.meta.url));
export const REPO = path.resolve(TESTS, '..');
// saved pages contain third-party content and are not in git
export const FIXTURES = process.env.ZOEKPLAATJE_FIXTURES
    ? path.resolve(REPO, process.env.ZOEKPLAATJE_FIXTURES)
    : path.join(TESTS, 'fixtures');

const {HTMLElement, Node} = parseHTML('<!DOCTYPE html><html></html>');

export function make_context(extra = {}) {
    const context = {
        console, URL, URLSearchParams, TextDecoder, TextEncoder, setTimeout, clearTimeout,
        // the background page polls the toolbar icon state; tests do not need it
        setInterval: () => 0,
        DOMParser, HTMLElement, Node,
        ...extra
    };
    context.window = context;
    context.self = context;
    return vm.createContext(context);
}

export function load(context, file) {
    const full = path.isAbsolute(file) ? file : path.join(REPO, file);
    vm.runInContext(fs.readFileSync(full, 'utf8'), context, {filename: full});
}

/**
 * Sandbox with the libraries that the background page loads before the
 * modules, and a stub for zoekplaatje.register_module()
 */
export function module_context() {
    const context = make_context();
    context.zoekplaatje = {
        modules: {},
        register_module(name, domain, callback) {
            this.modules[domain] = {name, domain, callback};
        }
    };
    for (const file of ['inc/moment.js', 'inc/he.js', 'inc/lib.js']) {
        load(context, file);
    }
    return context;
}

/**
 * A saved results page: the HTML that the server sent, and the data requests
 * that the page made afterwards (from SERP Sampler)
 */
export function read_fixture(fixture) {
    const dir = path.join(FIXTURES, fixture);
    const read = name => fs.readFileSync(path.join(dir, name), 'utf8');
    const meta = JSON.parse(read('meta.json'));
    const events = fs.existsSync(path.join(dir, 'events.json')) ? JSON.parse(read('events.json')) : null;
    const xhr = ((events && events.xhr) || meta.xhr || [])
        .filter(request => fs.existsSync(path.join(dir, request.file)))
        .map(request => ({url: request.url, body: read(request.file)}));
    return {
        meta: meta,
        page_url: meta.final_url || meta.url,
        main: {url: meta.url, body: read('raw.html')},
        xhr: xhr
    };
}

export function csv_value(value) {
    let text = value === undefined || value === null ? '' : String(value);
    if (/[",\r\n]/.test(text)) {
        text = '"' + text.replace(/"/g, '""') + '"';
    }
    return text;
}

/**
 * Rows as CSV, with a header made of every key in every row
 */
export function to_csv(rows) {
    const header = [...new Set(rows.flatMap(row => Object.keys(row)))];
    const lines = [header.map(csv_value).join(',')];
    for (const row of rows) {
        lines.push(header.map(key => csv_value(row[key])).join(','));
    }
    return '\ufeff' + lines.join('\r\n') + '\r\n';
}
