zoekplaatje.register_module(
    'Google',
    'google.com',
    function (response, source_platform_url, source_url, nav_index) {
        let results = [];

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

        function text_from_childless_children(container) {
            let text = '';
            // no headers or script tags
            const valid_tags = ['a', 'div', 'span', 'p'];

            function traverse(node) {
                if (!node.hasChildNodes()) {
                    if (node.nodeType === node.TEXT_NODE && valid_tags.includes(node.parentNode.tagName.toLowerCase())) {
                         text += node.textContent.trim() + ' ';
                    }
                } else {
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
        item_selectors.push('#fprs');

        // first figure out how to get the results
        // this changes unfortunately, so not trivial
        if(from_page) {
            item_selectors.push('#center_col #rso > div');
        } else {
            item_selectors.push('body > div > div:not(#tvcap)');
        }

        if(resultpage.querySelector('wholepage-tab-history-helper, .kp-wholepage-osrp')) {
            // the page has 'tabs', which doesn't seem to make any visual
            // difference, but the structure is totally different
            item_selectors.push('#search > div > #rso #kp-wp-tab-overview > div');
        }

        // subject line spanning the top of the page
        item_selectors.push('.kp-wholepage-osrp');

        // widgets in info box on top of the page
        // only class names...
        if(resultpage.querySelectorAll('.M8OgIe').length === 1) {
            item_selectors.push('.WJXODe > div, .e6hL7d > div');
        }

        // big info panel
        item_selectors.push(':not(#center_col) span[role=tab][data-ti=overview]');

        // ads are elsewhere in the hierarchy and, for a change, conveniently
        // labeled
        item_selectors.push('div[aria-label=Ads] > div');
        item_selectors.push('#atvcap > div');

        // there are also 'featured snippets' which are outside of the usual
        // hierarchy
        if(resultpage.querySelector("a[href*='featured_snippets']") && resultpage.querySelector("a[href*='featured_snippets']").getAttribute('href').indexOf('support.google') > 0) {
            item_selectors.push('#Odp5De');
        }

        // and related searches, for which we only have a class name...
        if(resultpage.querySelectorAll('.oIk2Cb').length === 1) {
            item_selectors.push('.oIk2Cb');
        }

        const results_selector = item_selectors.join(', ');
        console.log(results_selector)
        // go through results in DOM, using the selectors defined above...
        let result_items = resultpage.querySelectorAll(results_selector);
        if(result_items) {
            let query = decodeURI(path.split('q=')[1].split('&')[0].split('#')[0]);
            const domain_prefix = 'https://' + domain;

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


                // we have many different result types to deal with here
                if (item.matches('#fprs')) {
                    // 'did you mean' suggestion box
                    parsed_item = {
                        ...parsed_item,
                        type: 'did-you-mean',
                        title: safe_prop(item.querySelector('#fprsl'), 'innerText')
                    }
                } else if (item.matches('.CYJS5e') || item.matches('.QejDDf')) {
                    // widget info box at top of page
                    parsed_item = {
                        ...parsed_item,
                        type: 'big-overview-widget',
                        title: safe_prop(item.querySelector('div[role=heading], span[role=heading], .pe7FNb'), 'innerText'),
                        description: text_from_childless_children(item)
                    }
                } else if(item.querySelector('#sports-app')) {
                    // widget with info about some sports club
                    parsed_item = {
                        ...parsed_item,
                        type: 'sports-widget',
                        title: safe_prop(item.querySelector('div[role=heading]'), 'innerText'),
                        link: safe_prop(item.querySelector('a'), 'attr:href')
                    }
                } else if(item.matches('span[role=tab]')) {
                    // big info widget thing
                    const widget_parent = closest_parent(item, '.XqFnDf');
                    if(widget_parent) {
                        parsed_item = {
                            ...parsed_item,
                            type: 'big-overview-widget',
                            title: widget_parent.querySelector('div[role=heading]').innerText,
                            link: '',
                            description: Array.from(widget_parent.querySelectorAll('span[role=tab]')).map(h => h.innerText).join(', ')
                        }
                    }
                } else if(item.matches('#Odp5De')) {
                    // 'featured snippet' banner
                    parsed_item = {...parsed_item,
                        type: 'featured-snippet-widget',
                        title: item.querySelector('h3').innerText,
                        link: safe_prop(item.querySelector('span[href]'), 'attr:href'),
                        description: safe_prop(item.querySelector("div[data-attrid='wa:/description']"), 'innerText')
                    }
                } else if(item.parentNode.matches('div[aria-label=Ads]') || item.matches('#tvcap') || item.parentNode.matches('#atvcap')) {
                    // ads! for a change, these are marked quite clearly
                    const type = item.querySelector('g-scrolling-carousel') ? 'advertisement-widget' : 'advertisement';
                    let title = safe_prop(item.querySelectorAll('a div[style*=color]'), 'innerText');
                    if(!title) {
                        title = safe_prop(item.querySelector('h3'), 'innerText');
                    }
                    let description = safe_prop(item.querySelector('div[role=heading]'), 'innerText');
                    if(!title && description) {
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
                } else if(item.querySelector('g-section-with-header') && item.querySelector("a[href*='tbm=nws']")) {
                    // 'top stories', like news but not quite the same?
                    parsed_item = {...parsed_item,
                        type: 'top-stories-widget',
                        title: safe_prop(item.querySelector('div[role=heading]'), 'innerText'),
                        description: Array.from(item.querySelectorAll('g-section-with-header div[role=heading]')).slice(1).map(h => h.innerText).join(', '),
                        link: domain_prefix + safe_prop(item.querySelector("a[href*='tbm=nws']"), 'attr:href')
                    }
                } else if(item.querySelector("a[data-url*='/maps/dir/']") && item.querySelector('async-local-kp')) {
                    // a maps widget with related locations
                    parsed_item = {
                        ...parsed_item,
                        type: 'maps-widget',
                        title: safe_prop(item.querySelector('h2'), 'innerText'),
                        link: domain_prefix + item.querySelector('a').getAttribute('href')
                    }
                } else if(item.querySelector('product-viewer-group')) {
                    // shopping widget, with related products to buy
                    parsed_item = {
                        ...parsed_item,
                        type: 'shopping-widget',
                        // ffs google, just use normal class names
                        description: Array.from(item.querySelectorAll('li div')).filter(div => div.innerHTML === div.innerText && div.innerText.replace(/\s+/g, '') !== '').map(item => item.innerText).join(', '),
                        title: '',
                        link: ''
                    }
                } else if(item.querySelector('g-section-with-header') && item.querySelector('hr[role=presentation]') && item.querySelector('.gduDCb')) {
                    // latest news articles
                    parsed_item = {
                        ...parsed_item,
                        type: 'news-widget',
                        // use list of questions as description
                        description: Array.from(item.querySelectorAll('div[role=heading]')).slice(1).map(h => h.innerText).join(', '),
                        title: safe_prop(item.querySelector('div[role=heading]'), 'innerText')
                    }
                } else if(item.querySelector('g-scrolling-carousel') && Array.from(item.querySelectorAll('span')).filter(item => item.innerText === 'Twitter').length > 0) {
                    // a number of recent tweets
                    parsed_item = {
                        ...parsed_item,
                        type: 'twitter-widget',
                        title: safe_prop(item.querySelector('g-link h3'), 'innerText'),
                        link: safe_prop(item.querySelector('cite'), 'innerText')
                    }
                } else if(item.querySelector('g-scrolling-carousel') && Array.from(item.querySelectorAll('span')).filter(item => item.innerText === 'TikTok').length > 0) {
                    // a number of recent tiktok posts
                    parsed_item = {
                        ...parsed_item,
                        type: 'tiktok-widget',
                        title: safe_prop(item.querySelector('h3'), 'innerText'),
                        link: safe_prop(item.querySelector('a'), 'attr:href')
                    }
                } else if(item.querySelector('title-with-lhs-icon a') &&
                    item.querySelector('title-with-lhs-icon a').getAttribute('href').indexOf('tbm=isch') > 0
                ) {
                    // image search widget, showing top image search results
                    parsed_item = {
                        ...parsed_item,
                        type: 'image-widget',
                        link: domain + safe_prop(item.querySelector('title-with-lhs-icon a'), 'attr:href'),
                        title: safe_prop(item.querySelector('h3[role=heading]'), 'innerText')
                    }
                } else if((item.querySelector('div[role=presentation]') && item.querySelector('cite') && item.querySelector('img[src*=data]')) || item.querySelector("g-more-link a[href*='tbm=vid']")) {
                    // video widget, showing related videos
                    parsed_item = {
                        ...parsed_item,
                        type: 'video-widget',
                        title: safe_prop(item.querySelector('div[role=heading]'), 'innerText'),
                        description: Array.from(item.querySelectorAll('div[role=heading]')).map(video => {
                            // use video titles as description
                            return safe_prop(item.querySelector('span'), 'innerText');
                        }).join(', ')
                    }
                } else if(item.querySelector('.PhiYYd') && item.querySelector('a[href*=youtube]')) {
                    // single large video
                    parsed_item = {...parsed_item,
                        type: 'single-video-youtube-widget',
                        link: safe_prop(item.querySelector('a'), 'attr:href'),
                        title: safe_prop(item.querySelector('.PhiYYd h3'), 'innerText')
                    }
                } else if(item.querySelector('.related-question-pair')) {
                    // 'related questions'
                    // seems to be LLM-generated, to some extent
                    parsed_item = {
                        ...parsed_item,
                        type: 'related-questions-widget',
                        // use list of questions as description
                        description: Array.from(item.querySelectorAll('.related-question-pair')).map(question => question.getAttribute('data-q')).join(', '),
                        title: safe_prop(item.querySelector('div[role=heading]'), 'innerText')
                    }
                } else if(item.querySelector('wp-grid-view') && item.querySelector('.a-no-hover-decoration') && item.querySelector('.ZVHLgc')) {
                    // 'recommendations'
                    // recommended places to visit (?)
                    parsed_item = {...parsed_item,
                        type: 'recommended-widget',
                        title: safe_prop(item.querySelector('div[role=heading]'), 'innerText'),
                        link: domain_prefix + safe_prop(item.querySelector("a[href^='/search']:not(.a-no-hover-decoration)"), 'attr:href'),
                        description: Array.from(item.querySelectorAll('a.a-no-hover-decoration')).map(a => a.getAttribute('title')).join(', ')
                    }
                } else if(item.querySelector('div.g') && item.querySelector(selectors.description)) {
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
                    parsed_item = {
                        ...parsed_item,
                        title: safe_prop(item.querySelector(selectors.title), 'innerText'),
                        link: safe_prop(item.querySelector(selectors.title).parentNode, 'attr:href'),
                        description: safe_prop(item.querySelector(selectors.description), 'innerText')
                    }
                } else if(item.querySelector('div[role=listitem][data-attrid*=books]')) {
                    // books widget...
                    parsed_item = {
                        ...parsed_item,
                        type: 'books-widget',
                        title: safe_prop(item.querySelector('a[role=link]'), 'innerText'),
                        description: Array.from(item.querySelectorAll('div[role=heading]')).map(div => div.innerText.trim()).filter(div => div).join(', ')
                    }
                } else if(item.querySelector('div[data-item-card][data-attrid*=movies]')) {
                    // movies widget
                    parsed_item = {
                        ...parsed_item,
                        type: 'movies-widget',
                        title: safe_prop(item.querySelector('a[role=link]'), 'innerText'),
                        description: Array.from(item.querySelectorAll('div[role=heading]')).map(div => div.innerText.trim()).filter(div => div).join(', ')
                    }
                } else if(item.querySelector("div[data-attrid*='music/recording']")) {
                    // movies widget
                    parsed_item = {
                        ...parsed_item,
                        type: 'music-recording-widget',
                        title: safe_prop(item.querySelector('a[role=link]'), 'innerText'),
                        description: Array.from(item.querySelectorAll('div.title')).map(div => div.parentNode.innerText.trim()).filter(div => div).join(', ')
                    }
                } else if(item.querySelector('div[role=listitem][data-attrid*=downwards]')) {
                    // 'near me' widget... kind of weird
                    parsed_item = {...parsed_item,
                        type: 'near-me-widget',
                        title: safe_prop(item.querySelector('a[role=link]'), 'innerText'),
                        description: Array.from(item.querySelectorAll('div[role=heading]')).map(div => div.innerText.trim()).filter(div => div).join(', ')
                    }
                } else if(item.querySelector("div[data-attrid*='music/artist:songs']")) {
                    parsed_item = {...parsed_item,
                        type: 'song-widget',
                        title: safe_prop(item.querySelector('a[role=link]'), 'innerText'),
                        description: Array.from(item.querySelectorAll('div.title')).map(div => div.parentNode.innerText.trim()).filter(div => div).join(', ')
                    }
                } else if(item.matches('.oIk2Cb')) {
                    // alas, class names
                    // related searches at the bottom
                    parsed_item = {
                        ...parsed_item,
                        type: 'related-queries-widget',
                        title: safe_prop(item.querySelector('div[role=heading]'), 'innerText'),
                        description: Array.from(item.querySelectorAll('div')).filter(div => !div.querySelector('span, div')).map(div => div.innerText.trim()).filter(div => div.length).join(', ')
                    }
                } else if(item.querySelector('a[data-ti*=lyrics]')) {
                    parsed_item = {
                        ...parsed_item,
                        type: 'lyrics-widget',
                        title: safe_prop(item.querySelector('a[role=link]'), 'innerText'),
                        description: Array.from(item.querySelectorAll('div[jsname] > span')).map(div => div.innerText.trim()).filter(div => div).join(', ')
                    }
                } else if(item.querySelector("div[data-attrid*='kc:/']")) {
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
                } else {
                    // unrecognised result type
                    // consider logging and fixing...!
                    console.log('unrecognised', item)
                    continue;
                }

                /* DETERMINE SECTION */
                // Top
                if (closest_parent(item, '#center_col') ) {
                    parsed_item['section'] = 'main';
                }
                else if (closest_parent(item, '#rhs')) {
                    parsed_item['section'] = 'sidebar-right';
                }
                else {
                    // everything that's not in #center_col or #rhs is at the top
                    parsed_item['section'] = 'top';
                }
                // Right sidebar (usually part of knowledge graph)


                parsed_item['domain'] = parsed_item['link'].indexOf('http') === 0 ? parsed_item['link'].split('/')[2] : '';
                index += 1;
                results.push(parsed_item);
            }
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
        }

        return results;
    }
);