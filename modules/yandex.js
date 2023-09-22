zoekplaatje.register_module(
    'Yandex',
    'yandex.com',
    function (response, source_platform_url, source_url, nav_index) {
        /**
         * Get an HTML element's property, safely
         *
         * Trying to get e.g. the innerText of a non-existing element crashes
         * the script, this makes it return an empty string instead.
         *
         * @param item
         * @param prop
         * @param default_value
         * @returns {*|string}
         */
        function safe_prop(item, prop, default_value='') {
            if(item && prop.indexOf('attr:') === 0 && item.hasAttribute(prop.split('attr:')[1])) {
                return item.getAttribute(prop.split('attr:')[1]);
            } else if(item && prop in item) {
                return item[prop].trim();
            } else {
                return default_value;
            }
        }

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

        // check if file contains search results...
        // if so, create a DOM with the results we can query via selectors
        if (path.indexOf('search') >= 0 && path.indexOf('text=') > 0 && response.indexOf('<!DOCTYPE html>') >= 0) {
            // original result page
            resultpage = parser.parseFromString(response, 'text/html');
        } else {
            return [];
        }

        // go through results in DOM, using the selectors defined above...
        let result_items = resultpage.querySelectorAll('#search-result > li, .RelatedBottom');
        if(result_items) {
            let query = decodeURI(path.split('text=')[1].split('&')[0].split('#')[0]);
            const domain_prefix = 'https://' + domain;

            for (const item of result_items) {
                let parsed_item = {
                    id: now.format('x') + '-' + index,
                    timestamp: now.format('YYYY-MM-DD hh:mm:ss'),
                    source: domain,
                    query: query,
                    type: 'unknown',
                    domain: '',
                    title: '',
                    link: '',
                    description: ''
                };

                if(item.querySelector('.ImagesAjaxLoader')) {
                    parsed_item = {
                        ...parsed_item,
                        type: 'image-widget',
                        title: safe_prop(item.querySelector('h2'), 'innerText'),
                        link: domain_prefix + safe_prop(item.querySelector('h2 a'), 'attr:href')
                    }
                } else if (item.querySelector('.VideoSnippetsList')) {
                    parsed_item = {
                        ...parsed_item,
                        type: 'video-widget',
                        link: domain_prefix + safe_prop(item.querySelector('h2 a'), 'attr:href'),
                        title: safe_prop(item.querySelector('h2'), 'innerText'),
                        description: Array.from(item.querySelectorAll('.organic__title')).map(item => item.innerText.trim()).join(', ')
                    }
                } else if(item.matches('.RelatedBottom')) {
                    // related searches at the bottom
                    parsed_item = {
                        ...parsed_item,
                        type: 'related-queries-widget',
                        title: safe_prop(item.querySelector('h2'), 'innerText'),
                        description: Array.from(item.querySelectorAll('.Related-ButtonTextUp')).map(div => div.innerText.trim()).join(', ')
                    }
                } else {
                    // organic result
                    const type = (item.querySelector('.Sitelinks') || item.querySelector('.Scroller-Container')) ? 'organic-showcase' : 'organic';
                    parsed_item = {
                        ...parsed_item,
                        type: type,
                        title: safe_prop(item.querySelector('h2'), 'innerText'),
                        description: safe_prop(item.querySelector('div.TextContainer'), 'innerText'),
                        link: safe_prop(item.querySelector('.OrganicTitle a'), 'attr:href')
                    }
                }

                index += 1;
                parsed_item['domain'] = parsed_item['link'].indexOf('http') === 0 ? parsed_item['link'].split('/')[2] : '';
                results.push(parsed_item);
            }
        }

        return results;
    }
);