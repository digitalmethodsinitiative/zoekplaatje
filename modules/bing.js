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
            results: '#b_results > li',
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
                    const style = getComputedStyle(item);
                    if((style.visibility === 'hidden' || style.display === 'none' || parseInt(style.height) === 0)
                        || item.matches('#mfa_root')
                        || item.matches('.b_pag')
                        || item.matches('.b_adBottom')
                        || item.matches('.b_adMiddle')
                        || item.querySelector('#relatedSearchesLGWContainer')
                        ) {
                        // not results
                        continue;
                    }
                    let parsed_item = {
                        'id': now.format('x') + '-' + index,
                        'timestamp': now.format('YYYY-MM-DD hh:mm:ss'),
                        'source': domain,
                        'query': query,
                        'type': 'organic',
                        'title': '',
                        'link': '',
                        'real_link': '',
                        'description': ''
                    };
                    if(item.matches('.b_ad')) {
                        // advertisement
                        // unfortunately there can be multiple panels of ads
                        // and which ones are visible is decided at render time
                        // *usually* only the top one seems to be visible
                        // so only parse that one
                        parsed_item = {
                            ...parsed_item,
                            type: 'advertisement'
                        }
                        for(const ad of item.querySelectorAll(':scope > ul > li')) {
                            let ad_item = structuredClone(parsed_item);
                            ad_item = {...ad_item,
                                id: now.format('x') + '-' + index,
                                title: ad.querySelector(selectors.title).innerText,
                                link: ad.querySelector(selectors.link).getAttribute('href'),
                                real_link: ad.querySelector(selectors.link_real).innerText,
                                description: ad.querySelector(selectors.description).innerText
                            }
                            index += 1;
                            results.push(ad_item);
                        }
                        continue;
                    } else if(item.matches('.b_nwsAnsTopItem')) {
                        // news overview
                        parsed_item = {
                            ...parsed_item,
                            type: 'news-widget',
                            title: item.querySelector(selectors.title).innerText,
                            link: item.querySelector(selectors.link).getAttribute('href'),
                            real_link: item.querySelector(selectors.link_real).innerText,
                            description: Array.from(item.querySelectorAll('.na_t_news_caption')).map(headline => headline.innerText).join(', '),
                        }
                    } else if(item.matches('.b_imgans')) {
                        parsed_item = {
                            ...parsed_item,
                            type: 'image-widget',
                            title: item.querySelector(selectors.title).innerText,
                            link: item.querySelector(selectors.link).getAttribute('href'),
                            real_link: item.querySelector(selectors.link).getAttribute('href')
                        }
                    } else if(item.matches('.b_vidAns')) {
                        parsed_item = {
                            ...parsed_item,
                            type: 'video-widget',
                            title: item.querySelector(selectors.title).innerText,
                            link: item.querySelector(selectors.link).getAttribute('href'),
                            real_link: item.querySelector(selectors.link).getAttribute('href')
                        }
                    } else if(item.matches('.b_ans.b_mop') && item.querySelector('.df_alaskcarousel')) {
                        parsed_item = {
                            ...parsed_item,
                            type: 'related-questions',
                            title: item.querySelector('.b_primtxt').innerText,
                            description: Array.from(item.querySelectorAll('.df_qntext')).map(question => question.innerText).join(', '),

                        }
                    } else if(item.matches('.b_ans.b_mop') && item.querySelector('.sto_slides')) {
                        // crazy ai-generated slide show
                        parsed_item = {
                            ...parsed_item,
                            type: 'ai-generated-story',
                            title: item.querySelector('.sto_title').innerText,
                            description: Array.from(item.querySelectorAll('.sto_snippet')).map(snippet => snippet.innerText).join(' '),
                        }
                    } else if(item.matches('.b_ans.b_mop') && item.querySelector('#placeAnswer')) {
                        // 'travel info', info about a geographic location
                        parsed_item = {
                            ...parsed_item,
                            type: 'travel-widget',
                            title: item.querySelector('.hdr_ttl_lnk').innerText,
                            description: item.querySelector('.cityDesc1').innerText

                        }
                    } else if(item.matches('.b_algo')) {
                        // organic result
                        let type = 'organic';
                        if(item.matches('.b_vtl_deeplinks')
                            || item.querySelector('.rcimgcol')
                            || item.querySelector('.b_divsec')
                        ) {
                            type = 'organic-showcase'
                        } else if (item.matches('.b_algoBigWiki')) {
                            type = 'organic-wiki-showcase'
                        }

                        let description = item.querySelector(selectors.description);
                        if(description) {
                            description = description.innerText;
                        } else if (item.querySelector('.b_vList li')) {
                            description = item.querySelector('.b_vList li').innerText
                        } else {
                            description = '';
                        }
                        parsed_item = {
                            ...parsed_item,
                            type: type,
                            title: item.querySelector(selectors.title).innerText,
                            link: item.querySelector(selectors.link).getAttribute('href'),
                            real_link: item.querySelector(selectors.link_real).innerText,
                            description: description
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