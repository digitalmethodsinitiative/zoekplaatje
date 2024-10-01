zoekplaatje.register_module(
    'Marginalia.nu',
    'search.marginalia.nu',
    function (response, source_platform_url, source_url, nav_index) {
        let results = [];

        // source_platform_url = URL in browser
        // source_url = URL of request that is being handled

        // check if search results...
        let domain = source_url.split('/')[2];
        if (source_url.indexOf('search.marginalia.nu//search?query') < 0) {
            console.log(`bad url ${source_url}`)
            return [];
        }

        // we're gonna need these to parse the data
        let now = moment();
        let index = 1;
        const parser = new DOMParser();
        let resultpage;

        // check if file contains search results...
        // if so, create a DOM with the results we can query via selectors
        // original result page
        resultpage = parser.parseFromString(response, 'text/html');

        // go through results in DOM, using the selectors defined above...
        const result_items = resultpage.querySelectorAll('section#results section.search-result')
        if (result_items) {
            const query = decodeURI(source_url).split('search?')[1].split('query=')[1].split('&')[0].split('#')[0];
            for (const item of result_items) {
                let parsed_item = {
                    id: now.format('x') + '-' + index,
                    timestamp: now.format('YYYY-MM-DD hh:mm:ss'),
                    source: domain,
                    query: query,
                    type: 'organic',
                    domain: '',
                    title: item.querySelector('h2 a.title').innerText.trim(),
                    description: item.querySelector('p.description').innerText,
                    link: item.querySelector('.url a').getAttribute('href')
                };
                parsed_item['domain'] = parsed_item['link'].indexOf('http') === 0 ? parsed_item['link'].split('/')[2] : '';
                index += 1;
                results.push(parsed_item);
            }
        }


        return results;
    }
);