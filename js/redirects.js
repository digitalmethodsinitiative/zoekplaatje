/**
 * Redirect links
 *
 * Some search engines hide where results lead behind a redirect link with an
 * encrypted token that only the engine itself can resolve (e.g. Google's
 * /goto?url=CAES... links). Modules recognise these links with the redirect
 * functions they register (see register_module). Captured redirect links are
 * remembered here, so that the final_link of the captured items can be filled
 * in once it is known where the links lead: when the user clicks a result, or
 * when the links are resolved automatically (if enabled in the interface). The
 * captured link itself is never changed.
 *
 * Links are resolved from an open result page on the same site. When the
 * search engine asks for a CAPTCHA, or answers in an unexpected way, resolving
 * stops until results from that engine are captured again, or until the user
 * clicks 'Try again' in the interface.
 */
window.zoekplaatje.redirects = {
    links: {},
    destinations: {},
    failures: {},
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
        const handlers = zoekplaatje.modules[module].redirects;
        return handlers.get_redirect_token ? handlers.get_redirect_token(link) : null;
    },

    /**
     * Check if a URL is a search engine's CAPTCHA page
     *
     * @param url  URL to check
     * @param module  Module of the search engine
     * @returns {boolean}
     */
    is_captcha: function (url, module) {
        const handlers = zoekplaatje.modules[module].redirects;
        return handlers.is_captcha ? handlers.is_captcha(url) : false;
    },

    /**
     * Get where the link(s) of an item lead, as far as known
     *
     * @param links  Link(s) of the item, comma-separated if more than one
     * @param module  Module the item was captured with
     * @returns {string}  Final link(s), or an empty string if not known for all links
     */
    get_final_link: function (links, module) {
        const handlers = zoekplaatje.modules[module].redirects;
        const final_links = String(links).split(', ').map(link => {
            const token = this.get_token(link, module);
            if (token) {
                return this.destinations[token] || '';
            }
            return handlers.get_final_link ? handlers.get_final_link(link) : link;
        });
        return final_links.includes('') ? '' : final_links.join(', ');
    },

    /**
     * Remember the redirect links of a captured item
     *
     * So the item can be updated once it is known where the links lead. If
     * that is known already, because the same link was captured and resolved
     * before, the item is updated right away.
     *
     * @param module  Module the item was captured with
     * @param id  Database ID of the item
     * @param links  Link(s) of the item, comma-separated if more than one
     * @returns {Array}  Redirect links that were not seen before
     */
    register: async function (module, id, links) {
        let new_links = [];
        let resolved = false;
        for (const link of String(links).split(', ')) {
            const token = this.get_token(link, module);
            if (!token) {
                continue;
            }
            if (token in this.destinations) {
                resolved = true;
                continue;
            }
            if (!(token in this.links)) {
                this.links[token] = [];
                new_links.push(link);
            }
            this.links[token].push({"id": id, "module": module, "link": link});
        }

        if (resolved) {
            await db.items.where("id").equals(id).modify(item => {
                item.data.final_link = this.get_final_link(item.data.link, module);
            });
        }
        return new_links;
    },

    /**
     * Queue the redirect links captured earlier that are not resolved yet
     *
     * Called when resolving is turned on, so that results captured before
     * that are resolved too, unless they have been cleared since. Links that
     * were skipped after unexpected answers are not tried again.
     */
    enqueue_captured: async function () {
        for (const token of Object.keys(this.links)) {
            const ids = this.links[token].map(redirect => redirect.id);
            const exists = await db.items.where("id").anyOf(ids).count() > 0;
            // checked after reading the database, since the link may have been resolved in the meantime
            if (!exists || !(token in this.links) || this.queue.some(entry => this.get_token(entry.link, entry.module) === token)) {
                continue;
            }
            const redirect = this.links[token][0];
            if ((this.failures[redirect.link] || 0) < 2) {
                this.queue.push({"module": redirect.module, "link": redirect.link});
            }
        }
        await this.retry();
    },

    /**
     * Queue redirect links to be resolved, if enabled
     *
     * Called whenever a module has captured results, which also means its
     * search engine is answering normally (again).
     *
     * @param module  Module the links were captured with
     * @param tabId  ID of the tab the links were captured in
     * @param links  Redirect links
     */
    enqueue: async function (module, tabId, links) {
        if (this.blocked && this.blocked.module === module) {
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

            if (this.is_captcha(tab.url, entry.module)) {
                // the tab itself shows a CAPTCHA, so requests would be blocked too
                this.pause_for_captcha(entry.module, null);
                break;
            }

            let answer;
            try {
                // content.fetch makes the request as if from the page (Firefox, manifest v2 only). The page
                // can tell a redirect from other answers, but not where it leads; the redirect listener
                // records that
                const result = await browser.tabs.executeScript(tabId, {
                    code: "location.hostname === " + JSON.stringify(hostname) + " && content.fetch(" + JSON.stringify(entry.link) + ", {redirect: 'manual'})" +
                        ".then(response => response.type === 'opaqueredirect' ? 'redirect' : 'HTTP ' + response.status, () => 'a network error')"
                });
                answer = result[0];
            } catch (e) {
                answer = false;
            }

            if (!answer) {
                // tab navigated away in the meantime
                break;
            } else if (answer === 'HTTP 429') {
                this.pause_for_captcha(entry.module, entry.link);
            } else if (answer !== 'redirect') {
                this.unexpected(entry.module, entry.link, answer);
            } else if (!this.blocked) {
                // the redirect listener has removed the link from the queue already if it was resolved, or
                // keeps it queued if the redirect was not as expected
                this.queue = this.queue.filter(queued => queued !== entry);
            }

            this.update_badge();
            if (this.blocked) {
                break;
            }
            await new Promise(resolve => setTimeout(resolve, 1000 + Math.random() * 1000));
        }
        this.resolving = false;
        this.update_badge();
    },

    /**
     * Stop resolving until the search engine's CAPTCHA has been solved
     *
     * @param module  Module of the search engine
     * @param link  Link that was being resolved, to try again later, or null
     */
    pause_for_captcha: function (module, link) {
        this.blocked = {"module": module, "reason": "captcha", "answer": ""};
        if (link) {
            this.requeue(module, link);
        }
        this.update_badge();
    },

    /**
     * Handle an unexpected answer to a lookup
     *
     * The first time a link gets one, resolving stops, since it is not clear
     * what the search engine is doing. The second time, the link is skipped,
     * so its final_link stays empty.
     *
     * @param module  Module of the search engine
     * @param link  Link that was being resolved
     * @param answer  What the search engine answered
     */
    unexpected: function (module, link, answer) {
        console.warn("Zoekplaatje could not resolve " + link + ": unexpected answer (" + answer + ")");
        this.failures[link] = (this.failures[link] || 0) + 1;
        if (this.failures[link] >= 2) {
            this.queue = this.queue.filter(entry => entry.link !== link);
        } else {
            this.blocked = {"module": module, "reason": "unexpected", "answer": answer};
            this.requeue(module, link);
        }
        this.update_badge();
    },

    /**
     * Put a link back at the front of the queue, unless it is queued already
     *
     * @param module  Module the link was captured with
     * @param link  Redirect link
     */
    requeue: function (module, link) {
        if (!this.queue.some(entry => entry.link === link)) {
            this.queue.unshift({"module": module, "link": link});
        }
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
     * from), 'captcha' or 'unexpected'; message explains it to the user
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
        } else if (this.blocked && this.blocked.reason === 'captcha') {
            const engine = zoekplaatje.modules[this.blocked.module].name;
            state = 'captcha';
            message = engine + ' is asking for a CAPTCHA, so ' + links + ' ' + are + ' not resolved yet. Reload a ' + engine + ' search and solve the CAPTCHA to continue.';
        } else if (this.blocked) {
            const engine = zoekplaatje.modules[this.blocked.module].name;
            const answer = this.blocked.answer.length > 100 ? this.blocked.answer.substring(0, 100) + '...' : this.blocked.answer;
            state = 'unexpected';
            message = engine + ' answered a lookup unexpectedly (' + answer + '), so ' + links + ' ' + are + ' not resolved yet. Reload a ' + engine + ' search or click Try again in the Zoekplaatje interface to continue.';
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
     * result page and in red when the search engine needs attention.
     */
    update_badge: function () {
        const status = this.get_status();
        const colors = {"idle": "#3b4152", "resolving": "#3b4152", "waiting": "#b06a00", "captcha": "#b3261e", "unexpected": "#b3261e"};
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
        const link = redirects.links[token][0].link;
        // while resolving, this is (most likely) one of our lookups rather than the user clicking a result
        const lookup = redirects.resolving;
        const location_header = details.responseHeaders.find(header => header.name.toLowerCase() === 'location');
        const destination = location_header ? new URL(location_header.value, details.url).href : '';

        if (details.statusCode === 429 || redirects.is_captcha(destination, module)) {
            redirects.pause_for_captcha(module, lookup ? link : null);
            return;
        } else if (!destination || new URL(destination).hostname === new URL(details.url).hostname) {
            // a redirect back to the search engine itself is not where the result leads
            if (lookup) {
                redirects.unexpected(module, link, destination ? 'a redirect to ' + destination : 'a redirect without destination');
            }
            return;
        }

        // record where the link leads, and do not resolve it again if it was still queued
        redirects.destinations[token] = destination;
        redirects.queue = redirects.queue.filter(entry => redirects.get_token(entry.link, entry.module) !== token);
        redirects.update_badge();

        for (const redirect of redirects.links[token]) {
            await db.items.where("id").equals(redirect.id).modify(item => {
                item.data.final_link = redirects.get_final_link(item.data.link, module);
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
    if (!('zs-resolve-links' in changes)) {
        return;
    }
    if (parseInt(changes['zs-resolve-links'].newValue)) {
        zoekplaatje.redirects.enqueue_captured();
    } else {
        zoekplaatje.redirects.clear();
    }
});
