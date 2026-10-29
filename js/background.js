window.db = new Dexie('zoekplaatje-items');
window.db.version(1).stores({
    items: "++id, item_id, nav_index, source_platform",
    uploads: "++id",
    nav: "++id, tab_id, session",
    settings: "key"
});

window.zoekplaatje = {
    modules: {},
    session: null,
    ready: null,
    tab_url_map: {},
    nav_index: {},

    /**
     * Register module
     * @param name  Module identifier
     * @param domain  Module primary domain name
     * @param callback  Function to parse request content with, returning an Array of extracted items
     */
    register_module: function (name, domain, callback) {
        this.modules[domain] = {
            name: name,
            callback: callback
        };
    },

    /**
     * Initialise Extension
     * Called on browser session start; increases session index to aid in deduplicating extracted items.
     */
    init: async function () {
        let session;
        session = await db.settings.get("session");
        if (!session) {
            session = {"key": "session", "value": 0};
            await db.settings.add(session);
        }

        session["value"] += 1;
        this.session = session["value"];
        await db.settings.update("session", session);
        await db.nav.where("session").notEqual(this.session).delete();

        // synchronise browser icon with whether capture is enabled or not
        setInterval(async function () {
            let enabled = [];
            for (const module in zoekplaatje.modules) {
                const enabled_key = 'zs-enabled-' + module;
                const is_enabled = await browser.storage.local.get(enabled_key);
                if (is_enabled.hasOwnProperty(enabled_key) && !!parseInt(is_enabled[enabled_key])) {
                    enabled.push(module);
                }
            }
            let path = enabled.length > 0 ? 'images/icon-96-enabled.png' : 'images/icon-96.png';
            browser.browserAction.setIcon({path: path})
        }, 500);
    },

    /**
     * Request listener
     * Filters HTTP requests and passes the content to the parser
     * @param details  Request details
     */
    listener: function (details) {
        let filter = browser.webRequest.filterResponseData(details.requestId);
        let decoder = new TextDecoder("utf-8");
        let full_response = '';
        let source_url = details.url;
        let source_platform_url = details.hasOwnProperty("originUrl") ? details.originUrl : source_url;

        filter.ondata = event => {
            let str = decoder.decode(event.data, {stream: true});
            full_response += str;
            filter.write(event.data);
        }

        filter.onstop = async (event) => {
            let base_url = source_platform_url ? source_platform_url : source_url;
            let source_platform = base_url.split('://').pop().split('/')[0].replace(/^www\./, '').toLowerCase();

            let enabled = [];
            for (const module in zoekplaatje.modules) {
                const enabled_key = 'zs-enabled-' + module;
                const is_enabled = await browser.storage.local.get(enabled_key);
                if (is_enabled.hasOwnProperty(enabled_key) && !!parseInt(is_enabled[enabled_key])) {
                    enabled.push(module);
                }
            }

            if (enabled.length > 0) {
                zoekplaatje.parse_request(full_response, source_platform_url, source_url, details.tabId);
            }
            filter.disconnect();
            full_response = '';
        }

        return {};
    },

    /**
     * Parse captured request
     * @param response  Content of the request
     * @param source_platform_url  URL of the *page* the data was requested from
     * @param source_url  URL of the content that was captured
     * @param tabId  ID of the tab in which the request was captured
     */
    parse_request: async function (response, source_platform_url, source_url, tabId) {
        // the session is read from the database at startup
        await this.ready;

        if (!source_platform_url) {
            source_platform_url = source_url;
        }

        try {
            // get the *actual url* of the tab, not the url that the request
            // reports, which may be wrong
            let tab = await browser.tabs.get(tabId);
            source_platform_url = tab.url;
        } catch (Error) {
            tabId = -1;
            // invalid tab id, use provided originUrl
        }

        // sometimes the tab URL changes without triggering a webNavigation
        // event! so check if the URL changes, and then increase the nav
        // index *as if* an event had triggered if it does
        // read and update the URL with no await in between: the responses of
        // one page are parsed at the same time, and only one may count the change
        const old_url = this.tab_url_map[tabId];
        this.tab_url_map[tabId] = source_platform_url;
        if (old_url && source_platform_url !== old_url) {
            this.nav_handler(tabId);
        }

        // the navigation index tells which page view an item was captured on
        const nav_index = this.session + ":" + tabId + ":" + (this.nav_index[tabId] || 0);

        let item_list = [];
        for (let module in this.modules) {
            // check if module is enabled
            const enabled_key = 'zs-enabled-' + module;
            const is_enabled = await browser.storage.local.get(enabled_key);
            if (!is_enabled.hasOwnProperty(enabled_key) || !parseInt(is_enabled[enabled_key])) {
                continue;
            }
            // get items from module parser (will often be an empty list)
            // a module that fails on a response must not stop the other modules
            try {
                item_list = this.modules[module].callback(response, source_platform_url, source_url, nav_index);
            } catch (error) {
                console.error(`Zoekplaatje module ${module} could not parse ${source_url}`, error);
                continue;
            }
            if (item_list && item_list.length > 0) {
                // one time for all items of a response, so that the rows of one
                // page have the same timestamp in the export
                const timestamp_collected = Date.now();
                await Promise.all(item_list.filter(item => item).map(item => db.items.add({
                    "nav_index": nav_index,
                    "item_id": item["id"],
                    "timestamp_collected": timestamp_collected,
                    "source_platform": module,
                    "source_platform_url": source_platform_url,
                    "source_url": source_url,
                    "user_agent": navigator.userAgent,
                    "data": item
                })));

                return;
            }
        }
    },

    /**
     * Check if extension tab is open or not
     * @returns {Promise<boolean>}
     */
    has_tab: async function () {
        const tabs = await browser.tabs.query({});
        const full_url = browser.runtime.getURL('popup/interface.html');
        const tab = tabs.filter((tab) => {
            return (tab.url === full_url);
        });
        return tab[0] || false;
    },

    /**
     * Callback for browser navigation
     * Increases the nav_index for a given tab, so that items of different
     * page views have a different nav_index
     * @param tabId  Tab ID to update nav index for
     */
    nav_handler: function (tabId) {
        this.nav_index[tabId] = (this.nav_index[tabId] || 0) + 1;
    }
}

zoekplaatje.ready = zoekplaatje.init();

browser.webRequest.onBeforeRequest.addListener(
    zoekplaatje.listener, {urls: ["https://*/*"], types: ["main_frame", "xmlhttprequest", "script"]}, ["blocking"]
);

browser.webNavigation.onCommitted.addListener((details) => {
    // only the top frame starts a new page: frames (e.g. ads) also commit
    if (details.frameId !== 0) {
        return;
    }
    // the URL change is counted here, so parse_request must not count it again
    zoekplaatje.tab_url_map[details.tabId] = details.url;
    zoekplaatje.nav_handler(details.tabId);
});

browser.browserAction.onClicked.addListener(async () => {
    let tab = await zoekplaatje.has_tab();
    if (!tab) {
        browser.tabs.create({url: 'popup/interface.html'});
    } else if (!tab.active) {
        browser.tabs.update(tab.id, {active: true});
    }
});