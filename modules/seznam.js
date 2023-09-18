zoekplaatje.register_module(
    'Seznam',
    'seznam.cz',
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
        let selectors = {
            results: '*[data-e-b-z=main] > div > div > div:not(.ResultContainer):not(.zboziProductList)',
            title: 'h3',
            link: 'h3 a',
            description: 'div.c8774a'
        };

        // check if file contains search results...
        // if so, create a DOM with the results we can query via selectors
        if (path.indexOf('q=') > 0) {
            // original result page
            resultpage = parser.parseFromString(response, 'text/html');

            // go through results in DOM, using the selectors defined above...
            let result_items = resultpage.querySelectorAll(selectors.results);
            if(result_items) {
                let query = decodeURI(path.split('q=')[1].split('&')[0].split('#')[0]);
                for (const item of result_items) {
                    if(item.querySelector('h4') !== null) {
                        continue;
                    }
                    const parsed_item = {
                        'id': now.format('x') + '-' + index,
                        'timestamp': now.format('YYYY-MM-DD hh:mm:ss'),
                        'source': domain,
                        'query': query,
                        'title': item.querySelector(selectors.title).innerText,
                        'link': item.querySelector(selectors.link).getAttribute('href'),
                        'description': item.querySelector(selectors.description).innerText
                    };
                    index += 1;
                    results.push(parsed_item);
                }
            }

        }

        return results;
    }
);