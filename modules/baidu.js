zoekplaatje.register_module(
    'Baidu',
    'baidu.com',
    function (response, source_platform_url, source_url, nav_index) {
        let results = [];

        // source_platform_url = URL in browser
        // source_url = URL of request that is being handled

        // check if search results...
        let domain = source_url.split('/')[2];
        if (domain.indexOf('baidu.com') < 0) {
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
            results: '#content_left > div.result, #content_left > div.result-op, #content_left > .c-group-wrapper',
            title: 'h3',
            link: 'h3 a',
            description: 'span[class*=content-right], .c-span-last'
        };

        // check if file contains search results...
        // if so, create a DOM with the results we can query via selectors
        if (path.indexOf('wd=') > 0) {
            // original result page
            resultpage = parser.parseFromString(response, 'text/html');

            // go through results in DOM, using the selectors defined above...
            let result_items = resultpage.querySelectorAll(selectors.results);
            if(result_items) {
                let query = decodeURI(path.split('wd=')[1].split('&')[0].split('#')[0]);
                for (const item of result_items) {
                    let parsed_item = {
                        'id': now.format('x') + '-' + index,
                        'timestamp': now.format('YYYY-MM-DD hh:mm:ss'),
                        'source': domain,
                        'query': query,
                        'type': 'organic',
                        'title': '',
                        'link': '',
                        'description': ''
                    };

                    if(item.matches('.result')) {
                        // organic result
                        parsed_item = {...parsed_item,
                            title: item.querySelector(selectors.title).innerText,
                            link: item.querySelector(selectors.link).getAttribute('href'),
                            description: item.querySelector(selectors.description).innerText
                        }
                    } else if(item.querySelector('div[class*=video-main-title]')) {
                        // video gallery
                        parsed_item = {...parsed_item,
                            type: 'video-widget',
                            title: item.querySelector('h3').innerText,
                            link: domain + item.querySelector('h3 a').getAttribute('href'),
                            description: Array.from(item.querySelectorAll('div[class*=video-main-title]')).map(video => {
                                return video.querySelector('a').innerText
                            }).join(', ')
                        }
                    } else if(item.matches('div[tpl=recommend_list')) {
                        // 'other people searched for'
                        parsed_item = {
                            ...parsed_item,
                            type: 'suggested-queries',
                            title: item.querySelector('.c-font-medium').innerText,
                            link: '',
                            description: Array.from(item.querySelectorAll('a')).map(link => link.innerText).join(', ')
                        }
                    } else if (item.matches('div[tpl^=dict]')) {
                        // dictionary (common when using english queries ;)
                        parsed_item = {
                            ...parsed_item,
                            type: 'dictionary-widget',
                            title: item.querySelector(selectors.title).innerText,
                            link: item.querySelector(selectors.link).getAttribute('href'),
                            description: item.querySelector('td').innerText
                        }
                    } else if (item.matches('div[tpl*=yl_music_lrc]')) {
                        // ...music lyrics!
                        parsed_item = {
                            ...parsed_item,
                            type: 'music-lyric-widget',
                            title: item.querySelector(selectors.title).innerText,
                            link: item.querySelector(selectors.link).getAttribute('href'),
                            description: item.querySelector('div[class*=lrc-scroll]').innerText
                        }
                    } else if (item.matches('div[tpl*=img_normal]')) {
                        // image gallery
                        parsed_item = {
                            ...parsed_item,
                            type: 'image-widget',
                            title: item.querySelector(selectors.title).innerText,
                            link: item.querySelector(selectors.link).getAttribute('href')
                        }
                    } else if (item.matches("div[mu*='baike.baidu']")) {
                        // baike (baidu encyclopedia) excerpt
                        parsed_item = {
                            ...parsed_item,
                            type: 'baike-wiki-widget',
                            title: item.querySelector(selectors.title).innerText,
                            link: item.querySelector(selectors.link).getAttribute('href')
                        }
                    } else if(item.matches('div[tpl*=tieba_general]')) {
                        // tieba is a baidu-hosted forum
                        parsed_item = {
                            ...parsed_item,
                            type: 'tieba-widget',
                            title: item.querySelector(selectors.title).innerText,
                            link: item.querySelector(selectors.link).getAttribute('href')
                        }
                    } else if(item.matches('div[tpl*=open_source_software')) {
                        // code repositories?
                        parsed_item = {
                            ...parsed_item,
                            type: 'software-widget',
                            title: item.querySelector(selectors.title).innerText,
                            link: item.querySelector(selectors.link).getAttribute('href')
                        }
                    } else if(item.matches('div[tpl*=game-page]')) {
                        // video game info
                        parsed_item = {
                            ...parsed_item,
                            type: 'game-info-widget',
                            title: item.querySelector(selectors.title).innerText,
                            link: item.querySelector(selectors.link).getAttribute('href')
                        }
                    } else if(item.matches('div[tpl*=news-realtime]')) {
                        // news widget
                        parsed_item = {
                            ...parsed_item,
                            type: 'news-widget',
                            title: item.querySelector(selectors.title).innerText,
                            link: item.querySelector(selectors.link).getAttribute('href')
                        }
                    } else if(item.matches('.c-group-wrapper')) {
                        // seems to be used generically
                        parsed_item = {
                            ...parsed_item,
                            type: 'misc-widget',
                            title: item.querySelector('h2, h3, h4, *[class*=title]').innerText,
                            link: item.querySelector('a').getAttribute('href')
                        }
                    } else if(item.matches('div[tpl*=wenda_abstract')) {
                        // wenda seems to be Baidu's AI assistant, basically
                        parsed_item = {
                            ...parsed_item,
                            type: 'wenda-ai-widget',
                            title: item.querySelector('h2, h3, h4, *[class*=title]').innerText,
                            description: item.querySelector('div[class*=short-answer]').innerText,
                            link: item.querySelector('a').getAttribute('href')
                        }
                    } else {
                        console.log(item);
                    }

                    index += 1;
                    results.push(parsed_item);
                }
            }

        }

        return results;
    }
);