/**
 * Files of a page: screenshots and the archive
 *
 * Files go to a folder for each page view in the downloads folder of Firefox:
 * zoekplaatje-archives/<engine>/<time>_<page id>_<query>/. The time (UTC, of
 * the first capture) keeps folders apart when a page id comes again, e.g.
 * after a new install. Each file name starts with a number in the order of
 * saving (001-page.html, 002-data_..., 003-screenshot.png). The page record (see
 * pages.js) lists the files: 'screenshots' (file, size, trigger, status) and
 * 'archive_files'.
 *
 * Screenshots (setting, off by default): after a page with captured items has
 * loaded, Zoekplaatje waits a few seconds (some engines draw blocks after the
 * load), optionally scrolls through the page so that lazy images load, and
 * captures the full page. The tab must be visible for that, so a screenshot of
 * a tab in the background waits until the tab is shown. A screenshot can also
 * be taken by hand, with the toolbar popup or the keyboard shortcut.
 *
 * Archive (setting, off by default): the HTML of the page as the server sent
 * it, and the data responses from which modules captured items. The saved page
 * does not load these files: its scripts still ask the engine for live data.
 */
window.zoekplaatje.files = {
    SETTLE_MS: 2500,
    STEP_WAIT_MS: 250,
    // Firefox draws images up to 32767 pixels high
    MAX_SIZE: 30000,
    // object URLs of downloads in progress, by download id
    downloads: {},
    // pages whose automatic screenshot waits until their tab is visible, by tab id
    waiting: {},
    // pages that are being captured now
    busy: new Set(),

    settings: async function () {
        const stored = await browser.storage.local.get(['zs-setting-screenshots', 'zs-setting-screenshot-format', 'zs-setting-archive']);
        return {
            screenshots: stored['zs-setting-screenshots'] || 'off',
            format: stored['zs-setting-screenshot-format'] === 'jpeg' ? 'jpeg' : 'png',
            archive: !!parseInt(stored['zs-setting-archive'])
        };
    },

    /**
     * A file or folder name without characters that file systems do not allow
     */
    safe_name: function (text, max = 60) {
        return String(text || '').replace(/[\\/:*?"<>|\x00-\x1f]+/g, '_').replace(/\s+/g, ' ').trim()
            .replace(/^[.\s]+|[.\s]+$/g, '').slice(0, max) || 'page';
    },

    /**
     * Whether a tab still shows the page of a record (a #fragment, e.g. from an in-page link, is the same page)
     */
    same_page: function (tab_url, page_url) {
        const strip = url => String(url || '').split('#')[0];
        return strip(tab_url) === strip(page_url);
    },

    folder: function (record) {
        // the time as in the names of the export files, e.g. 2026-11-06T101530
        const time = new Date(record.captured_at).toISOString().split('.')[0].replace(/:/g, '');
        return 'zoekplaatje-archives/' + this.safe_name(record.source_platform) + '/' + time + '_'
            + this.safe_name(record.nav_index.replace(/:/g, '-'), 30) + '_' + this.safe_name(record.query, 50);
    },

    /**
     * The number of the next file of a page (001, 002, ...), in the order of saving
     *
     * Must run as a task of the page record (pages.run), so that two files
     * never get the same number.
     *
     * @param nav_index  Navigation index of the page
     * @returns {Promise<string>}
     */
    next_number: async function (nav_index) {
        const record = await db.pages.get(nav_index);
        const number = ((record && record.file_count) || 0) + 1;
        await db.pages.update(nav_index, {file_count: number});
        return String(number).padStart(3, '0');
    },

    /**
     * Save a file in the downloads folder
     *
     * @param path  Path in the downloads folder
     * @param blob  Content
     * @returns {Promise<string>}  The path as saved (Firefox adds a number if the file exists)
     */
    save: async function (path, blob) {
        const url = URL.createObjectURL(blob);
        try {
            const id = await browser.downloads.download({url: url, filename: path, saveAs: false, conflictAction: 'uniquify'});
            this.downloads[id] = url;
            const [download] = await browser.downloads.search({id: id});
            return download && download.filename ? path.split('/').slice(0, -1).concat([download.filename.split(/[\\/]/).pop()]).join('/') : path;
        } catch (error) {
            URL.revokeObjectURL(url);
            throw error;
        }
    },

    /**
     * A finished download: free its object URL, and take it off the downloads
     * list of Firefox (the file stays), so that the list stays short
     */
    download_changed: function (delta) {
        if (!(delta.id in this.downloads) || !delta.state || delta.state.current === 'in_progress') {
            return;
        }
        URL.revokeObjectURL(this.downloads[delta.id]);
        delete this.downloads[delta.id];
        browser.downloads.erase({id: delta.id});
    },

    /**
     * Save a response from which a module captured items, if the archive is on
     *
     * Called by pages.record(), as a task of the page record. The response of
     * the page itself is NNN-page.html; data responses are NNN-data_<host>_<name>.
     *
     * @param record  Page record
     * @param response  Content of the response
     * @param source_url  URL of the response
     * @returns {Promise}
     */
    archive: async function (record, response, source_url) {
        if (!(await this.settings()).archive) {
            return;
        }
        const files = record.archive_files || [];
        let name;
        if (source_url === record.url && !files.some(file => /\/\d+-page\.html$/.test(file))) {
            name = 'page.html';
        } else {
            const url = new URL(source_url);
            const start = response.trimStart().charAt(0);
            const extension = '{['.includes(start) ? 'json' : start === '<' ? 'html' : 'txt';
            name = 'data_' + this.safe_name(url.hostname, 30) + '_'
                + this.safe_name(url.pathname.split('/').filter(part => part).pop() || 'root', 30) + '.' + extension;
        }
        try {
            name = await this.next_number(record.nav_index) + '-' + name;
            const saved = await this.save(this.folder(record) + '/' + name, new Blob([response], {type: 'text/plain'}));
            await db.pages.update(record.nav_index, {archive_files: files.concat([saved])});
        } catch (error) {
            await db.pages.update(record.nav_index, {problems: (record.problems || []).concat(['archive: ' + error])});
        }
    },

    /**
     * The automatic screenshot of a page, if the setting is on
     *
     * Called when a page with a record has loaded. One automatic screenshot
     * for each page view.
     *
     * @param nav_index  Navigation index of the page
     * @param tab_id  Tab of the page
     */
    automatic: async function (nav_index, tab_id) {
        const settings = await this.settings();
        const record = await db.pages.get(nav_index);
        if (settings.screenshots === 'off' || !record || this.busy.has(nav_index)
            || (record.screenshots || []).some(shot => shot.trigger === 'automatic')) {
            return;
        }
        const tab = await browser.tabs.get(tab_id).catch(() => null);
        if (!tab || !this.same_page(tab.url, record.url)) {
            return;
        }
        if (!tab.active) {
            // a tab in the background is not drawn; wait until it is shown
            this.waiting[tab_id] = nav_index;
            return;
        }
        await this.take(nav_index, tab_id, 'automatic', settings);
    },

    /**
     * A tab is shown: take the screenshot that waited for it
     */
    tab_shown: function (info) {
        const nav_index = this.waiting[info.tabId];
        if (nav_index) {
            delete this.waiting[info.tabId];
            this.automatic(nav_index, info.tabId);
        }
    },

    /**
     * A screenshot by hand (toolbar popup, keyboard shortcut), of the page in a tab
     *
     * @param tab_id  Tab of the page
     * @returns {Promise<Object|null>}  The screenshot entry of the page record, or null without a record
     */
    by_hand: async function (tab_id) {
        const nav_index = zoekplaatje.pages.current(tab_id);
        if (!await db.pages.get(nav_index)) {
            return null;
        }
        const settings = await this.settings();
        // by hand, the page has loaded already: no wait, and scrolling unless the setting says not to
        return this.take(nav_index, tab_id, 'by hand', Object.assign(settings, {screenshots: settings.screenshots === 'no-scroll' ? 'no-scroll' : 'scroll'}));
    },

    /**
     * Take a full-page screenshot and save it with the page
     *
     * @param nav_index  Navigation index of the page
     * @param tab_id  Tab of the page
     * @param trigger  'automatic' or 'by hand'
     * @param settings  Screenshot settings
     * @returns {Promise<Object>}  The screenshot entry of the page record
     */
    take: async function (nav_index, tab_id, trigger, settings) {
        this.busy.add(nav_index);
        const entry = {trigger: trigger, at: Date.now()};
        try {
            const record = await db.pages.get(nav_index);
            const run = code => browser.tabs.executeScript(tab_id, {code: code}).then(results => results[0]);
            const still_there = async () => this.same_page((await browser.tabs.get(tab_id).catch(() => ({}))).url, record.url);
            if (trigger === 'automatic') {
                await new Promise(resolve => setTimeout(resolve, this.SETTLE_MS));
            }
            if (!await still_there()) {
                throw new Error('the tab showed another page');
            }
            const start = await run('({x: scrollX, y: scrollY})');
            if (settings.screenshots === 'scroll') {
                // scroll down in steps so that lazy images load, then back to where the user was
                for (let y = 0; ; y += 600) {
                    const height = await run(`window.scrollTo(0, ${y}); document.documentElement.scrollHeight`);
                    if (y >= Math.min(height, this.MAX_SIZE) || !await still_there()) {
                        break;
                    }
                    await new Promise(resolve => setTimeout(resolve, this.STEP_WAIT_MS));
                }
                await run(`window.scrollTo(${start.x}, ${start.y})`);
                await new Promise(resolve => setTimeout(resolve, 500));
            }
            const page = await run('({width: document.documentElement.scrollWidth, height: document.documentElement.scrollHeight, ratio: devicePixelRatio})');
            const width = Math.min(page.width, this.MAX_SIZE);
            const height = Math.min(page.height, this.MAX_SIZE);
            // as sharp as the screen, within the size limit
            const scale = Math.min(page.ratio || 1, this.MAX_SIZE / Math.max(width, height));
            const data_url = await browser.tabs.captureTab(tab_id, {
                format: settings.format, quality: 90, scale: scale, rect: {x: 0, y: 0, width: width, height: height}
            });
            const blob = await (await fetch(data_url)).blob();
            const extension = settings.format === 'jpeg' ? 'jpg' : 'png';
            const number = await zoekplaatje.pages.run(nav_index, () => this.next_number(nav_index));
            if (!number) {
                throw new Error('no file number');
            }
            entry.file = await this.save(this.folder(record) + '/' + number + '-screenshot.' + extension, blob);
            entry.width = Math.round(width * scale);
            entry.height = Math.round(height * scale);
            entry.status = height < page.height ? 'cut at ' + this.MAX_SIZE + ' px of ' + page.height : 'saved';
        } catch (error) {
            entry.status = 'failed: ' + (error && error.message ? error.message : error);
        } finally {
            this.busy.delete(nav_index);
        }
        await zoekplaatje.pages.run(nav_index, async () => {
            const record = await db.pages.get(nav_index);
            if (record) {
                await db.pages.update(nav_index, {screenshots: (record.screenshots || []).concat([entry])});
            }
        });
        return entry;
    }
};

browser.downloads.onChanged.addListener(delta => zoekplaatje.files.download_changed(delta));
browser.tabs.onActivated.addListener(info => zoekplaatje.files.tab_shown(info));
browser.commands.onCommand.addListener(async command => {
    if (command === 'take-screenshot') {
        const [tab] = await browser.tabs.query({active: true, currentWindow: true});
        if (tab) {
            zoekplaatje.files.by_hand(tab.id);
        }
    }
});
