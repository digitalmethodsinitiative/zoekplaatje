zoekplaatje.register_module(
    'Bing',
    'bing.com',
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
            results: '#b_results > li, #b_topw > li, #b_pole .sva_pole',
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
                        ) {
                        // not results
                        continue;
                    }
                    let parsed_item = {
                        id: now.format('x') + '-' + index,
                        timestamp: now.format('YYYY-MM-DD hh:mm:ss'),
                        source: domain,
                        query: query,
                        type: 'unknown',
                        domain: '',
                        title: '',
                        description: '',
                        real_link: '',
                        link: ''
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
                                description: safe_prop(ad.querySelector(selectors.description), 'innerText')
                            }
                            if(ad_item['link'].indexOf('://') < 0) {
                                ad_item['link'] = 'https://' + ad_item['link'];
                            }
                            ad_item['domain'] = ad_item['real_link'].startsWith('http') ? ad_item['real_link'].split('/')[2] : ad_item['real_link'].split('/')[0];
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
                    } else if(item.matches('.b_vidAns') || item.querySelector('#mm_vidreco_cat')) {
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
                    } else if(item.matches('.b_algo') || item.quer) {
                        // organic result
                        let type = 'organic';
                        if (item.matches('.b_vtl_deeplinks')
                            || item.querySelector('.rcimgcol')
                            || item.querySelector('.b_divsec')
                        ) {
                            type = 'organic-showcase'
                        } else if (item.matches('.b_algoBigWiki')) {
                            type = 'wiki-popout-widget';
                        } else if(item.querySelector('div[class*=b_wikiRichcard]')) {
                            type = 'organic-wiki-widget';
                        }

                        if(item.querySelector('.recommendationsTableTitle')) {
                            type += '-with-explore';
                        }

                        let description = item.querySelector(selectors.description);
                        if (description) {
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
                    } else if(item.querySelector('#relatedSearchesLGWContainer')) {
                        // related searches at the bottom
                        parsed_item = {
                            ...parsed_item,
                            type: 'related-queries-widget',
                            title: safe_prop(item.querySelector('h2'), 'innerText'),
                            description: Array.from(item.querySelectorAll('.b_suggestionText')).map(div => div.innerText.trim()).join(', ')
                        }
                    } else if(item.querySelector('#b_wpt_container')) {
                        parsed_item = {
                            ...parsed_item,
                            type: 'wiki-mega-popout',
                            title: safe_prop(item.querySelector('h2'), 'innerText'),
                            description: safe_prop(item.querySelector('.b_paractl'), 'innerText'),
                            link: safe_prop(item.querySelector('h2 a'), 'attr:href'),
                            real_link: safe_prop(item.querySelector('cite'), 'innerText')
                        }
                    } else if(item.querySelector('div[data-key=GenericMicroAnswer]')) {
                        // generic widget, e.g. for lyrics
                        parsed_item = {
                            ...parsed_item,
                            type: 'fact-widget',
                            title: safe_prop(item.querySelector('.ntro-expTxt-content'), 'innerText'),
                            description: safe_prop(item.querySelector('.ntro_modBody'), 'innerText'),
                            link: safe_prop(item.querySelector('.ntro-algo-text a'), 'attr:href'),
                            real_link: safe_prop(item.querySelector('cite.ntro-algo-attr'), 'innerText')
                        }
                    } else if(item.matches('.b_canvas') && item.querySelector(':scope > a') && item.querySelectorAll(':scope > *').length === 1) {
                        // 'some results witheld' message
                        continue;
                    } else if (item.querySelector('.d_ans .b_vPanel .b_dList')) {
                        parsed_item = {
                            ...parsed_item,
                            type: 'ai-answer-widget',
                            title: safe_prop(item.querySelector('.sh-anchor'), 'innerText'),
                            description: Array.from(item.querySelectorAll('.b_dList li')).map(div => div.innerText.trim()).join(', '),
                            link: '',
                            real_link: '',
                        }
                    } else if (item.querySelector('.df_alaskcarousel')) {
                        parsed_item = {
                            ...parsed_item,
                            type: 'related-questions-carousel',
                            title: safe_prop(item.querySelector('.b_primtxt'), 'innerText'),
                            description: Array.from(item.querySelectorAll('.df_qntext')).map(div => div.innerText.trim()).join(', '),
                            link: '',
                            real_link: '',
                        }
                    } else {
                        console.log(item);
                    }
                    index += 1;
                    parsed_item['real_link'] = !parsed_item['real_link'] || parsed_item['real_link'].indexOf('http') === 0 ? parsed_item['real_link'] : 'https://' + parsed_item['real_link'];
                    parsed_item['domain'] = parsed_item['real_link'].indexOf('http') === 0 ? parsed_item['real_link'].split('/')[2] : parsed_item['real_link'].split('/')[0];
                    results.push(parsed_item);
                }
            }

        }

        return results;
    }
);