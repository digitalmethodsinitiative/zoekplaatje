zoekplaatje.register_module(
    'DuckDuckGo',
    'duckduckgo.com',
    function (response, source_platform_url, source_url, nav_index) {
        let results = [];

        // source_platform_url = URL in browser
        // source_url = URL of request that is being handled

        // check if DDG...
        let domain = source_url.split('/')[2];
        if (domain.indexOf('duckduckgo.com') < 0) {
            return [];
        }

        // the results are always loaded asyoncronously in d.js
        let path = source_url.split('/').slice(3).join('/');
        if(path.indexOf('d.js') !== 0) {
            return [];
        }

        // get the relevant bit of json out of the javascript file
        let json = response.split('DDG.pageLayout.load(\'d\',')[1].split('}]);')[0] + '}]';
        let payload;
        try {
            payload = JSON.parse(json);
        } catch (e) {
            // unknown format
            return [];
        }

        // parse results
        const now = moment();
        if(payload) {
            let index = 1;
            let query = decodeURI(path.split('q=')[1].split('&')[0].split('#')[0]);
            for(const item of payload) {
                const parsed_item = {
                    'id': now.format('x') + '-' + index,
                    'timestamp': now.format('YYYY-MM-DD hh:mm:ss'),
                    'source': domain,
                    'query': query,
                    'type': 'organic',
                    'title': item['t'],
                    'link': item['c'],
                    'description': item['a']
                };
                index += 1;
                results.push(parsed_item);
            }
        }

        return results;
    }
);