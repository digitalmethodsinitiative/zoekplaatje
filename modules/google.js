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
        let selectors = {
            results: '#rso > div',
            title: 'h3',
            link: 'span > a',
            description: 'div.VwiC3b, div.ITZIwc',  // ugh :(
        };

        // check if file contains search results...
        // if so, create a DOM with the results we can query via selectors
        if (path.indexOf('search') === 0 && path.indexOf('q=') > 0 && response.indexOf('<!doctype html>') >= 0) {
            // original result page
            resultpage = parser.parseFromString(response, 'text/html');

        } else if (path.indexOf('search') === 0 && response.indexOf(')]}\'') === 0) {
            // scroll-loaded extra results
            const html = '<div' + response.split('<div').slice(1).join('<div').split('</div>').slice(0, -1).join('</div>') + '</div>';
            resultpage = parser.parseFromString(html, 'text/html');

            // slight difference...
            selectors.results = 'body > div > div';
        } else {
            return [];
        }

        // go through results in DOM, using the selectors defined above...
        let result_items = resultpage.querySelectorAll(selectors.results);
        if(result_items) {
            let query = decodeURI(path.split('q=')[1].split('&')[0].split('#')[0]);

            for (const item of result_items) {
                let parsed_item = {
                    id: now.format('x') + '-' + index,
                    timestamp: now.format('YYYY-MM-DD hh:mm:ss'),
                    source: domain,
                    query: query,
                    type: 'unknown',
                    title: '',
                    description: '',
                    link: ''
                };
                // we have a couple of different result types to deal with here
                // first, 'normal' organic results (a threatened species)
                if(item.querySelector('div.g') && item.querySelector(selectors.description)) {
                    parsed_item['type'] = item.querySelector('g-img') ? 'organic-showcase' : 'organic';
                    parsed_item = {
                        ...parsed_item,
                        title: item.querySelector(selectors.title).innerText,
                        link: item.querySelector(selectors.link).getAttribute('href'),
                        description: item.querySelector(selectors.description).innerText
                    }
                // news carousels
                } else if(item.querySelector('g-section-with-header') && item.querySelector('hr[role=presentation]') && item.querySelector('.gduDCb')) {
                    parsed_item = {...parsed_item,
                        type: 'news-widget',
                        // use list of questions as description
                        description: Array.from(item.querySelectorAll('div[role=heading]')).slice(1).map(h => h.innerText).join(', '),
                        title: item.querySelector('div[role=heading]').innerText
                    }
                // image carousels
                } else if(item.querySelector('g-scrolling-carousel') || (
                    item.querySelector('div[data-lpage]') &&
                    item.querySelector('div[data-ref-docid]')
                ) || (
                    item.querySelector('title-with-lhs-icon a') &&
                    item.querySelector('title-with-lhs-icon a').getAttribute('href').indexOf('tbm=isch') > 0
                )) {
                    parsed_item = {
                        ...parsed_item,
                        type: 'image-widget',
                        link: domain + item.querySelector('title-with-lhs-icon a').getAttribute('href'),
                        title: item.querySelector('div[role=heading]').innerText
                    }
                // video carousels - pretty random set of selectors
                } else if(item.querySelector('div[role=presentation]') && item.querySelector('cite') && item.querySelector('img[src*=data]')) {
                    parsed_item = {
                        ...parsed_item,
                        type: 'video-widget',
                        description: Array.from(item.querySelectorAll('div[role=heading]')).map(video => {
                            // use video titles as description
                            return video.querySelector('span').innerText
                        }).join(', ')
                    }
                // suggested searches
                } else if(item.querySelector('.related-question-pair')) {
                    parsed_item = {...parsed_item,
                        type: 'related-questions',
                        // use list of questions as description
                        description: Array.from(item.querySelectorAll('.related-question-pair')).map(question => question.getAttribute('data-q')).join(', '),
                        title: item.querySelector('div[role=heading]').innerText
                    }
                } else {
                    // unrecognised result type
                    // consider logging and fixing...!
                    continue;
                }
                index += 1;
                results.push(parsed_item);
            }
        }

        return results;
    }
);