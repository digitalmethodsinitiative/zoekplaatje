zoekplaatje.register_module(
    'Seznam',
    'search.seznam.cz',
    function (response, source_platform_url, source_url, nav_index) {
        let results = [];

        // source_platform_url = URL in browser
        // source_url = URL of request that is being handled

        // check if search results...
        let domain = source_url.split('/')[2];
        if (domain.indexOf('search.seznam.cz') < 0) {
            return [];
        }

        // we're gonna need these to parse the data
        let path = source_url.split('/').slice(3).join('/');
        let now = moment();
        let index = 1;
        const parser = new DOMParser();
        let resultpage;

        // check if file contains search results...
        // if so, create a DOM with the results we can query via selectors
        if (path.indexOf('q=') > 0) {
            // original result page
            resultpage = parser.parseFromString(response, 'text/html');

            // go through results in DOM, using the selectors defined above...
            let result_items = resultpage.querySelectorAll('div[data-e-b-z=main] > div')
            if(result_items) {
                // this is tricky...
                // each result is marked with a badge from an SVG, selected
                // from a single SVG file with an arbitrary anchor. some of
                // these are ads but not all. there is no way to know which
                // anchor refers to which without parsing of the SVG (which
                // we don't have). so instead, look for the most common anchor
                // which is probably 'not an ad' and assume the rest are ads
                const badges = Array.from(resultpage.querySelectorAll("div[data-e-b-z=main] > div svg[viewBox] use"))
                    .filter(use =>  {
                        return use.hasAttribute('xlink:href')
                            && use.getAttribute('xlink:href').indexOf('/re/media/sprites/') >= 0
                            && new RegExp('/[abcdef0-9]+\.[abcdef0-9]+\.svg#', 'mg').test(use.getAttribute('xlink:href'))
                    })
                    .map(use => use.getAttribute('xlink:href').split('#')[1]);

                // find most common badge, i.e. for organic results
                let counts = {}
                let organic_badge = '';
                for(const badge of badges) {
                    if(!counts[badge]) {
                        counts[badge] = 0;
                    }
                    counts[badge] += 1;
                    if(!counts[organic_badge] || counts[organic_badge] <= counts[badge]) {
                        organic_badge = badge;
                    }
                }

                let query = decodeURI(path.split('q=')[1].split('&')[0].split('#')[0]);
                for (const item of result_items) {
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

                    if(item.querySelector('h3') && item.querySelector('h3').innerText.indexOf('Obrázky') >= 0) {
                        // image panel
                        parsed_item = {...parsed_item,
                            type: 'image-widget',
                            title: safe_prop(item.querySelector('h3'), 'innerText'),
                            link: domain + safe_prop(item.querySelector('h3 a'), 'attr:href'),
                        }
                    } else if(item.querySelector('h3') && item.querySelector('h3').innerText.indexOf('Videa') >= 0) {
                        // video panel
                        parsed_item = {
                            ...parsed_item,
                            type: 'video-widget',
                            title: safe_prop(item.querySelector('h3'), 'innerText'),
                            link: domain + safe_prop(item.querySelector('h3 a'), 'attr:href'),
                        }
                    } else if(item.querySelector('h3') && item.querySelector('h3').innerText.indexOf('Zprávy') >= 0) {
                        // news panel
                        parsed_item = {
                            ...parsed_item,
                            type: 'news-widget',
                            title: safe_prop(item.querySelector('h3'), 'innerText'),
                            link: domain + safe_prop(item.querySelector('h3 a'), 'attr:href'),
                            description: Array.from(item.querySelectorAll('h4')).map(snippet => snippet.innerText).join(' '),
                        }
                    } else if(item.querySelector('a[data-e-a=help]') && item.querySelector('a[data-e-a=help]').getAttribute('href').indexOf('sumarizace') >= 0) {
                        // video panel
                        parsed_item = {
                            ...parsed_item,
                            type: 'ai-summary',
                            title: safe_prop(item.querySelector('h3'), 'innerText'),
                            description: safe_prop(item.querySelector('p'), 'innerText')
                        }
                    } else if(item.querySelector('.zboziProductList')) {
                        // shopping panel
                        parsed_item = {
                            ...parsed_item,
                            type: 'shopping-widget',
                            title: safe_prop(item.querySelector('h3'), 'innerText'),
                            link: safe_prop(item.querySelector('h3 a'), 'attr:href'),
                        }
                    } else if(item.querySelector('h1') && item.querySelector('h1').innerText.indexOf('Mohlo by') >= 0) {
                        // there are various other sites with widgets...
                        parsed_item = {
                            ...parsed_item,
                            type: 'interesting-questions-widget',
                            title: safe_prop(item.querySelector('h1'), 'innerText'),
                            link: '',
                            description: Array.from(item.querySelectorAll('button')).map(snippet => snippet.innerText).join(' '),
                        }
                    } else if(item.querySelector('.PoiMap')) {
                        parsed_item = {
                            ...parsed_item,
                            type: 'travel-widget'
                        }
                    } else if(item.querySelector('button[role=checkbox]') && item.querySelector('p a').innerText === 'Wikipedia') {
                        parsed_item = {...parsed_item,
                            type: 'wiki-widget',
                            title: safe_prop(item.querySelector('h3'), 'innerText'),
                            link: safe_prop(item.querySelector('p a'), 'attr:href'),
                            description: safe_prop(item.querySelector('p'), 'innerText')
                        }
                    } else if(item.querySelector('.ResultLayout') && item.querySelector('h3 span') && item.querySelector('h3 span').innerText === '›') {
                        // there are various other sites with widgets...
                        parsed_item = {
                            ...parsed_item,
                            type: 'misc-widget',
                            title: safe_prop(item.querySelector('h3'), 'innerText'),
                            link: safe_prop(item.querySelector('h3 a'), 'attr:href'),
                        }
                    } else if(item.querySelector('h4') === null) {
                        // organic ('normal') result
                        let description = Array.from(item.querySelectorAll('span')).filter(item => {
                            return item.parentNode.tagName === 'DIV' && item.parentNode.firstChild === item
                        }).shift();
                        parsed_item = {...parsed_item,
                            type: (!item.querySelector('svg use') || item.querySelector('svg use').getAttribute('xlink:href').indexOf(organic_badge) >= 0) ? 'organic': 'advertisement',
                            title: safe_prop(item.querySelector('h3'), 'innerText'),
                            link: safe_prop(item.querySelector('h3 a'), 'attr:href'),
                            description: description ? safe_prop(description[0], 'innerText') : ''
                        }
                    } else if(item.querySelector('ul') && item.querySelector('ul li a').getAttribute('href').indexOf('http') !== 0) {
                        // related searches at the bottom
                        parsed_item = {
                            ...parsed_item,
                            type: 'related-queries-widget',
                            title: safe_prop(item.querySelector('h4'), 'innerText'),
                            description: Array.from(item.querySelectorAll('li a')).map(div => div.innerText.trim()).join(', ')
                        }
                    } else if(item.querySelector('h3') && item.querySelector('h3').innerText.indexOf('Nejnovější') >= 0) {
                        // news widget
                        parsed_item = {
                            ...parsed_item,
                            type: 'news-widget',
                            title: safe_prop(item.querySelector('h3'), 'innerText'),
                            description: Array.from(item.querySelectorAll('h4')).map(div => div.innerText.trim()).join(', '),
                            link: 'https:' + Array.from(item.querySelectorAll('a')).slice(-1)[0].getAttribute('href')
                        }
                    } else {
                        console.log(parsed_item)
                    }
                    index += 1;
                    parsed_item['domain'] = parsed_item['link'].indexOf('http') === 0 ? parsed_item['link'].split('/')[2] : '';
                    results.push(parsed_item);
                }
            }

        }

        return results;
    }
);