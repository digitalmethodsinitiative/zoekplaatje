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
            let result_items = Array.from(resultpage.querySelectorAll('h3 a[tabindex]')).map(item => item.parentNode.parentNode);
            if(result_items) {
                let query = decodeURI(path.split('q=')[1].split('&')[0].split('#')[0]);
                for (const item of result_items) {
                    if(item.querySelector('h4') !== null) {
                        continue;
                    }
                    let description = Array.from(item.querySelectorAll('span')).filter(item => {
                        return item.parentNode.tagName === 'DIV' && item.parentNode.firstChild === item
                    });
                    const parsed_item = {
                        'id': now.format('x') + '-' + index,
                        'timestamp': now.format('YYYY-MM-DD hh:mm:ss'),
                        'source': domain,
                        'query': query,
                        'title': item.querySelector('h3').innerText,
                        'link': item.querySelector('h3 a').getAttribute('href'),
                        'description': description ? description[0].parentNode.innerText : ''
                    };
                    index += 1;
                    results.push(parsed_item);
                }
            }

        }

        return results;
    }
);