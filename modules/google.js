zoekplaatje.register_module(
    'Google',
    'google.com',
    function (response, source_platform_url, source_url) {
        //console.log(response)
        let results = [];
        let results_sidebar = [];

        // source_platform_url = URL in browser
        // source_url = URL of request that is being handled

        // check if google...
        let domain = source_url.split('/')[2];
        if (domain.indexOf('google') < 0) {
            return [];
        }

        // Store gemini responses
        let gemini_response = false
        if (source_url.includes("async/folsrch")) {
            gemini_response = true
        }

        // we're going to need these to parse the data
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
        // todo: class names are more stable than thought, and selectors between e.g. titles and descriptions
        //  overlap too much to make a difference, so re-evaluate if we need this...
        let selectors = {
            title: 'h3',
            link: 'span > a',
            description: 'div.VwiC3b, div.ITZIwc, div.xpdopen div.wDYxhc',  // ugh :(
        };

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
            // Check if the element exists and has content
            if (!el) {
                return false;
            } if (el.textContent.trim() !== "") {
                return true;
            } return el.childNodes.length > 0;
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

        } else if ((path.indexOf('search') === 0 && response.indexOf(')]}\'') === 0) || gemini_response) {
            // scroll-loaded extra results or Gemini response
            const html = '<div' + response.split('<div').slice(1).join('<div').split('</div>').slice(0, -1).join('</div>') + '</div>';
            resultpage = parser.parseFromString(html, 'text/html');
            from_page = false;
        } else {
            return [];
        }

        let item_selectors = [];

        // AI overview parts
        let gemini_selectors = 'span[data-huuid], div[data-subtree="msc"]'

        // 'did you mean' search correction and stuff like SafeSearch; always on top
        item_selectors.push('#oFNiHe');

        // 'app bar' cards on top
        item_selectors.push('#appbar g-scrolling-carousel')

        // first figure out how to get the main search results
        // this changes unfortunately, so not trivial
        if (from_page) {
            // Different types of main search results:
            //  1: A result list with a specific div for the first result and the other results nested afterwards.
            //  2: Results as divs under #kp-wp-tab-overview; this may get moved around
            //  3: An old-school general result list with divs right under #rso
            if (resultpage.querySelector('#center_col #rso > div:not([class])')) {
                item_selectors.push('#center_col #rso > div.hlcw0c') // first result
                item_selectors.push('#center_col #rso > div:not([class]) > div'); // other results
            } else if (resultpage.querySelector('#rso wholepage-tab-history-helper')) {
                // to make matters worse, google sometimes groups organic results between widgets in single divs.
                // here we check whether this is the case by seeing if the #kp-wp-tab-cont-overview has the role of
                // 'tabpanel' and selecting widgets and the organic results (.g divs) individually.
                if (resultpage.querySelector('#kp-wp-tab-cont-overview[role=tabpanel]')) {
                    item_selectors.push('#rso #kp-wp-tab-overview > div:not(:has(.g)), #rso #kp-wp-tab-overview > div:has(.g) > .g');
                } else {
                    // Else we just trust that every div under #kp-wp-tab-overview is a separate result!
                    item_selectors.push('#rso #kp-wp-tab-overview > div');
                }
            } else if (resultpage.querySelectorAll('#rso > div').length > 1) {
                // multiple results under #rso, else we'll fetch the results with the kp-wp-tab selectors
                item_selectors.push('#center_col #rso > div')
            }
        } else if (!gemini_response) {
            item_selectors.push('body > div > div:not(#tvcap)');
        }

        if (resultpage.querySelector('wholepage-tab-history-helper, .kp-wholepage-osrp')) {
            // the page has 'tabs', which may refer to the main results and the knowledge graph.
            // sometimes results are nested, sometimes not...
            // #kp-wp-tab-overview can also be the knowledge graph, to make it even more complicated;
            // knowledge graph and main results often in the same #rso div in the request, and are
            // then splitted in the final HTML.
            if (resultpage.querySelector('#rso #kp-wp-tab-overview > div.HaEtFf')) {
                item_selectors.push('#kp-wp-tab-overview > div:not(.HaEtFf), #kp-wp-tab-overview > div.HaEtFf > div');
                // related searches are sometimes within the main tab section, sometimes not
                // if not, use css selectors directly.
                if(resultpage.querySelectorAll('.oIk2Cb').length === 1) {
                    // can be both lists and carousels
                    item_selectors.push('.oIk2Cb > .FalWJb, #rso .oIk2Cb > .y6Uyqe');
                }
            }
            else if (!item_selectors.includes('#rso #kp-wp-tab-overview > div')) {
                item_selectors.push('#rso #kp-wp-tab-overview > div');
            }
        }

        // Graph items, like stock charts or weather graphs
        item_selectors.push('.osrp-blk > div[data-id="1"]')
        item_selectors.push('.xpdbox')

        // subject line spanning the top of the page
        item_selectors.push('.kp-wholepage-osrp .HdbW6');

        // big info box on top of the page
        // we consider different cards as different items
        if (resultpage.querySelectorAll('.M8OgIe').length === 1) {
            item_selectors.push('.WJXODe > div, .e6hL7d > div');
        }

        // ads are elsewhere in the hierarchy and, for a change, conveniently labeled
        item_selectors.push('div[aria-label=Ads] > div');
        item_selectors.push('#atvcap > div');
        item_selectors.push('#tads div[data-ta-slot]')  // big sponsored first result
        item_selectors.push('.cu-container')            // product cards in knowledge graph

        // there are also 'featured snippets' which are outside of the usual hierarchy
        if(resultpage.querySelector("a[href*='featured_snippets']") && resultpage.querySelector("a[href*='featured_snippets']").getAttribute('href').indexOf('support.google') > 0) {
            item_selectors.push('#Odp5De');
        }

        // bottom page stuff that's sometimes not in the main tab
        item_selectors.push('#bres')

        // Knowledge graph widgets on the right sidebar
        // #rso denotes the main search results, #rhs is the knowledge graph.
        // These are changed in the HTML after, which is a bit confusing.
        if (resultpage.querySelector('#rhs #kp-wp-tab-cont-overview')) {
            // Knowledge graph subject header; slightly different position
            item_selectors.push('#rhs #kp-wp-tab-cont-overview .KsRP6')
            // Different knowledge graph boxes like wikipedia info and images
            // may already be recognised by the #kp-wp-tab selector above
            item_selectors.push('#rhs #kp-wp-tab-overview > div')
        }
        else {
            item_selectors.push('#rhs > div[id], #rhs > block-component');
        }


        const results_selector = item_selectors.join(', ');
        console.log("Selecting items with the following CSS selectors:")
        console.log(results_selector);

        // go through results in DOM, using the selectors defined above...
        let result_items = resultpage.querySelectorAll(results_selector);

        let gemini_text = []
        let gemini_links = []
        let query = ''

        // Manage Gemini responses differently; store data per element, and group later.
        if (gemini_response) {
            let gemini_items = resultpage.querySelectorAll(gemini_selectors);

            for (let gemini_item of gemini_items) {
                if (gemini_item.matches('span[data-huuid]')) {
                    // Gemini text
                    const gemini_text_part = safe_prop(gemini_item, 'innerText')
                    if (gemini_text_part) {
                        gemini_text.push(gemini_text_part)
                    }
                } else if (gemini_item.matches('div[data-subtree="msc"]')) {
                    // Gemini links
                    const gemini_links_tmp = Array.from(gemini_item.querySelectorAll('a')).map(a => a.getAttribute('href').split('#:~:text')[0])
                    if (gemini_links_tmp.length > 0) {
                        gemini_links = gemini_links_tmp  // These are always complete, so we can just store them
                    }
                }
            }
        }

        if (result_items) {
            query = decodeURI(path.split('q=')[1].split('&')[0].split('#')[0]);
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

                // FOR DEBUGGING:
                // for (const item_selector of item_selectors) {
                //     if (item.matches(item_selector.trim())) {
                //         console.log("Found item with selector: " + item_selector)
                //     }
                // }

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

                // todo: for some reason, the whole #rhs knowledge graph side bar gets selected sometimes, probably
                //  because it gets loaded in as a 'correct' sub-element and then moved around later depending on
                //  the viewport? Hard-code a skip for now!
                if (item.matches("#rhs")) {
                    console.log('Skipping #rhs div')
                    continue
                }

                if (item.matches('#oFNiHe') && (item.querySelector('omnient-visibility-control, dynamic-visibility-control'))) {
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
                } else if (item.querySelector('.uzjuFc')) {
                    // "Looks like there aren't any great matches" box
                    parsed_item = {
                        ...parsed_item,
                        type: 'few-matches',
                        title: '',
                        description: text_from_childless_children(item)
                    }
                } else if (item.matches('#oFNiHe') && item.querySelector('div[data-key=filter]')) {
                    // Safe search bar
                    parsed_item = {
                        ...parsed_item,
                        type: 'safe-search'
                    }
                } else if (item.matches('g-scrolling-carousel') && closest_parent(item, '#appbar')) {
                    // suggested topic/search card on top of the page
                    parsed_item = {
                        ...parsed_item,
                        type: 'suggested-topic-card',
                        description: text_from_childless_children(item)
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
                } else if (item.querySelector('#bfsrp')) {
                    // big info panel with a table of information (e.g. 'tips' on how to grow your hair)
                    parsed_item = {
                        ...parsed_item,
                        type: 'big-info-panel',
                        title: item.querySelector('h2 > div:not(class)').innerText + ' ' + item.querySelector('h2 > div[class]').innerText,
                        description: Array.from(item.querySelectorAll('div[data-entityid]')).map(div => div.innerText.trim()).join(', ')
                    }
                } else if (item.matches('.CYJS5e') || item.matches('.QejDDf')) {
                    // info cards at top of page
                    let subtype = '';
                    if (item.querySelector('ol')) {
                        // big image carousel
                        subtype = '-with-carousel';
                    }
                    parsed_item = {
                        ...parsed_item,
                        type: 'info-card' + subtype,
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
                } else if (item.matches('#Odp5De')) {
                    // 'featured snippet' banner
                    parsed_item = {
                        ...parsed_item,
                        type: 'featured-snippet-widget',
                        title: safe_prop(item.querySelector('h3'), 'innerText'),
                        link: safe_prop(item.querySelector('span[href]'), 'attr:href'),
                        description: safe_prop(item.querySelector("div[data-attrid='wa:/description']"), 'innerText')
                    }
                } else if (item.parentNode.matches('div[aria-label=Ads]') || item.querySelector('#tvcap') || item.matches('#tvcap') || item.parentNode.matches('#atvcap') || item.matches('#rhsads') || item.matches('div[data-ta-slot]') || item.matches('.cu-container')) {
                    // ads! for a change, these are marked quite clearly
                    // todo: make different ad types extract titles, descriptions, and links correctly
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
                    // misc widgets (e.g. election maps)
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
                } else if ((((item.querySelector('div[role=presentation]') && item.querySelector('cite')
                    && item.querySelector('img[src*=data]'))
                    || item.querySelector("g-more-link a[href*='tbm=vid']"))
                    && !item.querySelector('.kp_wholepage, .kp-wholepage-osrp, .ULSxyf'))
                    || item.querySelector('div > svg[height="32"]')) {
                    // video widget, showing related videos
                    // Sometimes this selects the whole SERP, so we add some negative selectors above
                    // svg[height="32"] selects the 'play' svg
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
                        type: 'related-questions',
                        // use list of questions as description
                        description: Array.from(item.querySelectorAll('.related-question-pair')).map(question => question.getAttribute('data-q')).join(', '),
                        title: safe_prop(item.querySelector('div[role=heading]'), 'innerText')
                    }
                } else if (item.querySelector('div[role=listitem][data-attrid*=books]')) {
                    // books widget...
                    parsed_item = {
                        ...parsed_item,
                        type: 'books-widget',
                        title: safe_prop(item.querySelector('a[role=link]'), 'innerText'),
                        description: Array.from(item.querySelectorAll('div[role=heading]')).map(div => div.innerText.trim()).filter(div => div).join(', ')
                    }
                // should already be caught by card-list-widget below
                // } else if ((item.querySelector('.gsrt.wp-ms') && item.querySelector('img[data-deferred]') && item.querySelector('div > span > svg[focusable=false]') && item.querySelector('div > a[tabindex="0"]')) && (!item.matches("#rhs") && !closest_parent(item, '#rhs'))) {
                //     // widget with a list of recommendations, e.g. places to visit or songs by an artist
                //     parsed_item = {
                //         ...parsed_item,
                //         type: 'recommended-widget',
                //         title: safe_prop(item.querySelector('div[aria-level="2"][role=heading]'), 'innerText'),
                //         description: Array.from(item.querySelectorAll('div[role=heading][aria-level="2"]')).map(div => div.innerText.trim()).filter(div => div).join(', ')
                //     }
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
                } else if (item.querySelector('div[data-attrid="kc:/business/issuer:stock quote"]')) {
                    // Small stock widget
                    parsed_item = {
                        ...parsed_item,
                        type: 'stock-widget',
                        description: text_from_childless_children(item)
                    }
                } else if (item.querySelector('#tw-ob') || item.querySelector('#tw-gtlink')) {
                    // Translate widget
                    parsed_item = {
                        ...parsed_item,
                        type: 'translate-widget',
                        title: '',
                        description: text_from_childless_children(item)
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
                } else if (item.querySelector('a[data-ti*=lyrics]')) {
                    parsed_item = {
                        ...parsed_item,
                        type: 'lyrics-widget',
                        title: safe_prop(item.querySelector('a[role=link]'), 'innerText'),
                        description: Array.from(item.querySelectorAll('div[jsname] > span')).map(div => div.innerText.trim()).filter(div => div).join(', ')
                    }
                } else if (item.querySelector('div[data-viewer-entrypoint]') && item.querySelector('#iur')) {
                    // image carousel
                    parsed_item = {
                        ...parsed_item,
                        type: 'big-image-carousel',
                        title: safe_prop(item.querySelector('div[role=heading]'), 'innerText')
                    }
                } else if (item.querySelector('.osrp-blk') || item.querySelector('div.kno-rdesc')
                || item.matches('div.kno-rdesc') || item.querySelector('div[data-attrid=VisualDigestDescription]')) {
                    // wiki knowledge graph on the right
                    // sometimes directly selected with div.kno-rdesc, sometimes not.
                    // Can also be in text form or as a 'card'.
                    let title = ''
                    let description = ''
                    // sometimes has a title, sometimes not
                    if (item.querySelector('div[data-attrid=title]')) {
                        title = item.querySelector('div[data-attrid=title]').innerText;
                    }
                    if (item.matches('div.kno-rdesc')) {
                        description = text_from_childless_children(item)
                    } else if (item.querySelector('div[data-attrid=VisualDigestDescription]')) {
                        description = Array.from(item.querySelectorAll('span[data-dtx] > span')).map(span => span.innerText.trim()).join('\n')
                    } else {
                        description = text_from_childless_children(item.querySelector('div.kno-rdesc'))
                    }
                    parsed_item = {
                        ...parsed_item,
                        type: 'wiki-widget',
                        title: title,
                        description: description
                    }
                } else if (item.querySelector('div[data-attrid=ShoppingMerchantFulfillmentSignals]')) {
                    // Shipping widget
                    parsed_item = {
                        ...parsed_item,
                        type: 'shipping-widget',
                        title: '',
                        description: text_from_childless_children(item)
                    }
                } else if (item.querySelector('block-component') && closest_parent(item, '#rhs')) {
                    // Semantic box with 'results for'; same as 'organic showcase'
                    parsed_item = {
                        ...parsed_item,
                        type: 'organic-showcase',
                        title: item.querySelector('h2[data-attrid=title]').innerText.trim(),
                        description: item.querySelector('div[lang][data-md]').innerText.trim(),
                    }
                } else if (item.querySelector('#media_result_group.kno-mrg.kno-swp')) {
                    // images widget in knowledge graph
                    parsed_item = {
                        ...parsed_item,
                        type: 'images-widget'
                    }
                } else if (item.querySelector("div[data-attrid*='kc:/']")) {
                    // generic semantic web widget
                    // use semantic reference type as widget type
                    // can also appear in knowledge graph!
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
                        } else {
                            // Else just try to get the text of chlidless children
                            description = text_from_childless_children(item).replace(title, '').trim();
                        }
                    } else {
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
                } else if (item.querySelector('.oIk2Cb')) {
                    // alas, class names
                    // related searches at the bottom
                    // related searches can be in a list or in a carousel
                    // get description for both
                    let description = Array.from(item.querySelectorAll('div')).filter(div => !div.querySelector('span, div')).map(div => div.innerText.trim()).filter(div => div.length)
                    if (item.querySelector('.b2Rnsc')) {
                        const list_texts = Array.from(item.querySelectorAll('.b2Rnsc')).map(div => div.innerText.trim())
                        description = description.concat(list_texts)
                    }
                    description = description.join(', ')

                    parsed_item = {
                        ...parsed_item,
                        type: 'related-queries',
                        title: safe_prop(item.querySelector('div[role=heading]'), 'innerText'),
                        description: description
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
                } else if (item.querySelector('g-inner-card') || item.querySelector('.ZsAbe') || (item.querySelector('wp-grid-view') && item.querySelector('.a-no-hover-decoration') && item.querySelector('.ZVHLgc')) || item.querySelector('.VqeGe') || (item.querySelector('.gsrt.wp-ms') && item.querySelector('img[data-deferred]') && item.querySelector('div > span > svg[focusable=false]') && item.querySelector('div > a[tabindex="0"]'))) {
                    // generic list of cards, can be many different things
                    parsed_item = {
                        ...parsed_item,
                        type: 'card-list-widget',
                        title: safe_prop(item.querySelector('div[role=heading]'), 'innerText'),
                        link: domain_prefix + safe_prop(item.querySelector("a[href^='/search']:not(.a-no-hover-decoration)"), 'attr:href'),
                        description: Array.from(item.querySelectorAll('a.a-no-hover-decoration')).map(a => a.getAttribute('title')).join(', ')
                    }
                } else if ((item.querySelector('div.g') || item.matches('div.g') || item.querySelector("div[data-rpos] > div[lang]")) && item.querySelector(selectors.description)) {
                    if (item.querySelector('div[role=complementary]')) {
                        // embedded sidebar item???
                        item.querySelector('div[role=complementary]').remove();
                    }
                    // an actual, organic result!
                    // can either be a simple result or one with some extra stuff, e.g. site links.
                    // it may or may also be wrapped in a div with g divs
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
                } else {
                    // unrecognised result type
                    // consider logging and fixing...!
                    console.log('unknown', item)

                    parsed_item = {
                        ...parsed_item,
                        description: text_from_childless_children(item)
                    }
                    console.log(item.textContent.trim())
                    if (!has_content(item)) {
                        console.log('empty item, skipping for now');
                        continue;
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

                if (parsed_item['section'] === 'sidebar-right') {
                    // Sidebar items are sometimes interspersed with main SERP items in response.
                    // Add them at the end to keep the ranking in place.
                    results_sidebar.push(parsed_item);
                } else {
                    results.push(parsed_item);
                }
            }
        }

        // Recompile all results in order of SERP arrangement
        // AI overview content are loaded later, and we have to wait for the responses,
        // so it unfortunately often has to be added later and be positioned as the last item.
        if (gemini_text.length > 0) {
            let result_gemini = [{
                    id: now.format('x') + '-' + index,
                    timestamp: now.format('YYYY-MM-DD hh:mm:ss'),
                    source: domain,
                    query: query,
                    type: 'ai-overview',
                    domain: '',
                    title: '',
                    description: gemini_text.join(" "),
                    link: gemini_links.join(", "),
                    section: 'top'
            }]
            results = result_gemini.concat(results)
        }
        if (results_sidebar) {
            results = results.concat(results_sidebar)
        }

        return results;

    }
);