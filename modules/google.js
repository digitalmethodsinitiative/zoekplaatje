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
            results: '#rso > div > div.g',
            title: 'h3',
            link: 'span > a',
            description: 'div.VwiC3b',
            estimate: 'div#result-stats'
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
            selectors.results = 'body > div > div > div.g';
        } else {
            return [];
        }

        // go through results in DOM, using the selectors defined above...
        let result_items = resultpage.querySelectorAll(selectors.results);
        if(result_items) {
            let query = decodeURI(path.split('q=')[1].split('&')[0].split('#')[0]);
            for (const item of result_items) {
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

        return results;
    }
);