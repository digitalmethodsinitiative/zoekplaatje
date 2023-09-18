zoekplaatje.register_module(
    'Bing',
    'bing.com',
    function (response, source_platform_url, source_url, nav_index) {
        let results = [];

        // source_platform_url = URL in browser
        // source_url = URL of request that is being handled

        // check if search results...
        let domain = source_url.split('/')[2];
        if (domain.indexOf('bing.com') < 0) {
            return [];
        }

        // we're gonna need these to parse the data
        let path = source_url.split('/').slice(3).join('/');
        if(path.indexOf('s') !== 0 && path.indexOf('?') !== 1) {
            return [];
        }

        let now = moment();
        let index = 1;
        const parser = new DOMParser();
        let resultpage;
        let selectors = {
            results: 'li.b_algo',
            title: 'h2',
            link: 'h2 a',
            link_real: 'cite',
            description: 'p'
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
                    console.log(item);
                    const parsed_item = {
                        'id': now.format('x') + '-' + index,
                        'timestamp': now.format('YYYY-MM-DD hh:mm:ss'),
                        'source': domain,
                        'query': query,
                        'title': item.querySelector(selectors.title).innerText,
                        'link': item.querySelector(selectors.link).getAttribute('href'),
                        'real_link': item.querySelector(selectors.link_real).innerText,
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