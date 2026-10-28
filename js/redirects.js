/**
 * Redirect links
 *
 * Some search engines hide where results lead behind a redirect link with an
 * encrypted token that only the engine itself can resolve (e.g. Google's
 * /goto?url=CAES... links). Modules recognise these links with the redirect
 * functions they register (see register_module). Captured redirect links are
 * remembered here, so the captured items can be updated once it is known where
 * the links lead: when the user clicks a result, or when the links are resolved
 * automatically (if enabled in the interface).
 *
 * Links are resolved from an open result page on the same site. When the
 * search engine asks for a CAPTCHA, resolving stops until the user has solved
 * it, which is assumed once results from that engine are captured again, or
 * when the user clicks 'Try again' in the interface.
 */
window.zoekplaatje.redirects = {
    links: {},
    queue: [],
    resolving: false,
    blocked: null,

    /**
     * Get the token of a redirect link
     *
     * @param link  URL to check
     * @param module  Module to check the link with
     * @returns {string|null}  Token, or null if this is not a redirect link
     */
    get_token: function (link, module) {
        const get_redirect_token = zoekplaatje.modules[module].redirects.get_redirect_token;
        return get_redirect_token ? get_redirect_token(link) : null;
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
     * Called whenever a module has captured results, which also means its
     * search engine is not asking for a CAPTCHA (anymore).
     *
     * @param module  Module the links were captured with
     * @param tabId  ID of the tab the links were captured in
     * @param links  Redirect links
     */
    enqueue: async function (module, tabId, links) {
        if (this.blocked === module) {
            this.blocked = null;
        }

        const setting = await browser.storage.local.get('zs-resolve-links');
        if (parseInt(setting['zs-resolve-links'])) {
            this.queue.push(...links.map(link => ({"module": module, "link": link})));
        }
        this.update_badge();

        // if the page is still loading, the webNavigation listener starts
        // resolving once it has loaded
        const tab = tabId >= 0 ? await browser.tabs.get(tabId).catch(() => null) : null;
        if (tab && tab.status === 'complete') {
            this.resolve(tabId);
        }
    },

    /**
     * Resolve queued redirect links from a tab
     *
     * Links are requested one by one from within a result page on the same
     * site, as if the page itself made the request, so they are sent with the
     * same cookies and referrer as when clicking the result. The redirect is
     * not followed, so the result's site itself is not contacted; the redirect
     * listener records where each link leads.
     *
     * @param tabId  ID of the tab to resolve links from
     */
    resolve: async function (tabId) {
        if (this.resolving || this.blocked || this.queue.length === 0) {
            return;
        }

        this.resolving = true;
        this.update_badge();
        while (!this.blocked) {
            const tab = await browser.tabs.get(tabId).catch(() => null);
            const hostname = tab ? new URL(tab.url).hostname : '';
            const entry = this.queue.find(entry => new URL(entry.link).hostname === hostname);
            if (!entry) {
                // nothing (left) to resolve from this tab; continue when a page on the right site has loaded
                break;
            }

            const is_captcha = zoekplaatje.modules[entry.module].redirects.is_captcha;
            if (is_captcha && is_captcha(tab.url)) {
                // the tab itself shows a CAPTCHA, so requests would be blocked too
                this.blocked = entry.module;
                break;
            }

            let requested;
            try {
                // content.fetch makes the request as if from the page (Firefox, manifest v2 only)
                requested = await browser.tabs.executeScript(tabId, {
                    code: "location.hostname === " + JSON.stringify(hostname) + " && content.fetch(" + JSON.stringify(entry.link) + ", {redirect: 'manual'}).then(() => true, () => true)"
                });
            } catch (e) {
                requested = [false];
            }

            if (!requested[0] || this.blocked) {
                // tab navigated away in the meantime, or the search engine asks for a CAPTCHA (in which case the
                // redirect listener keeps the link queued)
                break;
            }

            // if the link was resolved, the redirect listener has removed it from the queue already; if not,
            // it cannot be resolved, so stop trying
            this.queue = this.queue.filter(queued => queued !== entry);
            this.update_badge();
            await new Promise(resolve => setTimeout(resolve, 1000 + Math.random() * 1000));
        }
        this.resolving = false;
        this.update_badge();
    },

    /**
     * Try to resolve links again
     *
     * When the user asks for it, e.g. after solving a CAPTCHA. Links are
     * resolved from an open tab on a site they are waiting for, preferably
     * the active tab.
     */
    retry: async function () {
        this.blocked = null;
        this.update_badge();

        const hostnames = this.queue.map(entry => new URL(entry.link).hostname);
        const tabs = await browser.tabs.query({});
        const tab = tabs.filter(tab => tab.url && hostnames.includes(new URL(tab.url).hostname)).sort((a, b) => b.active - a.active)[0];
        if (tab) {
            this.resolve(tab.id);
        }
    },

    /**
     * Stop resolving links and forget the queue
     */
    clear: function () {
        this.queue = [];
        this.blocked = null;
        this.update_badge();
    },

    /**
     * Get the status of resolving redirect links
     *
     * @returns {{state: string, outstanding: number, message: string}}  State
     * is 'idle', 'resolving', 'waiting' (for a result page to resolve links
     * from) or 'captcha'; message explains it to the user
     */
    get_status: function () {
        const outstanding = this.queue.length;
        const links = outstanding === 1 ? '1 hidden result link' : outstanding + ' hidden result links';
        const are = outstanding === 1 ? 'is' : 'are';
        const engines = [...new Set(this.queue.map(entry => zoekplaatje.modules[entry.module].name))].join(' or ');

        let state, message;
        if (outstanding === 0) {
            state = 'idle';
            message = '';
        } else if (this.blocked) {
            const engine = zoekplaatje.modules[this.blocked].name;
            state = 'captcha';
            message = engine + ' is asking for a CAPTCHA, so ' + links + ' ' + are + ' not resolved yet. Reload a ' + engine + ' search and solve the CAPTCHA to continue.';
        } else if (this.resolving) {
            state = 'resolving';
            message = 'Resolving ' + links + '. Keep a ' + engines + ' result page open until this is done.';
        } else {
            state = 'waiting';
            message = links + ' ' + are + ' not resolved yet. Open or reload a ' + engines + ' result page to continue.';
        }
        return {"state": state, "outstanding": outstanding, "message": message};
    },

    /**
     * Show the status on the toolbar button
     *
     * The number of links still to be resolved, in orange when waiting for a
     * result page and in red when waiting for a CAPTCHA to be solved.
     */
    update_badge: function () {
        const status = this.get_status();
        const colors = {"idle": "#3b4152", "resolving": "#3b4152", "waiting": "#b06a00", "captcha": "#b3261e"};
        browser.browserAction.setBadgeText({"text": status.outstanding > 0 ? String(status.outstanding) : ""});
        browser.browserAction.setBadgeBackgroundColor({"color": colors[status.state]});
        browser.browserAction.setTitle({"title": status.message ? "Zoekplaatje: " + status.message : "Zoekplaatje"});
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

        // find the module that captured this redirect link
        const redirects = zoekplaatje.redirects;
        const module = Object.keys(zoekplaatje.modules).find(module => {
            const token = redirects.get_token(details.url, module);
            return token && token in redirects.links;
        });
        if (!module) {
            return;
        }

        const token = redirects.get_token(details.url, module);
        const is_captcha = zoekplaatje.modules[module].redirects.is_captcha;
        const location_header = details.responseHeaders.find(header => header.name.toLowerCase() === 'location');
        const destination = location_header ? new URL(location_header.value, details.url).href : '';
        if (details.statusCode === 429 || (is_captcha && is_captcha(destination))) {
            // the search engine wants a CAPTCHA solved; stop resolving until the user has done so, and if
            // this link was being resolved, keep it queued to try again then
            redirects.blocked = module;
            const link = redirects.links[token][0].link;
            if (redirects.resolving && !redirects.queue.some(entry => entry.link === link)) {
                redirects.queue.unshift({"module": module, "link": link});
            }
            redirects.update_badge();
            return;
        } else if (!destination) {
            return;
        }

        // no need to resolve this link anymore if it was still queued
        redirects.queue = redirects.queue.filter(entry => redirects.get_token(entry.link, entry.module) !== token);
        redirects.update_badge();

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

browser.storage.onChanged.addListener((changes) => {
    if ('zs-resolve-links' in changes && !parseInt(changes['zs-resolve-links'].newValue)) {
        zoekplaatje.redirects.clear();
    }
});
