zoekplaatje.register_module(
    'Yandex',
    'yandex.com',
    function (response, source_platform_url, source_url, nav_index) {
        let results = [];

        // source_platform_url = URL in browser
        // source_url = URL of request that is being handled

        // check if google...
        let domain = source_url.split('/')[2];
        if (domain.indexOf('yandex') < 0) {
            return [];
        }

        // we're gonna need these to parse the data
        let path = source_url.split('/').slice(3).join('/');
        let now = moment();
        let index = 1;
        const parser = new DOMParser();
        let resultpage;
        let selectors = {
            results: '#search-result li',
            title: 'h2',
            link: '.OrganicTitle > a',
            description: 'div.TextContainer'
        };

        // check if file contains search results...
        // if so, create a DOM with the results we can query via selectors
        if (path.indexOf('search') === 0 && path.indexOf('text=') > 0 && response.indexOf('<!DOCTYPE html>') >= 0) {
            // original result page
            resultpage = parser.parseFromString(response, 'text/html');

        }

        // go through results in DOM, using the selectors defined above...
        let result_items = resultpage.querySelectorAll(selectors.results);
        if(result_items) {
            let query = decodeURI(path.split('text=')[1].split('&')[0].split('#')[0]);

            for (const item of result_items) {
                let type = 'organic'
                let description = item.querySelector(selectors.description);
                let link;

                // image gallery, basically search results for image search
                if(!description && item.querySelector('.ImagesAjaxLoader')) {
                    type = 'image-widget';
                    description = '';
                    link = item.querySelector('h2 a').getAttribute('href');
                } else {
                    // 'normal' organic results
                    description = item.querySelector(selectors.description).innerText;
                    link = item.querySelector(selectors.link).getAttribute('href');
                }

                // these seem to be organic results, but with some widgets
                // showing e.g. images from the site or in-site links
                if(type === 'organic' && (item.querySelector('.Sitelinks') || item.querySelector('.Scroller-Container'))) {
                    type = 'organic-site-showcase';
                }

                const parsed_item = {
                    'id': now.format('x') + '-' + index,
                    'timestamp': now.format('YYYY-MM-DD hh:mm:ss'),
                    'source': domain,
                    'query': query,
                    'type': type,
                    'title': item.querySelector(selectors.title).innerText,
                    'link': link,
                    'description': description
                };
                index += 1;
                results.push(parsed_item);
            }
        }

        return results;
    }
);