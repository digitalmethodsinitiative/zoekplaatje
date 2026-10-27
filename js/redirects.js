/**
 * Redirect links
 *
 * Some search engines hide where results lead behind a redirect link with an
 * encrypted token that only the engine itself can resolve (e.g. Google's
 * /goto?url=CAES... links). Modules recognise these links with the
 * get_redirect_token function they register. Captured redirect links are
 * remembered here, so the captured items can be updated once it is known where
 * the links lead: when the user clicks a result, or when the links are resolved
 * automatically (if enabled in the interface).
 */
window.zoekplaatje.redirects = {
    links: {},
    queue: {},
    resolving: {},
    paused_until: 0,

    /**
     * Get the token of a redirect link
     *
     * @param link  URL to check
     * @param module  Module to check the link with; all modules if null
     * @returns {string|null}  Token, or null if this is not a redirect link
     */
    get_token: function (link, module = null) {
        for (const domain of module ? [module] : Object.keys(zoekplaatje.modules)) {
            const get_redirect_token = zoekplaatje.modules[domain].get_redirect_token;
            const token = get_redirect_token ? get_redirect_token(link) : null;
            if (token) {
                return token;
            }
        }
        return null;
    },

    /**
     * Remember the redirect links of a captured item
     *
     * So the item can be updated once it is known where the links lead.
     *
     * @param module  Module the item was captured with
     * @param id  Database ID of the item
     * @param links  Link(s) of the item, comma-separated if more than one
     * @returns {Array}  Redirect links that were not seen before
     */
    register: function (module, id, links) {
        let new_links = [];
        for (const link of String(links).split(', ')) {
            const token = this.get_token(link, module);
            if (!token) {
                continue;
            }
            if (!(token in this.links)) {
                this.links[token] = [];
                new_links.push(link);
            }
            this.links[token].push({"id": id, "link": link});
        }
        return new_links;
    },

    /**
     * Queue redirect links to be resolved, if enabled
     *
     * @param tabId  ID of the tab the links were captured in
     * @param links  Redirect links
     */
    enqueue: async function (tabId, links) {
        const setting = await browser.storage.local.get('zs-resolve-links');
        if (links.length === 0 || tabId < 0 || !parseInt(setting['zs-resolve-links'])) {
            return;
        }

        if (!(tabId in this.queue)) {
            this.queue[tabId] = [];
        }
        this.queue[tabId].push(...links);
        this.update_badge();

        // if the page is still loading, the webNavigation listener starts
        // resolving once it has loaded
        const tab = await browser.tabs.get(tabId).catch(() => null);
        if (tab && tab.status === 'complete') {
            this.resolve(tabId);
        }
    },

    /**
     * Resolve queued redirect links for a tab
     *
     * Links are requested one by one from within the search result page, as
     * if the page itself made the request, so they are sent with the same
     * cookies and referrer as when clicking the result. The redirect is not
     * followed, so the result's site itself is not contacted; the redirect
     * listener records where each link leads.
     *
     * @param tabId  ID of the tab to resolve links in
     */
    resolve: async function (tabId) {
        const queue = this.queue[tabId];
        if (!queue || this.resolving[tabId]) {
            return;
        }

        this.resolving[tabId] = true;
        while (queue.length > 0 && Date.now() > this.paused_until) {
            const setting = await browser.storage.local.get('zs-resolve-links');
            if (!parseInt(setting['zs-resolve-links'])) {
                // resolving was disabled while links were still queued
                queue.length = 0;
                break;
            }

            let requested;
            try {
                // only request the link from a page on the same site, so it is sent as if that page made the
                // request. content.fetch does this (Firefox, manifest v2 only)
                const hostname = new URL(queue[0]).hostname;
                requested = await browser.tabs.executeScript(tabId, {
                    code: "location.hostname === " + JSON.stringify(hostname) + " && content.fetch(" + JSON.stringify(queue[0]) + ", {redirect: 'manual'}).then(() => true, () => true)"
                });
            } catch (e) {
                requested = [false];
            }

            if (!requested[0]) {
                // tab is no longer on the search engine; continue when the next page has loaded
                break;
            }

            queue.shift();
            this.update_badge();
            await new Promise(resolve => setTimeout(resolve, 1000 + Math.random() * 1000));
        }
        this.resolving[tabId] = false;
        this.update_badge();
    },

    /**
     * Get the status of resolving redirect links
     *
     * @returns {{outstanding: number, paused_until: number}}  Number of links
     * still to be resolved, and until when resolving is paused (0 if not)
     */
    get_status: function () {
        return {
            "outstanding": Object.values(this.queue).reduce((total, queue) => total + queue.length, 0),
            "paused_until": this.paused_until > Date.now() ? this.paused_until : 0
        };
    },

    /**
     * Show the number of redirect links still to be resolved on the toolbar button
     */
    update_badge: function () {
        const outstanding = this.get_status()["outstanding"];
        browser.browserAction.setBadgeText({"text": outstanding > 0 ? String(outstanding) : ""});
        browser.browserAction.setTitle({"title": outstanding > 0 ? "Zoekplaatje: " + outstanding + " result link(s) still to be resolved" : "Zoekplaatje"});
    },

    /**
     * Redirect listener
     * Records where redirect links lead, both when resolved automatically and
     * when the user clicks a result
     * @param details  Request details
     */
    listener: async function (details) {
        // only redirects (and rate limiting) are of interest
        if ((details.statusCode < 300 || details.statusCode >= 400) && details.statusCode !== 429) {
            return;
        }

        const redirects = zoekplaatje.redirects;
        const token = redirects.get_token(details.url);
        if (!token || !(token in redirects.links)) {
            return;
        }

        const location_header = details.responseHeaders.find(header => header.name.toLowerCase() === 'location');
        const destination = location_header ? new URL(location_header.value, details.url).href : '';
        if (details.statusCode === 429 || /^https:\/\/[^\/]*google\.[^\/]+\/sorry\//.test(destination)) {
            // the search engine wants a CAPTCHA solved (/sorry/ is google's CAPTCHA page); stop resolving
            // links for a while
            redirects.paused_until = Date.now() + 30 * 60 * 1000;
            return;
        } else if (!destination) {
            return;
        }

        for (const redirect of redirects.links[token]) {
            await db.items.where("id").equals(redirect.id).modify(item => {
                if (item.data.link === redirect.link) {
                    item.data.domain = destination.split('/')[2];
                }
                item.data.link = item.data.link.replace(redirect.link, () => destination);
            });
        }
        delete redirects.links[token];
    }
}

browser.webRequest.onHeadersReceived.addListener(
    zoekplaatje.redirects.listener, {urls: ["https://*/*"], types: ["main_frame", "xmlhttprequest"]}, ["responseHeaders"]
);

browser.webNavigation.onCompleted.addListener((details) => {
    if (details.frameId === 0) {
        zoekplaatje.redirects.resolve(details.tabId);
    }
});

browser.tabs.onRemoved.addListener((tabId) => {
    delete zoekplaatje.redirects.queue[tabId];
    zoekplaatje.redirects.update_badge();
});
