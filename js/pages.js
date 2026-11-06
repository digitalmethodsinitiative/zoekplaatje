/**
 * Page records
 *
 * One record for each page view on which a module captured items, in the
 * 'pages' table, with the navigation index (nav_index) as key; items store the
 * same nav_index. A record holds what the page was (engine, URL, query, results
 * page), what was captured (rows, blocks, problems) and the run details: how
 * the browser was set up when it loaded the page (languages, time zone, window
 * size, and optionally the privacy settings, the country of the connection and
 * the other add-ons). Researchers can then compare captures.
 *
 * A module can add fields to the record of a page: it sets a 'page' object on
 * the list of items that it returns, e.g. items.page = {query: '...', blocks: 12}.
 */
window.zoekplaatje.pages = {
    // the Accept-Language header of the last page request in each tab
    accept_language: {},
    // the last answer of the country lookup, used for 10 minutes
    lookup: null,
    // the work for each page record, in order: a record is created once, also when
    // several responses of the page are parsed at the same time
    queue: {},

    // fields that only the core sets
    CORE_FIELDS: ['nav_index', 'source_platform', 'engine', 'url', 'rows', 'captured_at', 'last_captured_at', 'problems',
        'screenshots', 'archive_files', 'file_count'],

    // Firefox privacy settings in the run details: field name, then the setting in the browser.privacy API
    PRIVACY_SETTINGS: {
        privacy_tracking_protection: ['websites', 'trackingProtectionMode'],
        privacy_resist_fingerprinting: ['websites', 'resistFingerprinting'],
        privacy_first_party_isolate: ['websites', 'firstPartyIsolate'],
        privacy_cookies: ['websites', 'cookieConfig'],
        privacy_referrers: ['websites', 'referrersEnabled'],
        privacy_https_only: ['network', 'httpsOnlyMode'],
        privacy_global_privacy_control: ['network', 'globalPrivacyControl'],
        privacy_webrtc_ip_policy: ['network', 'webRTCIPHandlingPolicy']
    },

    /**
     * Run a task for one page record after the tasks before it
     *
     * @param nav_index  Navigation index of the page
     * @param task  Async function
     * @returns {Promise}
     */
    run: function (nav_index, task) {
        const previous = this.queue[nav_index] || Promise.resolve();
        const next = previous.then(task).catch(error => console.warn('Zoekplaatje could not update page record ' + nav_index, error));
        this.queue[nav_index] = next;
        next.then(() => {
            if (this.queue[nav_index] === next) {
                delete this.queue[nav_index];
            }
        });
        return next;
    },

    /**
     * Record that a module captured items on a page
     *
     * The first time for a page, this creates its record with the run details.
     * Later times add the rows and the page fields of the module.
     *
     * @param module  Module (domain) that captured the items
     * @param nav_index  Navigation index of the page
     * @param tab_id  Tab of the page
     * @param page_url  URL of the page
     * @param items  Items that the module returned
     * @param collected  Time of capture (milliseconds)
     * @param response  Content of the response (for the archive)
     * @param source_url  URL of the response
     * @returns {Promise}
     */
    record: function (module, nav_index, tab_id, page_url, items, collected, response, source_url) {
        let loaded = false;
        return this.run(nav_index, async () => {
            const fields = this.page_fields(items);
            const existing = await db.pages.get(nav_index);
            if (existing) {
                await db.pages.update(nav_index, Object.assign(fields, {
                    rows: (existing.rows || 0) + items.length,
                    last_captured_at: collected
                }));
                await zoekplaatje.files.archive(await db.pages.get(nav_index), response, source_url);
                return;
            }
            const record = Object.assign({
                nav_index: nav_index,
                source_platform: module,
                engine: zoekplaatje.modules[module] ? zoekplaatje.modules[module].name : module,
                url: page_url,
                query: this.first_value(items, 'query'),
                results_page: this.first_value(items, 'results_page'),
                rows: items.length,
                captured_at: collected,
                last_captured_at: collected,
                problems: []
            }, fields, await this.run_details(tab_id));
            await db.pages.put(record);
            await zoekplaatje.files.archive(record, response, source_url);
            // the sizes of the page need the loaded page; else the load listener measures them
            const tab = tab_id >= 0 ? await browser.tabs.get(tab_id).catch(() => null) : null;
            if (tab && tab.status === 'complete') {
                await this.measure(nav_index, tab_id);
                loaded = true;
            }
        }).then(() => {
            // after the work for the record: the screenshot updates the record itself
            if (loaded) {
                zoekplaatje.files.automatic(nav_index, tab_id);
            }
        });
    },

    /**
     * The navigation index of the page that a tab shows now
     */
    current: function (tab_id) {
        return zoekplaatje.session + ':' + tab_id + ':' + (zoekplaatje.nav_index[tab_id] || 0);
    },

    /**
     * Record a problem with the capture of a page, if the page has a record
     *
     * @param module  Module that had the problem
     * @param nav_index  Navigation index of the page
     * @param message  What went wrong
     * @returns {Promise}
     */
    problem: function (module, nav_index, message) {
        return this.run(nav_index, async () => {
            const existing = await db.pages.get(nav_index);
            if (existing && existing.source_platform === module) {
                await db.pages.update(nav_index, {problems: (existing.problems || []).concat([String(message).slice(0, 300)])});
            }
        });
    },

    /**
     * The page fields that a module set on its items, without the core fields
     */
    page_fields: function (items) {
        const fields = {};
        for (const [key, value] of Object.entries(items.page || {})) {
            if (!this.CORE_FIELDS.includes(key) && value !== undefined && value !== null && value !== '') {
                fields[key] = value;
            }
        }
        return fields;
    },

    first_value: function (items, field) {
        const item = items.find(item => item && item[field] !== undefined && item[field] !== '');
        return item ? item[field] : '';
    },

    /**
     * The run details for a new page record
     *
     * @param tab_id  Tab of the page
     * @returns {Promise<Object>}
     */
    run_details: async function (tab_id) {
        const offset = -new Date().getTimezoneOffset();
        const details = {
            extension_version: browser.runtime.getManifest().version,
            user_agent: navigator.userAgent,
            accept_language: this.accept_language[tab_id] || '',
            languages: (navigator.languages || []).join(', '),
            time_zone: Intl.DateTimeFormat().resolvedOptions().timeZone,
            utc_offset: (offset >= 0 ? '+' : '-') + String(Math.floor(Math.abs(offset) / 60)).padStart(2, '0') + ':' + String(Math.abs(offset) % 60).padStart(2, '0')
        };
        const settings = await browser.storage.local.get(['zs-setting-privacy', 'zs-setting-ip-lookup', 'zs-setting-store-ip', 'zs-setting-extensions']);
        const on = key => !!parseInt(settings[key]);
        if (on('zs-setting-privacy')) {
            Object.assign(details, await this.privacy());
        }
        if (on('zs-setting-ip-lookup')) {
            const lookup = await this.country_lookup();
            if (lookup) {
                details.ip_country = lookup.loc || '';
                details.ip_datacenter = lookup.colo || '';
                if (on('zs-setting-store-ip')) {
                    details.ip = lookup.ip || '';
                }
            } else {
                details.ip_country = 'lookup failed';
            }
        }
        if (on('zs-setting-extensions')) {
            details.extensions = await this.extensions();
        }
        return details;
    },

    /**
     * The privacy settings of Firefox (needs the optional 'privacy' permission)
     *
     * @returns {Promise<Object>}  One field for each setting that this Firefox has
     */
    privacy: async function () {
        const fields = {};
        if (!await browser.permissions.contains({permissions: ['privacy']}) || !browser.privacy) {
            return fields;
        }
        for (const [field, [group, name]] of Object.entries(this.PRIVACY_SETTINGS)) {
            try {
                const setting = browser.privacy[group] && browser.privacy[group][name];
                if (setting) {
                    const value = (await setting.get({})).value;
                    // the cookie configuration is an object; its behavior is the setting people know
                    fields[field] = value && typeof value === 'object' ? (value.behavior || JSON.stringify(value)) : String(value);
                }
            } catch (e) {
                // a setting that this version of Firefox does not have
            }
        }
        return fields;
    },

    /**
     * The country of the internet connection, from Cloudflare
     *
     * Cloudflare's trace page gives the IP address, its country (loc) and the
     * Cloudflare data center that answered (colo). The answer is used for 10
     * minutes, so that not every page makes a request.
     *
     * @returns {Promise<Object|null>}  The fields of the trace page, or null
     */
    country_lookup: async function () {
        if (this.lookup && Date.now() - this.lookup.time < 10 * 60 * 1000) {
            return this.lookup.fields;
        }
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 5000);
        try {
            const response = await fetch('https://www.cloudflare.com/cdn-cgi/trace', {cache: 'no-store', credentials: 'omit', signal: controller.signal});
            const fields = {};
            for (const line of (await response.text()).split('\n')) {
                const at = line.indexOf('=');
                if (at > 0) {
                    fields[line.slice(0, at)] = line.slice(at + 1).trim();
                }
            }
            this.lookup = {time: Date.now(), fields: fields};
            return fields;
        } catch (e) {
            console.warn('Zoekplaatje could not look up the country of the connection', e);
            return null;
        } finally {
            clearTimeout(timeout);
        }
    },

    /**
     * The other enabled add-ons (needs the optional 'management' permission)
     *
     * @returns {Promise<string>}  Names and versions, separated by semicolons
     */
    extensions: async function () {
        if (!await browser.permissions.contains({permissions: ['management']}) || !browser.management) {
            return '';
        }
        try {
            const all = await browser.management.getAll();
            return all.filter(extension => extension.enabled && extension.type === 'extension' && extension.id !== browser.runtime.id)
                .map(extension => extension.name + ' ' + extension.version).join('; ');
        } catch (e) {
            return '';
        }
    },

    /**
     * Measure the window and the page of a loaded page view
     *
     * Reads the sizes in the page, without changing it. Only for the page of
     * the record: if the tab has gone to another page, nothing is measured.
     *
     * @param nav_index  Navigation index of the page
     * @param tab_id  Tab of the page
     * @returns {Promise}
     */
    measure: async function (nav_index, tab_id) {
        const record = await db.pages.get(nav_index);
        if (!record) {
            return;
        }
        let sizes;
        try {
            sizes = (await browser.tabs.executeScript(tab_id, {
                code: '({url: location.href, window_width: innerWidth, window_height: innerHeight, '
                    + 'page_width: document.documentElement.scrollWidth, page_height: document.documentElement.scrollHeight, '
                    + 'device_pixel_ratio: devicePixelRatio, screen_width: screen.width, screen_height: screen.height})'
            }))[0];
        } catch (e) {
            return;
        }
        if (sizes && sizes.url === record.url) {
            delete sizes.url;
            await db.pages.update(nav_index, sizes);
        }
    },

    /**
     * Measure the page of a tab when it has loaded (webNavigation.onCompleted)
     */
    loaded: function (details) {
        if (details.frameId !== 0 || details.tabId < 0) {
            return;
        }
        const nav_index = this.current(details.tabId);
        this.run(nav_index, () => this.measure(nav_index, details.tabId))
            .then(() => zoekplaatje.files.automatic(nav_index, details.tabId));
    },

    /**
     * Remember the Accept-Language header of page requests
     * (webRequest.onSendHeaders, with request headers)
     */
    request_headers: function (details) {
        if (details.tabId < 0) {
            return;
        }
        const header = (details.requestHeaders || []).find(header => header.name.toLowerCase() === 'accept-language');
        this.accept_language[details.tabId] = header ? header.value : '';
    }
};

browser.webRequest.onSendHeaders.addListener(
    details => zoekplaatje.pages.request_headers(details), {urls: ["https://*/*"], types: ["main_frame"]}, ["requestHeaders"]
);

browser.webNavigation.onCompleted.addListener(details => zoekplaatje.pages.loaded(details));
