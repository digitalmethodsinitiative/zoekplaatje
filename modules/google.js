zoekplaatje.register_module(
    'Google',
    'google.com',
    function (response, source_platform_url, source_url, nav_index) {
        let results = [];
        let results_sidebar = [];

        // source_platform_url = URL in browser
        // source_url = URL of request that is being handled

        // check if google...
        let domain = source_url.split('/')[2];
        if (domain.indexOf('google') < 0) {
            return [];
        }

        // we're gonna need these to parse the data
        let path = source_url.split('/').slice(3).join('/');
        let now = moment();
        let index = 1;
        const parser = new DOMParser();
        let resultpage;

        // google uses obfuscated class names
        // can we rely on them? probably they are semi-stable
        // however, it's not clear *what they mean* so it's hard to say if a
        // given class is e.g. specific to wikipedia widgets, or a general class
        // that (for example) designates 'box with an icon'
        // so, tl;dr, minimise using obfuscated class names
        let selectors = {
            title: 'h3',
            link: 'span > a',
            description: 'div.VwiC3b, div.ITZIwc, div.xpdopen div.wDYxhc',  // ugh :(
        };

        /**
         * Get an HTML element's property, safely
         *
         * Trying to get e.g. the innerText of a non-existing element crashes
         * the script, this makes it return an empty string instead.
         *
         * @param item
         * @param prop
         * @param default_value
         * @returns {*|string}
         */
        function safe_prop(item, prop, default_value='') {
            if(item && prop.indexOf('attr:') === 0 && item.hasAttribute(prop.split('attr:')[1])) {
                return item.getAttribute(prop.split('attr:')[1]);
            } else if(item && prop in item) {
                return item[prop].trim();
            } else {
                return default_value;
            }
        }

        function closest_parent(node, selector) {
            while(node.parentNode) {
                node = node.parentNode;
                if (node instanceof HTMLElement) {
                    if (node.matches(selector)) {
                        return node;
                    }
                }
            }
            return null;
        }

        function has_content(el) {
            // Check if the element exists
            if (!el) {
                return false;
            }
            if (el.textContent.trim() !== "") {
                return true;
            }
            if (el.childNodes.length > 0) {
                return true;
            }
            return false;
        }

        function text_from_childless_children(container) {
            let text = '';
            // no headers or script tags
            const valid_tags = ['a', 'div', 'span', 'p'];

            function traverse(node) {
                if (node && !node.hasChildNodes()) {
                    if (node.nodeType === node.TEXT_NODE && valid_tags.includes(node.parentNode.tagName.toLowerCase())) {
                         text += node.textContent.trim() + ' ';
                    }
                } else if (node) {
                    Array.from(node.childNodes).forEach(child => traverse(child));
                }
            }

            traverse(container);
            return text;
        }

        // check if file contains search results...
        // if so, create a DOM with the results we can query via selectors
        let from_page = true;
        if (path.indexOf('search') === 0 && path.indexOf('q=') > 0 && response.indexOf('<!doctype html>') >= 0) {
            // original result page
            resultpage = parser.parseFromString(response, 'text/html');

        } else if (path.indexOf('search') === 0 && response.indexOf(')]}\'') === 0) {
            // scroll-loaded extra results
            const html = '<div' + response.split('<div').slice(1).join('<div').split('</div>').slice(0, -1).join('</div>') + '</div>';
            resultpage = parser.parseFromString(html, 'text/html');
            from_page = false;
        } else {
            return [];
        }

        let item_selectors = [];
        // 'did you mean' search correction; always on top
        item_selectors.push('#fprs, #taw');

        // first figure out how to get the search results
        // this changes unfortunately, so not trivial
        if (from_page) {
            item_selectors.push('#center_col #rso > div');
            // sometimes it happens that there's a 'main' featured box on top of
            // the search, with organic results nested underneath (tested with query 'gemini')
            item_selectors.push('#center_col #rso > div:not([class]) > div');
        } else {
            item_selectors.push('body > div > div:not(#tvcap)');
        }

        if (resultpage.querySelector('wholepage-tab-history-helper, .kp-wholepage-osrp')) {
            // the page has 'tabs', which doesn't seem to make any visual
            // difference, but the structure is totally different
            // sometimes results are nested, sometimes not...
            if (resultpage.querySelector('#kp-wp-tab-overview > div.HaEtFf')) {
                item_selectors.push('#kp-wp-tab-overview > div:not(.HaEtFf), #kp-wp-tab-overview > div.HaEtFf > div');
            }
            else {
                item_selectors.push('#kp-wp-tab-overview > div');
            }
        }

        // Graph items, like stock charts or weather graphs
        item_selectors.push('.osrp-blk > div[data-id="1"]')
        item_selectors.push('.xpdbox')

        // subject line spanning the top of the page
        item_selectors.push('.kp-wholepage-osrp .HdbW6');
        item_selectors.push('#rcnt > .XqFnDf');

        // big info box on top of the page
        // We're considering this as one item, even though it has different cards
        // (this is handled the same for Bing).
        // only class names...
        if (resultpage.querySelectorAll('.M8OgIe').length === 1) {
            item_selectors.push('.WJXODe > div, .e6hL7d > div');
        }

        // big info panel
        //item_selectors.push(':not(#center_col) span[role=tab][data-ti=overview]');

        // ads are elsewhere in the hierarchy and, for a change, conveniently labeled
        item_selectors.push('div[aria-label=Ads] > div');
        item_selectors.push('#atvcap > div');

        // there are also 'featured snippets' which are outside of the usual hierarchy
        if(resultpage.querySelector("a[href*='featured_snippets']") && resultpage.querySelector("a[href*='featured_snippets']").getAttribute('href').indexOf('support.google') > 0) {
            item_selectors.push('#Odp5De');
        }

        // AI answer; contents aren't fetched because they're loaded in later
        item_selectors.push('#eKIzJc')

        // bottom page stuff that's sometimes not in the main tab
        item_selectors.push('#bres')

        // related searches, for which we only have a class name...
        if(resultpage.querySelectorAll('.oIk2Cb').length === 1) {
            // can be both lists and carousels
            item_selectors.push('.oIk2Cb > .FalWJb, .oIk2Cb > .y6Uyqe');
        }

        // Knowledge graph widgets on the right sidebar
        // Some empty/irrelevant divs don't have class names, so only include those that do.
        // We're skipping ads included in the knowledge graph at the moment.
        item_selectors.push('#rhs > div[class], #rhs > block-component');

        const results_selector = item_selectors.join(', ');
        console.log(results_selector)

        // go through results in DOM, using the selectors defined above...
        let result_items = resultpage.querySelectorAll(results_selector);
        if (result_items) {
            let query = decodeURI(path.split('q=')[1].split('&')[0].split('#')[0]);
            const domain_prefix = 'https://' + domain;

            /*results.push({
                id: '----------------------',
                timestamp: '----------------------',
                source: '----------------------',
                query: '----------------------',
                type: '----------------------',
                domain: '----------------------',
                title: '----------------------',
                description: '----------------------',
                link: '----------------------'
            })*/
            for (let item of result_items) {
                let parsed_item = {
                    id: now.format('x') + '-' + index,
                    timestamp: now.format('YYYY-MM-DD hh:mm:ss'),
                    source: domain,
                    query: query,
                    type: 'unknown',
                    domain: '',
                    title: '',
                    description: '',
                    link: ''
                };

                if (item.matches('#rhs')) {
                    // todo: knowledge graph div shouldn't get selected as a whole but does...
                    // Can't figure out how to exclude from the selector list - Sal
                    continue;
                }

                if (item.matches('#fprs') || (item.matches('#taw') && item.querySelector('omnient-visibility-control'))) {
                    // 'did you mean' suggestion box
                    let title = ''
                    if (item.matches('#taw')) {
                        title = safe_prop(item.querySelector('b'), 'innerText').trim();
                    } else {
                        title = safe_prop(item.querySelector('#fprsl'), 'innerText')
                    }
                    parsed_item = {
                        ...parsed_item,
                        type: 'did-you-mean',
                        title: title
                    }
                } else if (item.matches('#eKIzJc')) {
                    // AI answer box. Should be loaded!
                    // todo: add some kind of timeout so this is actually recognised when it's generated.
                    // css selector for when it's loaded: 'div[id][data-q][data-al]'
                    parsed_item = {
                        ...parsed_item,
                        type: 'ai-overview',
                        title: '',
                        description: Array.from(item.querySelectorAll('div[data-lht] > div > div')).map(d => d.innerText).join('\n'),
                        link: Array.from(item.querySelectorAll('#folsrch-sources-1 > div > ul > li > a')).map(d => d.getAttribute('href')).join(','),
                    }
                } else if (item.matches(".HdbW6")) {
                    // page subject
                    let description = ''
                    if (item.querySelector('div[data-attrid=subtitle]')) {
                        description = item.querySelector('div[data-attrid=subtitle]').innerText;
                    } else {
                        description = Array.from(item.querySelectorAll('span[data-ti]')).map(h => h.innerText).join(', ');
                    }
                    parsed_item = {
                        ...parsed_item,
                        type: 'page-subject',
                        title: item.querySelector('div[data-attrid=title]').innerText.trim(),
                        description: description
                    }
                } else if (item.querySelector('.yDIZNe')) {
                    // page entity widget (e.g. the date of an election).
                    // looks like the page subject at the top of the page
                    parsed_item = {
                        ...parsed_item,
                        type: 'page-entity',
                        title: item.querySelector('.xrk1Nb').innerText.trim(),
                        description: item.querySelector('.JKH4td').innerText.trim(),
                    }
                } else if (item.matches('.CYJS5e') || item.matches('.QejDDf')) {
                    // widget info box at top of page
                    parsed_item = {
                        ...parsed_item,
                        type: 'top-info-widget' + subtype,
                        title: Array.from(item.querySelectorAll('div[role=heading], span[role=heading], .pe7FNb')).map(t => safe_prop(t, 'innerText')).join(', '),
                        description: text_from_childless_children(item)
                    }
                } else if (item.querySelector('#sports-app')) {
                    // widget with info about some sports club
                    parsed_item = {
                        ...parsed_item,
                        type: 'sports-widget',
                        title: safe_prop(item.querySelector('div[role=heading]'), 'innerText'),
                        link: safe_prop(item.querySelector('a'), 'attr:href')
                    }
                } else if (item.matches('span[role=tab]')) {
                    // big info widget thing
                    const widget_parent = closest_parent(item, '.XqFnDf');
                    if (widget_parent) {
                        parsed_item = {
                            ...parsed_item,
                            type: 'big-overview-widget',
                            title: widget_parent.querySelector('div[role=heading]').innerText,
                            link: '',
                            description: Array.from(widget_parent.querySelectorAll('span[role=tab]')).map(h => h.innerText).join(', ')
                        }
                    }
                } else if (item.matches('#Odp5De')) {
                    // 'featured snippet' banner
                    parsed_item = {
                        ...parsed_item,
                        type: 'featured-snippet-widget',
                        title: item.querySelector('h3').innerText,
                        link: safe_prop(item.querySelector('span[href]'), 'attr:href'),
                        description: safe_prop(item.querySelector("div[data-attrid='wa:/description']"), 'innerText')
                    }
                } else if (item.parentNode.matches('div[aria-label=Ads]') || item.querySelector('#tvcap') || item.matches('#tvcap') || item.parentNode.matches('#atvcap') || item.matches('#rhsads')) {
                    // ads! for a change, these are marked quite clearly
                    const type = item.querySelector('g-scrolling-carousel') ? 'advertisement-widget' : 'advertisement';
                    let title = safe_prop(item.querySelectorAll('a div[style*=color]'), 'innerText');
                    if (!title) {
                        title = safe_prop(item.querySelector('h3'), 'innerText');
                    }
                    let description = safe_prop(item.querySelector('div[role=heading]'), 'innerText');
                    if (!title && description) {
                        title = description;
                        description = '';
                    }
                    parsed_item = {
                        ...parsed_item,
                        type: type,
                        description: description,
                        title: title,
                        link: safe_prop(item.querySelector('a[data-pcu]'), 'attr:data-pcu').split(',')[0]
                    }
                } else if (item.querySelector('c-wiz')) {
                    // misc widgets (e.g. election maps
                    parsed_item = {
                        ...parsed_item,
                        type: 'misc-widget'
                    }
                } else if (item.querySelector('g-section-with-header') && item.querySelector("a[href*='tbm=nws']")) {
                    // 'top stories', like news but not quite the same?
                    parsed_item = {
                        ...parsed_item,
                        type: 'top-stories-widget',
                        title: safe_prop(item.querySelector('div[role=heading]'), 'innerText'),
                        description: Array.from(item.querySelectorAll('g-section-with-header div[role=heading]')).slice(1).map(h => h.innerText).join(', '),
                        link: domain_prefix + safe_prop(item.querySelector("a[href*='tbm=nws']"), 'attr:href')
                    }
                } else if ((item.querySelector("a[data-url*='/maps/dir/']") && item.querySelector('async-local-kp')) || item.querySelector('#lu_map')) {
                    // a maps widget
                    parsed_item = {
                        ...parsed_item,
                        type: 'maps-widget',
                        title: safe_prop(item.querySelector('h2'), 'innerText'),
                        link: domain_prefix + item.querySelector('a').getAttribute('href')
                    }
                } else if (item.querySelector('product-viewer-group')) {
                    // shopping widget, with related products to buy
                    parsed_item = {
                        ...parsed_item,
                        type: 'shopping-widget',
                        // ffs google, just use normal class names
                        description: Array.from(item.querySelectorAll('li div')).filter(div => div.innerHTML === div.innerText && div.innerText.replace(/\s+/g, '') !== '').map(item => item.innerText).join(', '),
                        title: '',
                        link: ''
                    }
                } else if (item.querySelector('g-section-with-header') && item.querySelector('hr[role=presentation]') && item.querySelector('.gduDCb, .yG4QQe')) {
                    // latest news articles
                    parsed_item = {
                        ...parsed_item,
                        type: 'news-widget',
                        // use list of questions as description
                        description: Array.from(item.querySelectorAll('div[role=heading]')).slice(1).map(h => h.innerText).join(', '),
                        title: safe_prop(item.querySelector('div[role=heading]'), 'innerText')
                    }
                } else if (item.querySelector('g-scrolling-carousel') && Array.from(item.querySelectorAll('span')).filter(item => item.innerText === 'Twitter').length > 0) {
                    // a number of recent tweets
                    parsed_item = {
                        ...parsed_item,
                        type: 'twitter-widget',
                        title: safe_prop(item.querySelector('g-link h3'), 'innerText'),
                        link: safe_prop(item.querySelector('cite'), 'innerText')
                    }
                } else if (item.querySelector('g-scrolling-carousel') && Array.from(item.querySelectorAll('span')).filter(item => item.innerText === 'TikTok').length > 0) {
                    // a number of recent tiktok posts
                    parsed_item = {
                        ...parsed_item,
                        type: 'tiktok-widget',
                        title: safe_prop(item.querySelector('h3'), 'innerText'),
                        link: safe_prop(item.querySelector('a'), 'attr:href')
                    }
                } else if (item.querySelector('title-with-lhs-icon a') &&
                    item.querySelector('title-with-lhs-icon a').getAttribute('href').indexOf('tbm=isch') > 0
                ) {
                    // image search widget, showing top image search results
                    parsed_item = {
                        ...parsed_item,
                        type: 'image-widget',
                        link: domain + safe_prop(item.querySelector('title-with-lhs-icon a'), 'attr:href'),
                        title: safe_prop(item.querySelector('h3[role=heading]'), 'innerText')
                    }
                } else if (((item.querySelector('div[role=presentation]') && item.querySelector('cite') && item.querySelector('img[src*=data]')) || item.querySelector("g-more-link a[href*='tbm=vid']")) && !item.querySelector('.kp_wholepage, .kp-wholepage-osrp, .ULSxyf')) {
                    // video widget, showing related videos
                    // Sometimes this selects the whole SERP, so we add some negative selectors above
                    parsed_item = {
                        ...parsed_item,
                        type: 'video-widget',
                        title: safe_prop(item.querySelector('div[role=heading]'), 'innerText'),
                        description: Array.from(item.querySelectorAll('div[role=heading]')).map(video => {
                            // use video titles as description
                            return safe_prop(item.querySelector('span'), 'innerText');
                        }).join(', ')
                    }
                } else if (item.querySelector('.PhiYYd') && item.querySelector('a[href*=youtube]')) {
                    // single large video
                    parsed_item = {
                        ...parsed_item,
                        type: 'single-video-youtube-widget',
                        link: safe_prop(item.querySelector('a'), 'attr:href'),
                        title: safe_prop(item.querySelector('.PhiYYd h3'), 'innerText')
                    }
                } else if (item.querySelector('.related-question-pair')) {
                    // 'related questions'
                    // seems to be LLM-generated, to some extent
                    parsed_item = {
                        ...parsed_item,
                        type: 'related-questions-widget',
                        // use list of questions as description
                        description: Array.from(item.querySelectorAll('.related-question-pair')).map(question => question.getAttribute('data-q')).join(', '),
                        title: safe_prop(item.querySelector('div[role=heading]'), 'innerText')
                    }
                } else if (item.querySelector('.ZsAbe') || (item.querySelector('wp-grid-view') && item.querySelector('.a-no-hover-decoration') && item.querySelector('.ZVHLgc'))) {
                    // 'recommendations'
                    // recommended places to visit (?)
                    parsed_item = {
                        ...parsed_item,
                        type: 'recommended-widget',
                        title: safe_prop(item.querySelector('div[role=heading]'), 'innerText'),
                        link: domain_prefix + safe_prop(item.querySelector("a[href^='/search']:not(.a-no-hover-decoration)"), 'attr:href'),
                        description: Array.from(item.querySelectorAll('a.a-no-hover-decoration')).map(a => a.getAttribute('title')).join(', ')
                    }
                } else if (item.querySelector('div.g') && item.querySelector(selectors.description)) {
                    if (item.querySelector('div[role=complementary]')) {
                        // embedded sidebar item???
                        item.querySelector('div[role=complementary]').remove();
                    }
                    // an actual, organic result!
                    // can either be a simple result or one with some extra stuff, e.g. site links
                    parsed_item['type'] = item.querySelector('g-img') ? 'organic-showcase' : 'organic';
                    if (item.querySelector('div[data-attrid*=description]') && item.querySelector('.xpdopen')) {
                        parsed_item['type'] = 'organic-summary';
                    }
                    let link = ''
                    if (item.querySelector(selectors.title)) {
                        link = safe_prop(item.querySelector(selectors.title).parentNode, 'attr:href')
                    }
                    parsed_item = {
                        ...parsed_item,
                        title: safe_prop(item.querySelector(selectors.title), 'innerText'),
                        link: link,
                        description: safe_prop(item.querySelector(selectors.description), 'innerText')
                    }
                } else if (item.querySelector('div[role=listitem][data-attrid*=books]')) {
                    // books widget...
                    parsed_item = {
                        ...parsed_item,
                        type: 'books-widget',
                        title: safe_prop(item.querySelector('a[role=link]'), 'innerText'),
                        description: Array.from(item.querySelectorAll('div[role=heading]')).map(div => div.innerText.trim()).filter(div => div).join(', ')
                    }
                } else if ((item.querySelector('.gsrt.wp-ms') && item.querySelector('img[data-deferred]') && item.querySelector('div > span > svg[focusable=false]') && item.querySelector('div > a[tabindex="0"]')) && (!item.matches("#rhs") && !closest_parent(item, '#rhs'))) {
                    // places to visit widget...
                    parsed_item = {
                        ...parsed_item,
                        type: 'recommended-places-widget',
                        title: safe_prop(item.querySelector('div[aria-level="2"][role=heading]'), 'innerText'),
                        description: Array.from(item.querySelectorAll('div[role=heading][aria-level="2"]')).map(div => div.innerText.trim()).filter(div => div).join(', ')
                    }
                } else if(item.querySelector('div[data-item-card][data-attrid*=movies]')) {
                    // movies widget
                    parsed_item = {
                        ...parsed_item,
                        type: 'movies-widget',
                        title: safe_prop(item.querySelector('a[role=link]'), 'innerText'),
                        description: Array.from(item.querySelectorAll('div[role=heading]')).map(div => div.innerText.trim()).filter(div => div).join(', ')
                    }
                } else if (item.querySelector("div[data-attrid*='music/recording']")) {
                    // movies widget
                    parsed_item = {
                        ...parsed_item,
                        type: 'music-recording-widget',
                        title: safe_prop(item.querySelector('a[role=link]'), 'innerText'),
                        description: Array.from(item.querySelectorAll('div.title')).map(div => div.parentNode.innerText.trim()).filter(div => div).join(', ')
                    }
                } else if (item.querySelector('div[role=listitem][data-attrid*=downwards]')) {
                    // 'near me' widget... kind of weird
                    parsed_item = {
                        ...parsed_item,
                        type: 'near-me-widget',
                        title: safe_prop(item.querySelector('a[role=link]'), 'innerText'),
                        description: Array.from(item.querySelectorAll('div[role=heading]')).map(div => div.innerText.trim()).filter(div => div).join(', ')
                    }
                } else if (item.querySelector('div[data-async-type=finance_wholepage_chart]')) {
                    // stock chart
                    parsed_item = {
                        ...parsed_item,
                        type: 'stock-chart',
                        description: Array.from(item.querySelectorAll('g-card-section[class] > div')).map(div => div.innerText.trim()).join(', ')
                    }
                } else if (item.matches('.xpdbox')) {
                    // dictionary widget
                    parsed_item = {
                        ...parsed_item,
                        type: 'dictionary-widget',
                        title: safe_prop(item.querySelector('.data-attrid[EntryHeader]'), 'innerText'),
                        description: text_from_childless_children(item.querySelector('.lr_container > div[jsslot]'), 'innerText'),
                    }
                } else if (item.querySelector('.wob_df[data-wob-di][tabindex]')) {
                    // weather chart
                    parsed_item = {
                        ...parsed_item,
                        type: 'weather-chart',
                        description: Array.from(item.querySelectorAll('g-card-section[class] > div')).map(div => div.innerText.trim()).join(', ')
                    }
                } else if(item.querySelector("div[data-attrid*='music/artist:songs']")) {
                    parsed_item = {...parsed_item,
                        type: 'song-widget',
                        title: safe_prop(item.querySelector('a[role=link]'), 'innerText'),
                        description: Array.from(item.querySelectorAll('div.title')).map(div => div.parentNode.innerText.trim()).filter(div => div).join(', ')
                    }
                } else if (item.querySelector('.oIk2Cb')) {
                    // alas, class names
                    // related searches at the bottom
                    // related searches can be in a list or in a carousel
                    // get description for both
                    let description = Array.from(item.querySelectorAll('div')).filter(div => !div.querySelector('span, div')).map(div => div.innerText.trim()).filter(div => div.length)

                    if (item.querySelector('div[aria-level][aria-hidden][role=heading]')) {
                        const tab_texts = Array.from(item.querySelectorAll('div[aria-level][aria-hidden][role=heading]')).map(a => a.innerText.trim())
                        description = description.concat(tab_texts)
                    }
                    if (item.querySelector('.b2Rnsc')) {
                        const list_texts = Array.from(item.querySelectorAll('.b2Rnsc')).map(div => div.innerText.trim())
                        description = description.concat(list_texts)
                    }
                    description = description.join(', ')

                    parsed_item = {
                        ...parsed_item,
                        type: 'related-queries-widget',
                        title: safe_prop(item.querySelector('div[role=heading]'), 'innerText'),
                        description: description
                    }
                } else if (item.querySelector('a[data-ti*=lyrics]')) {
                    parsed_item = {
                        ...parsed_item,
                        type: 'lyrics-widget',
                        title: safe_prop(item.querySelector('a[role=link]'), 'innerText'),
                        description: Array.from(item.querySelectorAll('div[jsname] > span')).map(div => div.innerText.trim()).filter(div => div).join(', ')
                    }
                } else if (item.querySelector("div[data-attrid*='kc:/']")) {
                    // generic semantic web widget
                    // use semantic reference type as widget type
                    const type = item.querySelector("div[data-attrid*='kc:/']").getAttribute('data-attrid').split(':')[1].replace(/\//g, '-').substring(1) + '-widget';

                    // test if actually in result list
                    let attr_div = item.querySelector("div[data-attrid*='kc:/']");
                    let is_complementary = false;
                    while (attr_div) {
                        if (attr_div.parentElement && attr_div.parentElement.matches('*[role=complementary]')) {
                            is_complementary = true;
                            break;
                        }
                        attr_div = attr_div.parentElement;
                    }

                    if (is_complementary) {
                        // breakout panel to the side, ignore
                        continue;
                    }

                    parsed_item = {
                        ...parsed_item,
                        type: type,
                        title: safe_prop(item.querySelector('a[role=link]'), 'innerText'),
                        description: Array.from(item.querySelectorAll('div[role=heading]')).map(div => div.innerText.trim()).filter(div => div).join(', ')
                    }
                } else if (item.querySelector('div[data-viewer-entrypoint]') && item.querySelector('#iur')) {
                    // image carousel
                    parsed_item = {
                        ...parsed_item,
                        type: 'big-image-carousel',
                        title: safe_prop(item.querySelector('div[role=heading]'), 'innerText')
                    }
                } else if (item.matches('.FalWJb') || item.querySelector('div[role=list] > div > div[role=listitem] div[aria-level="3"][role=heading]')) {
                    // carousel of related searches above regular list
                    const related_searches = Array.from(item.querySelectorAll('div[aria-level="3"][role=heading]')).map(div => div.innerText.trim()).join(', ')

                    // May be absent
                    let title = ''
                    if (item.querySelector('div[aria-level="2"][role=heading]')) {
                        title = item.querySelector('div[aria-level="2"][role=heading]').innerText.trim();
                    }

                    parsed_item = {
                        ...parsed_item,
                        type: 'related-queries-carousel',
                        title: title,
                        description: related_searches
                    }
                } else if (item.matches('.y6Uyqe')) {
                    // alas, class names
                    // related searches at the bottom
                    let related_searches = Array.from(item.querySelectorAll('.dg6jd')).map(div => div.innerText.trim()).join(', ')

                    parsed_item = {
                        ...parsed_item,
                        type: 'related-queries',
                        title: '',
                        description: related_searches
                    }
                } else if (item.matches('.oIk2Cb')) {
                    // skip related search wrapper
                    continue
                } else if (item.querySelector('.osrp-blk')) {
                    // wiki knowledge graph on the right
                    parsed_item = {
                        ...parsed_item,
                        type: 'wiki-widget',
                        title: item.querySelector('div[data-attrid=title]').innerText,
                        description: item.querySelector('div.kno-rdesc > span').innerText
                    }
                } else if (item.querySelector('block-component') && closest_parent(item, '#rhs')) {
                    // Semantic box with 'results for'; same as 'organic showcase'
                    parsed_item = {
                        ...parsed_item,
                        type: 'organic-showcase',
                        title: item.querySelector('h2[data-attrid=title]').innerText.trim(),
                        description: item.querySelector('div[lang][data-md]').innerText.trim(),
                    }
                } else if (item.querySelector("div[data-attrid*='kc:/']")) {
                    // generic semantic web widget.
                    // use semantic reference type as widget type.
                    // These can also appear in the Knowledge graph.
                    const type = item.querySelector("div[data-attrid*='kc:/']").getAttribute('data-attrid').split(':')[1].replace(/\//g, '-').substring(1) + '-widget';
                    let title = ''
                    let description = ''

                    // Semantic widgets can be in the right-hand knowledge graph as well.
                    // these are parsed slightly differently.
                    if (closest_parent(item, '#rhs')) {
                        title = Array.from(item.querySelectorAll('div[role=heading]')).map(div => div.innerText.trim()).filter(div => div).join(', ');

                        // Image list / carousel
                        if (item.querySelector('div[role=list] > div > div[role=listitem]')) {
                            description = Array.from(item.querySelectorAll('div[aria-level="3"][role=heading]')).map(div => div.innerText.trim()).join(', ')
                        }
                        // Else just try to get the text of chlidless children
                        else {
                            description = text_from_childless_children(item).replace(title, '').trim();
                        }
                    }
                    else {
                        title = safe_prop(item.querySelector('a[role=link]'), 'innerText')
                        description = Array.from(item.querySelectorAll('div[role=heading]')).map(div => div.innerText.trim()).filter(div => div).join(', ')
                    }
                    if (description.length === 0) {
                        description = text_from_childless_children(item)
                    }
                    parsed_item = {
                        ...parsed_item,
                        type: type,
                        title: title,
                        description: description
                    }
                } else {
                    // unrecognised result type
                    // consider logging and fixing...!
                    console.log('unknown', item)
                    if (!has_content(item)) {
                        console.log('empty item, skipping for now')
                    }
                }

                /* DETERMINE SECTION */
                // Right sidebar (usually part of knowledge graph)
                if (closest_parent(item, '#rhs')) {
                    parsed_item['section'] = 'sidebar-right';
                }
                // Top
                else if (closest_parent(item, '#center_col') ) {
                    parsed_item['section'] = 'main';
                }
                else {
                    // everything that's not in #center_col or #rhs is at the top
                    parsed_item['section'] = 'top';
                }


                parsed_item['domain'] = parsed_item['link'].indexOf('http') === 0 ? parsed_item['link'].split('/')[2] : '';
                index += 1;

                // Sidebar items are sometimes interspersed with main SERP items.
                // Add them at the end to keep the ranking in place.
                if (parsed_item['section'] === 'sidebar-right') {
                    results_sidebar.push(parsed_item);
                }
                else {
                    results.push(parsed_item);
                }
            }
        }

        results = results.concat(results_sidebar)
        return results;

    }
);