zoekplaatje.register_module(
    'Bing',
    'bing.com',
    function (response, source_platform_url, source_url, nav_index) {
        function closest_parent(node, selector) {
            while(node.parentNode) {
                node = node.parentNode;
                if (node instanceof HTMLElement) {
                    if (node.matches(selector)) {
                        return node;
                    }
                }
            }
            return null;
        }

        function has_content(el) {
            // Check if the element exists
            if (!el) {
                return false;
            } if (el.textContent.trim() !== "") {
                return true;
            } if (el.childNodes.length > 0) {
                return true;
            }
            return false;
        }

        function text_from_childless_children(container) {
            let text = '';
            // no headers or script tags
            const valid_tags = ['a', 'div', 'span', 'p'];
            function traverse(node) {
                if (node && !node.hasChildNodes()) {
                    if (node.nodeType === node.TEXT_NODE && valid_tags.includes(node.parentNode.tagName.toLowerCase())) {
                         text += node.textContent.trim() + ' ';
                    }
                } else if (node) {
                    Array.from(node.childNodes).forEach(child => traverse(child));
                }
            }

            traverse(container);
            return text;
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
            results: '#b_results > li, #b_pole .b_poleContent, #b_pole .sva_pole, .b_wpt_bl, #b_context > li:not(:has(.lite-entcard-blk)), #b_context .lite-entcard-blk',
            title: 'h2',
            link: 'h2 a',
            link_real: 'cite',
            description: 'p'
        };

        console.log("Selecting items with the following CSS selectors:")
        console.log(selectors.results);

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

                    if ((style.visibility === 'hidden' || style.display === 'none' || parseInt(style.height) === 0)
                        || item.matches('#mfa_root')
                        || item.matches('.b_pag')
                        || item.matches('.b_adBottom')
                    ) {
                        // not results
                        console.log("Skipping hidden element:")
                        console.log(item)
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
                    if (item.matches('.b_ad')) {
                        // advertisement
                        // unfortunately there can be multiple panels of ads
                        // and which ones are visible is decided at render time
                        // *usually* only the top one seems to be visible
                        // so only parse that one
                        parsed_item = {
                            ...parsed_item,
                            type: 'advertisement'
                        }
                        for (const ad of item.querySelectorAll(':scope > ul > li')) {
                            let ad_item = structuredClone(parsed_item);
                            ad_item = {
                                ...ad_item,
                                id: now.format('x') + '-' + index,
                                title: ad.querySelector(selectors.title).innerText,
                                link: ad.querySelector(selectors.link).getAttribute('href'),
                                real_link: ad.querySelector(selectors.link_real).innerText,
                                description: safe_prop(ad.querySelector(selectors.description), 'innerText')
                            }
                            if (ad_item['link'].indexOf('://') < 0) {
                                ad_item['link'] = 'https://' + ad_item['link'];
                            }
                            ad_item['domain'] = ad_item['real_link'].startsWith('http') ? ad_item['real_link'].split('/')[2] : ad_item['real_link'].split('/')[0];
                            index += 1;
                            results.push(ad_item);
                        }
                        continue;
                    } else if (item.querySelector('#FinanceCarouselV2')) {
                        // big stock slider on top of the page
                        parsed_item = {
                            ...parsed_item,
                            type: 'stock-slider',
                            title: item.querySelector('a[title] > div').innerText.trim(),
                            description: text_from_childless_children(item)
                        }
                    } else if (item.matches('.b_nwsAns')) {
                        // news overview
                        parsed_item = {
                            ...parsed_item,
                            type: 'news-widget',
                            title: item.querySelector(selectors.title).innerText,
                            link: item.querySelector(selectors.link).getAttribute('href'),
                            real_link: item.querySelector(selectors.link_real).innerText,
                            description: Array.from(item.querySelectorAll('.na_t_news_caption, .na_t')).map(headline => headline.innerText).join(', '),
                        }
                    } else if (item.matches('.b_imgans')) {
                        parsed_item = {
                            ...parsed_item,
                            type: 'image-widget',
                            title: item.querySelector(selectors.title).innerText,
                            link: item.querySelector(selectors.link).getAttribute('href'),
                            real_link: item.querySelector(selectors.link).getAttribute('href')
                        }
                    } else if (item.matches('.b_vidAns') || item.querySelector('#mm_vidreco_cat')) {
                        parsed_item = {
                            ...parsed_item,
                            type: 'video-widget',
                            title: item.querySelector(selectors.title).innerText,
                            link: item.querySelector(selectors.link).getAttribute('href'),
                            real_link: item.querySelector(selectors.link).getAttribute('href')
                        }
                    } else if (item.matches('.b_dictans')) {
                        // dictionary answer
                        // todo: check if this doesn't overwrite related searches
                        parsed_item = {
                            ...parsed_item,
                            type: 'dictionary-widget',
                            title: item.querySelector('.header_pron').innerText,
                            description: Array.from(item.querySelectorAll('.dc_pd')).map(div => div.innerText).join(' '),
                        }
                    } else if (item.matches('.b_ans.b_mop') && item.querySelector('.df_alaskcarousel')) {
                        parsed_item = {
                            ...parsed_item,
                            type: 'related-questions',
                            title: item.querySelector('.b_primtxt').innerText,
                            description: Array.from(item.querySelectorAll('.df_qntext')).map(question => question.innerText).join(', '),

                        }
                    } else if (item.matches('.b_ans') && item.querySelector('.b_rs')) {
                        // Related searches
                        parsed_item = {
                            ...parsed_item,
                            type: 'related-queries',
                            title: item.querySelector('h2').innerText,
                            description: Array.from(item.querySelectorAll('.b_suggestionText')).map(question => question.innerText).join(', '),

                        }
                    } else if (item.querySelector('.richrswrapper')) {
                        // Related searches, but in the side bar--slightly differently formatted
                        parsed_item = {
                            ...parsed_item,
                            type: 'related-queries',
                            title: item.querySelector('h2').innerText.trim(),
                            description: Array.from(item.querySelectorAll('.richrsrailsuggestion')).map(div => div.innerText.trim()).join(', ')
                        }
                    } else if (item.matches('.b_ans') && item.querySelector('.b_rrsr')) {
                        // Related searches in the sidebar
                        parsed_item = {
                            ...parsed_item,
                            type: 'related-queries-sidebar',
                            title: item.querySelector('h2').innerText,
                            description: Array.from(item.querySelectorAll('.suggestion_text')).map(question => question.innerText).join(', '),
                        }
                    } else if (item.matches('.b_ans.b_mop') && item.querySelector('.sto_slides')) {
                        // crazy ai-generated slide show
                        parsed_item = {
                            ...parsed_item,
                            type: 'ai-generated-story',
                            title: item.querySelector('.sto_title').innerText,
                            description: Array.from(item.querySelectorAll('.sto_snippet')).map(snippet => snippet.innerText).join(' '),
                        }
                    } else if (item.matches('.b_richnews')) {
                        // News widget
                        parsed_item = {
                            ...parsed_item,
                            type: 'news-widget',
                            title: item.querySelector('#nws_ht').innerText,
                            description: text_from_childless_children(item),
                            link: Array.from(item.querySelectorAll('a.na_ccw')).map(a => a.getAttribute('href')).join(', ')
                        }
                    } else if (item.querySelector('#financeAnswer')) {
                        // stonks
                        parsed_item = {
                            ...parsed_item,
                            type: 'stock-chart',
                            title: item.querySelector('.b_topTitle').innerText.trim(),
                            description: text_from_childless_children(item)
                        }
                    } else if (item.matches('.b_ans') && item.querySelector('#placeAnswer')) {
                        // 'travel info', info about a geographic location
                        parsed_item = {
                            ...parsed_item,
                            type: 'travel-widget',
                            title: item.querySelector('.hdr_ttl_lnk').innerText,
                            description: item.querySelector('.cityDesc1').innerText
                        }
                    } else if (item.querySelector('.dynMap')) {
                        // Interactive map widget
                        parsed_item = {
                            ...parsed_item,
                            type: 'map-widget',
                            title: safe_prop(item.querySelector('h2'), 'innerText'),
                            description: '',
                            link: safe_prop(item.querySelector('.b_topTitle > a'), 'href'),
                            real_link: '',
                        }
                    } else if (item.matches('.b_ans.b_mop, .b_ans.b_top') &&
                        item.querySelector('#lMapContainer, .b_lmLocal')) {
                        // 'places info', info about hotels or restaurants
                        parsed_item = {
                            ...parsed_item,
                            type: 'places-widget',
                            title: item.querySelector('.b_ilhTitle').innerText,
                            description: Array.from(item.querySelectorAll('.listCard, .lc_content')).map(snippet => snippet.innerText).join(' '),
                        }
                    } else if (item.matches('.b_ans.b_mop') &&
                        item.querySelector('.l_ecrd_carousel')) {
                        // 'hotel info', info about a hotel
                        parsed_item = {
                            ...parsed_item,
                            type: 'carousel',
                            title: item.querySelector('.l_ecrd_mttl').innerText,
                            description: Array.from(item.querySelectorAll('.l_ecrd_itemdata')).map(snippet => snippet.innerText).join(' ')
                        }
                    } else if (item.querySelector('.feeds')) {
                        // Widget with other relevant links
                        parsed_item = {
                            ...parsed_item,
                            type: 'other-links',
                            title: safe_prop(item.querySelector('.feeds_title > h2'), 'innerText'),
                            description: Array.from(item.querySelectorAll('.feeditem_title')).map(link_title => link_title.innerText).join(', ')
                        }
                    } else if (item.matches('.b_ans') && item.querySelector('.b_remod')) {
                        // 'Explore more' tab in the sidebar
                        parsed_item = {
                            ...parsed_item,
                            type: 'explore-more',
                            title: safe_prop(item.querySelector('.b_mgridTitle'), 'innerText'),
                            description: Array.from(item.querySelectorAll('.epv_caption')).map(div => div.innerText.trim()).join(', '),
                            link: '',
                            real_link: '',
                        }
                    } else if (item.matches('.b_algo')) {
                        // organic result
                        let type = 'organic';
                        if (item.matches('.b_vtl_deeplinks')
                            || item.querySelector('.rcimgcol')
                            || item.querySelector('.b_divsec')
                        ) {
                            type = 'organic-showcase'
                        } else if (item.matches('.b_algoBigWiki')) {
                            type = 'wiki-popout-widget';
                        } else if (item.querySelector('div[class*=b_wikiRichcard]')) {
                            type = 'organic-wiki-widget';
                        }

                        if (item.querySelector('.recommendationsTableTitle')) {
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
                    } else if (item.querySelector('#relatedSearchesLGWContainer')) {
                        // related searches at the bottom
                        parsed_item = {
                            ...parsed_item,
                            type: 'related-queries',
                            title: safe_prop(item.querySelector('h2'), 'innerText'),
                            description: Array.from(item.querySelectorAll('.b_suggestionText')).map(div => div.innerText.trim()).join(', ')
                        }
                    } else if (item.matches('.b_wpt_bl')) {
                        // cards in huge expanded widget on top.
                        // we consider these cards as different widgets, like we do for Google.
                        // can include images and videos.
                        let title = '';
                        let description = '';
                        let link = '';
                        let real_link = '';

                        let subtype = '';

                        if (item.querySelector('.b_gwaDlWrapper')) {
                            // main featured result
                            subtype = '-top-result';
                            title = item.querySelector('.b_gwaTitle').innerText.trim();
                            link = item.querySelector('.b_gwaSiteUrl').innerText.trim();
                        } else if (item.querySelector('.b_wpt_bl_bord')) {
                            // ibid
                            subtype = '-top-result';
                            title = item.querySelector('h2 > a').innerText.trim();
                            description = item.querySelector('.b_paractl').innerText.trim();
                            real_link = item.querySelector('.cite').innerText.trim();
                        } else if (item.querySelector('.b_rc_gb_sub_image')) {
                            // one image card
                            subtype = '-image'
                        } else if (item.querySelector('.cliphero')) {
                            // multiple images
                            subtype = '-images';
                        } else if (item.querySelector('a.mc_vtvc_link')) {
                            // video
                            subtype = '-video';
                            title = item.querySelector('.mc_vtvc_title').innerText.trim();
                            link = item.querySelector('a.mc_vtvc_link').getAttribute('href');
                        } else if (item.querySelector('.l_ecrd_stacked')) {
                            // card subdivided with categories
                            subtype = '-categories'
                        }

                        if (!description.length > 0) {
                            description = text_from_childless_children(item).replace(title, '')
                        }

                        parsed_item = {
                            ...parsed_item,
                            type: 'info-card' + subtype,
                            title: title,
                            description: description,
                            link: link,
                            real_link: real_link
                        }
                    } else if (item.querySelector('div[data-key=GenericMicroAnswer]')) {
                        // generic widget, e.g. for lyrics
                        parsed_item = {
                            ...parsed_item,
                            type: 'fact-widget',
                            title: safe_prop(item.querySelector('.ntro-expTxt-content'), 'innerText'),
                            description: safe_prop(item.querySelector('.ntro_modBody'), 'innerText'),
                            link: safe_prop(item.querySelector('.ntro-algo-text a'), 'attr:href'),
                            real_link: safe_prop(item.querySelector('cite.ntro-algo-attr'), 'innerText')
                        }
                    } else if (item.matches('.b_canvas') && item.querySelector(':scope > a') && item.querySelectorAll(':scope > *').length === 1) {
                        // 'some results witheld' message
                        console.log('Skipping "some results withheld" message')
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
                            type: 'related-queries-carousel',
                            title: safe_prop(item.querySelector('.b_primtxt'), 'innerText'),
                            description: Array.from(item.querySelectorAll('.df_qntext')).map(div => div.innerText.trim()).join(', '),
                            link: '',
                            real_link: '',
                        }
                    } else if (item.querySelector('.b_wpTab')) {
                        parsed_item = {
                            ...parsed_item,
                            type: 'page-subject',
                            title: safe_prop(item.querySelector('.ent-dtab-txta'), 'innerText'),
                            description: Array.from(item.querySelectorAll('.ent-dtab-btn')).map(div => div.innerText.trim()).join(', '),
                            link: '',
                            real_link: '',
                        }
                    } else if (item.querySelector('#b_wpt_creator')) {
                        // Copilot answer
                        parsed_item = {
                            ...parsed_item,
                            type: 'copilot-answer',
                            title: '',
                            link: '',
                            real_link: '',
                            description: '',
                        }
                    } else if (item.querySelector('#d_ans')) {
                        // Featured answer extracted from a result page
                        parsed_item = {
                            ...parsed_item,
                            type: 'organic-answer',
                            title: safe_prop(item.querySelector('.df_da'), 'innerText'),
                            link: Array.from(item.querySelectorAll('.site span')).map(el => safe_prop(el, 'title').trim()).join(', '),
                            real_link: safe_prop(item.querySelector('cite'), 'innerText'),
                            description: safe_prop(item.querySelector('.df_con'), 'innerText'),
                        }
                    } else if (item.querySelector('.b_vPanel')) {
                        // Topic card
                        const title = safe_prop(item.querySelector('.title'), 'innerText')
                        parsed_item = {
                            ...parsed_item,
                            type: 'topic-card',
                            title: title,
                            link: '',
                            real_link: '',
                            description: text_from_childless_children(item).replace(title, ''),
                        }
                    } else if (item.matches(".lite-entcard-blk") && item.id.length > 0) {
                        // Different knowledge graph sidebar sections.
                        // Part of the same card but interesting enough to separate.

                        // Dynamically attribute a type based on the element ID.
                        let item_type = ''
                        let item_id = item.id.split("_");
                        item_id = item_id[item_id.length - 1];
                        // Skip irrelevant or empty sections
                        if (item_id === "Footer") {
                            console.log("Skipping Footer element")
                            console.log(item)
                            continue;
                        }
                        else if (item_id === "PlainHero" && (!item.querySelector('.b_snippet, .spl_logoheader'))) {
                            console.log("Skipping header element")
                            console.log(item)
                            continue
                        }
                        // to kebab-case
                        item_type = item_id.replace(/([a-z])([A-Z])/g, '$1-$2').toLowerCase();
                        if (!item_type) {
                            item_type = 'unknown'
                        } else if (item_type === 'plain-hero') {
                            item_type = 'wiki'
                        }
                        else if (item_type === 'qn-a') {
                            item_type = 'quote'
                        }
                        else if (item_type.includes('fact')) {
                            item_type = 'fact'
                        }

                        const title = safe_prop(item.querySelector('h2, h3, .l_ecrd_txt_heros, .l_ecrd_bt_rings_ttl'), 'innerText');
                        // Flexibly get the text content of the knowledge graph components, since these differ quite a
                        // bit. Remove the first occurrence of the title, so we don't include it.
                        let description = ''
                        if (item.querySelector('.l_ecrd_hov_hitbox')) {
                            // Sometimes there's a bunch of hidden text; in this case we only extract the visible quote
                            description = item.querySelector('.l_ecrd_hov_hitbox').innerText.trim();
                        }
                        else {
                            description = text_from_childless_children(item).replace(title, '');
                        }

                        parsed_item = {
                            ...parsed_item,
                            type: 'knowledge-card-' + item_type,
                            title: title,
                            description: description,
                            link: '',
                            real_link: '',
                        }
                    } else if (item.matches('.b_ans') && item.querySelector('.data_module')) {
                        // Misc right sidebar widget
                        parsed_item = {
                            ...parsed_item,
                            type: 'misc-widget',
                            title: safe_prop(item.querySelector('.title_text'), 'innerText'),
                            description: '',
                            link: '',
                            real_link: '',
                        }
                    } else if (item.matches('.b_widgetContainer')) {
                        // Left sidebar index widget, which slides in
                        // Sometimes it's hidden, if so we skip!
                        if (style.visibility==='hidden') {
                            console.log('Skipping hidden slide-in widget')
                            continue
                        }
                        parsed_item = {
                            ...parsed_item,
                            type: 'index-widget',
                            title: safe_prop(item.querySelector('h2'), 'innerText'),
                            description: Array.from(item.querySelectorAll('button, .rel_ent_t')).map(div => div.innerText.trim()).join(', '),
                            link: '',
                            real_link: ''
                        }
                    } else {
                        // unrecognised result type
                        // consider logging and fixing...!
                        console.log('unknown', item)
                        parsed_item = {
                            ...parsed_item,
                            description: text_from_childless_children(item)
                        }
                        if (!has_content(item)) {
                            console.log('empty item, skipping for now');
                            continue;
                        }
                    }

                    /* DETERMINE SECTION */
                    // Left slide-in section
                    if (item.matches('.b_widgetContainer')) {
                        parsed_item['section'] = 'sidebar-left';
                    }
                    // Top
                    else if (closest_parent(item, '#b_topw') || closest_parent(item, '#b_pole') ) {
                        parsed_item['section'] = 'top';
                    }
                    // Right sidebar (usually part of knowledge graph)
                    else if (closest_parent(item, '#b_context')) {
                        parsed_item['section'] = 'sidebar-right';
                    }
                    // Main content
                    else {
                        parsed_item['section'] = 'main';
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