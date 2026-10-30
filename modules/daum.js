/**
 * Daum: integrated search (통합검색) and its next results pages
 *
 * One row for each item on the page. Each row also names its block (a
 * "collection" on Daum): the position of the block on the page (block_rank),
 * its kind (block_type), its element id (block_id) and its heading
 * (block_title). Blocks without items (for example the weather panel) give one
 * row with item_rank 0.
 *
 * Many collections keep their items in a <template> with c-* elements, which
 * the page shows later. A DOMParser does not put the content of a template in
 * the document tree, so the module reads template.content.
 */
(() => {
    // what the page parse learned that a later data request of the same page needs
    const pages = {};
    const remembered_pages = [];

    // collections by element id: the block type, and whether the block is an ad
    const COLLECTIONS = [
        [/^tw[a-z]Coll$/, 'web-results'],
        [/^n0(nl|fl)Coll$/, 'power-links', true],
        [/^n0(ll|kl)Coll$/, 'premium-links', true],
        [/^n0nsColl$/, 'power-shopping', true],
        [/^n0ncColl$/, 'power-content', true],
        [/^n0dlColl$/, 'shortcut', true],
        [/^splinkColl$/, 'special-links', true],
        [/^adSenseColl$/, 'adsense', true],
        [/^dnsColl$/, 'news'],
        [/^voiColl$/, 'videos'],
        [/^musicColl$/, 'music'],
        [/^lb2Coll$/, 'books'],
        [/^ivrColl$/, 'sites'],
        [/^imageColl$/, 'images'],
        [/^shoppingColl$/, 'shopping'],
        [/^poiColl$/, 'places'],
        [/^tgvColl$/, 'donations'],
        [/^ndictionary(Exact)?Coll$/, 'dictionary'],
        [/^totArticleColl$/, 'encyclopedia'],
        [/^netizenColl/, 'related-searches'],
        [/^rtlColl$/, 'trends'],
        [/^randomCategoryColl$/, 'category-keywords'],
        [/^ratThemeColl$/, 'theme-keywords'],
        [/^dskColl$/, 'shopping-keywords'],
        [/^prfColl$/, 'person'],
        [/^pr0Coll$/, 'related-people'],
        [/^aioColl$/, 'ai-summary'],
        [/^z8tColl$/, 'weather'],
        [/^wmdColl$/, 'weather-video'],
        [/^exchangeColl$/, 'exchange-rate'],
        [/^em1Coll$/, 'movie'],
        [/^tvpColl$/, 'tv-program'],
        [/^morColl$/, 'movies'],
        [/^(com|nas)Coll$/, 'stock-price'],
        [/^comRightColl$/, 'related-stocks'],
        [/^worldStockRightColl$/, 'world-markets'],
        [/^jupCurrencyColl$/, 'crypto-price'],
        [/^jupSpellCheckerColl$/, 'spell-checker'],
        [/^lottoColl$/, 'lottery'],
        [/^subwaystationColl$/, 'subway-station'],
        [/^subwayColl$/, 'subway-map'],
        [/^abtColl$/, 'sports-league'],
        [/^sportsWingColl$/, 'other-leagues'],
        [/^tcsColl$/, 'category-search'],
        // other panels of this kind, for example 2026 단풍시기 (jupDBNColl) and the 수능 countdown
        [/^jup\w*Coll$/, 'info-panel']
    ];
    // an element of a collection: the id ends in "Coll", or has a suffix after "Coll_"
    const COLLECTION = '[id$="Coll"], [id*="Coll_"]';
    const DATE = /^(\d{4}\.\s?\d{1,2}\.\s?\d{1,2}\.?|\d+\s*(초|분|시간|일|주|개월|년)\s*전|어제)$/;
    // documents on each next results page (w=fusion). Page 2 starts with the web documents of
    // page 1 again, so its first document has overall rank 1.
    const NEXT_PAGE_SIZE = 15;

    /**
     * Text without HTML tags and entities, with single spaces
     */
    function clean(value) {
        if (value === undefined || value === null) {
            return '';
        }
        return he.decode(String(value).replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim();
    }

    // tooltips, share menus and buttons: not content
    const HIDDEN_TAGS = /^(STYLE|SCRIPT|NOSCRIPT|BUTTON|Q-TOOLTIP|C-TOOLTIP|Q-MENU-SHARE|C-BTN-CLOSE|C-BTN-SHARE-COLLECTION|C-SHARE-DOCUMENT)$/;
    const LAYER_CLASSES = /(^|\s)(c-layer-tip|layer_ad|fmenu-layer|gem-share-menu|ico-pmp|ico_rwd|ico_local|ico_poi|ico_rtl)(\s|$)/;
    // labels for screen readers ("선택됨", "재생시간")
    const LABEL_CLASSES = /(^|\s)(screen_out|blind)(\s|$)/;
    const BLOCK_TAGS = /^(DIV|P|LI|UL|OL|DL|DT|DD|H[1-6]|SECTION|ARTICLE|HEADER|FOOTER|FIGURE|TABLE|TR|TD|TH|BR|C-[A-Z-]+)$/;

    /**
     * The text of an element, like innerText: without the content of scripts,
     * tooltips and screen reader labels, and with a space between block
     * elements. The content of templates is included. Options: words, a space
     * between all elements; labels, with the screen reader labels.
     */
    function text_of(element, {words = false, labels = false} = {}) {
        if (!element) {
            return '';
        }
        const parts = [];
        const visit = node => {
            if (node.nodeType === 3) {
                parts.push(node.nodeValue);
                return;
            }
            if ((node.nodeType !== 1 && node.nodeType !== 11) || HIDDEN_TAGS.test(node.tagName || '')) {
                return;
            }
            const classes = node.nodeType === 1 ? node.getAttribute('class') || '' : '';
            if (LAYER_CLASSES.test(classes) || (!labels && LABEL_CLASSES.test(classes))) {
                return;
            }
            const space = words || BLOCK_TAGS.test(node.tagName || '');
            if (space) parts.push(' ');
            const children = node.tagName === 'TEMPLATE' && node.content ? node.content.childNodes : node.childNodes;
            Array.from(children).forEach(visit);
            if (space) parts.push(' ');
        };
        visit(element);
        return parts.join('').replace(/\s+/g, ' ').trim();
    }

    /**
     * Elements that match a selector, also in the templates inside the element
     */
    function find_all(element, selector) {
        if (!element) {
            return [];
        }
        const found = Array.from(element.querySelectorAll(selector));
        for (const template of element.querySelectorAll('template')) {
            if (template.content) {
                found.push(...find_all(template.content, selector));
            }
        }
        return found;
    }

    function find(element, selector) {
        return find_all(element, selector)[0] || null;
    }

    /**
     * The first element for the first selector that matches
     */
    function first_of(element, selectors) {
        for (const selector of selectors) {
            const found = element.querySelector(selector);
            if (found) {
                return found;
            }
        }
        return null;
    }

    function absolute(link, base) {
        if (!link || /^javascript:/i.test(link)) {
            return '';
        }
        try {
            return new URL(link, base).href;
        } catch (e) {
            return link;
        }
    }

    function domain_of(link) {
        try {
            return new URL(link).hostname;
        } catch (e) {
            return '';
        }
    }

    /**
     * The link of an element: its own data-href or href, or that of the link
     * around it or in it
     */
    function link_of(element, page) {
        if (!element) {
            return '';
        }
        const target = element.matches('[data-href], [href]') ? element
            : element.closest('[data-href], a[href]') || element.querySelector('[data-href], a[href]');
        return target ? absolute(target.getAttribute('data-href') || target.getAttribute('href'), page.url) : '';
    }

    /**
     * The parameters of the click log of an element (data-log), for example
     * the rank (r) and the document id (gd or d)
     */
    function log_of(element) {
        const log = {};
        const node = element && (element.matches('[data-log]') ? element : element.querySelector('[data-log]'));
        for (const part of ((node && node.getAttribute('data-log')) || '').split('&')) {
            const [key, value] = part.split('=');
            if (key) {
                log[key] = value || '';
            }
        }
        return log;
    }

    /**
     * The first group of the first pattern that matches, optionally converted
     */
    function first_match(text, patterns, convert = value => value) {
        for (const pattern of patterns) {
            const match = text.match(pattern);
            if (match) {
                return convert(match[1]);
            }
        }
        return undefined;
    }

    function number(value) {
        return parseInt(String(value).replace(/,/g, ''));
    }

    /**
     * Terms and their values in a description list (dt, dd), for example
     * {저자: "천호준", 출간: "2024.6.26."}
     */
    function details_of(element) {
        const details = {};
        for (const term of element.querySelectorAll('dt')) {
            const value = term.nextElementSibling;
            const key = text_of(term, {labels: true});
            if (key && value && value.tagName === 'DD' && !(key in details)) {
                details[key] = text_of(value, {words: true});
            }
        }
        return Object.keys(details).length ? details : undefined;
    }

    /**
     * Whether an item has its own ad label (광고)
     */
    function has_ad_label(element) {
        return Array.from(element.querySelectorAll('span, em, i, a, strong')).some(node => node.textContent.trim() === '광고');
    }

    /**
     * A row in the format of this module
     */
    function make_row(page, block, item_rank, fields) {
        const link = fields.link || '';
        return {
            id: `${page.id}:${block.rank}:${item_rank}`,
            source: page.source,
            query: page.query,
            type: fields.type || block.type,
            domain: fields.domain !== undefined ? fields.domain : domain_of(link),
            title: fields.title || '',
            published: fields.published || '',
            description: fields.description || '',
            link: link,
            section: block.section,
            page_id: page.id,
            results_page: page.results_page,
            block_rank: block.rank,
            block_type: block.type,
            block_id: block.code,
            block_title: block.title,
            item_rank: item_rank,
            overall_rank: fields.overall_rank || '',
            is_ad: (fields.is_ad !== undefined ? fields.is_ad : block.is_ad) ? 'yes' : 'no',
            publisher: fields.publisher || '',
            doc_id: fields.doc_id || '',
            extra: fields.extra && Object.values(fields.extra).some(value => value !== undefined) ? JSON.stringify(fields.extra) : ''
        };
    }

    /**
     * Rows of items, ranked in the order of the items
     */
    function item_rows(page, block, items, map) {
        let rank = 0;
        return parse_each(items, item => {
            const fields = map(item);
            if (!fields) {
                return null;
            }
            rank++;
            return make_row(page, block, rank, fields);
        });
    }

    function document_type(link) {
        const host = domain_of(link);
        return /^cafe\./.test(host) ? 'cafe' : /^blog\.|\.tistory\.com$|^brunch\./.test(host) ? 'blog' : 'web';
    }

    /**
     * Web results (통합웹): one row for each document card, then one row for
     * each related document from the same source under it. Daum's rank (r)
     * of a document counts on over the web result blocks of page 1, and starts
     * at 1 on each next results page.
     */
    function web_rows(page, block) {
        let rank = 0;
        return parse_each(find_all(block.element, 'c-card'), card => {
            const title = card.querySelector('c-title');
            if (!title || !text_of(title)) {
                return null;
            }
            const link = link_of(title, page);
            const log = log_of(title);
            const source = Array.from(card.querySelectorAll('c-breadcrumb c-frag')).map(frag => text_of(frag)).filter(part => part);
            const footer = text_of(card.querySelector('c-footer-desc'));
            // a card with a relation type (rt) is not one of the ranked documents, for example a place
            // under a topic heading such as "제주도 가볼만한 곳" (rt=kwd_cate)
            const type = log.rt ? 'web-topic' : document_type(link);
            const daum_rank = log.r ? number(log.r) : undefined;
            rank++;
            const rows = [make_row(page, block, rank, {
                type: type,
                title: text_of(title),
                link: link,
                description: text_of(card.querySelector('c-contents-desc')),
                published: DATE.test(footer) ? footer : '',
                // the source line is the host, then the blog, cafe or channel name, or else parts of the path
                publisher: !['web', 'web-topic'].includes(type) || /^(v|100)\.daum\.net$/.test(source[0] || '') ? source.slice(1).join(' › ') : '',
                overall_rank: daum_rank && !log.rt ? daum_rank + (page.results_page > 1 ? (page.results_page - 2) * NEXT_PAGE_SIZE : 0) : '',
                doc_id: log.gd || log.d,
                extra: {
                    daum_rank: daum_rank,
                    collection: log.dc || undefined,
                    relation: log.rt || undefined,
                    source_line: source.length ? source.join(' › ') : undefined,
                    source_note: footer && !DATE.test(footer) ? footer : undefined
                }
            })];
            for (const related of card.querySelectorAll('c-list-cluster c-link')) {
                const related_log = log_of(related);
                rank++;
                rows.push(make_row(page, block, rank, {
                    type: 'web-related',
                    title: text_of(related),
                    link: link_of(related, page),
                    doc_id: related_log.gd || related_log.d,
                    extra: {related_to: log.gd || log.d || undefined}
                }));
            }
            return rows;
        });
    }

    /**
     * Items of the common item layout (news, videos, ads, shopping ads): title,
     * link, source, description and date
     */
    function common_fields(item, page, fields = {}) {
        const title = first_of(item, ['.item-title .tit-g', '.tit-g', 'c-title', '.wrap_tit .tit', 'a.tit_item']);
        if (!title || !text_of(title)) {
            return null;
        }
        const dates = Array.from(item.querySelectorAll('.gem-subinfo .txt_info, .item-subinfo .txt_info')).map(info => text_of(info)).filter(info => DATE.test(info));
        const shown_url = text_of(item.querySelector('.txt_url'));
        return Object.assign({
            title: text_of(title),
            link: link_of(title, page),
            description: text_of(first_of(item, ['.conts-desc', 'c-contents-desc', '.txt_item'])),
            publisher: text_of(first_of(item, ['.item-writer .tit_item', '.item-writer .txt_info', '.link_site', '.txt_mallname', '.sub_item'])),
            published: dates[0] || '',
            domain: shown_url ? shown_url.split('/')[0] : undefined,
            extra: {shown_url: shown_url || undefined}
        }, fields);
    }

    /**
     * Text ads (power links, premium links, special links, power content)
     */
    function ad_rows(page, block) {
        let items = find_all(block.element, '.c-item-ad');
        if (!items.length) {
            items = find_all(block.element, '.list_ad > li');
        }
        return item_rows(page, block, items, item => {
            const fields = common_fields(item, page, {type: 'ad'});
            if (fields) {
                // other links of the ad (images, site links), each to its own address
                const others = new Set(Array.from(item.querySelectorAll('a[href]')).map(link => link_of(link, page)).filter(link => link && link !== fields.link));
                fields.extra.sublinks = others.size || undefined;
            }
            return fields;
        });
    }

    /**
     * Sites (사이트) and the shortcut ad (바로가기): the name, the address,
     * the description and the buttons (channel, phone)
     */
    function site_rows(page, block, type) {
        return item_rows(page, block, find_all(block.element, 'c-header-site'), header => {
            const container = header.parentElement;
            const links = Array.from(header.querySelectorAll('c-link'));
            if (!links.length) {
                return null;
            }
            const log = log_of(links[0]);
            const buttons = Array.from(container.querySelectorAll('c-btn-icon')).map(button => text_of(button)).filter(text => text);
            return {
                type: type,
                title: text_of(links[0]),
                link: link_of(links[0], page),
                description: text_of(container.querySelector('c-contents-desc')),
                doc_id: log.gd || log.d,
                extra: {
                    shown_url: links[1] ? text_of(links[1]) : undefined,
                    badges: Array.from(header.querySelectorAll('c-badge-common, c-badge-kakao')).map(badge => text_of(badge)).filter(text => text),
                    buttons: buttons.length ? buttons : undefined,
                    phone: first_match(text_of(container, {words: true}), [/(0\d{1,4}-\d{3,4}-\d{4}|1\d{3}-\d{4})/]),
                    daum_rank: log.r ? number(log.r) : undefined
                }
            };
        });
    }

    /**
     * Documents in a scroll list (music, books, related people): the title,
     * the line under it, and the details (author, album, date)
     */
    function doc_rows(page, block, type) {
        return item_rows(page, block, find_all(block.element, 'c-doc'), doc => {
            const title = doc.querySelector('c-title');
            if (!title || !text_of(title)) {
                return null;
            }
            const log = log_of(title);
            const list = doc.querySelector('c-list-desc, c-list-grid-desc');
            // a block can have more lists, for example the movie chart (실시간 예매율, 일일 관객수)
            const parent_list = doc.closest('c-list-doc[data-title]');
            // the position in a chart, from its badge; the click log then has the same r for all items
            const chart_rank = first_match(text_of(doc.querySelector('c-badge-text')), [/^(\d+)$/], number);
            return {
                type: type,
                title: text_of(title),
                link: link_of(title, page),
                description: text_of(doc.querySelector('c-contents-desc')),
                published: text_of(doc.querySelector('c-contents-desc-sub')),
                doc_id: log.gd || log.d,
                extra: {
                    details: list ? details_of(list) : undefined,
                    list: parent_list ? clean(parent_list.getAttribute('data-title')) : undefined,
                    chart_rank: chart_rank,
                    daum_rank: log.r && chart_rank === undefined ? number(log.r) : undefined
                }
            };
        });
    }

    /**
     * Shopping (쇼핑하우 by kakao): the related keywords above the list, then
     * the products, with lowest price, shipping, rating, reviews and stores.
     * For one product (for example "아이폰 17"), the block shows that product
     * and the prices of the stores that sell it.
     */
    function shopping_rows(page, block) {
        const keywords = find_all(block.element, '.c-image-tag a.item_link');
        let products = find_all(block.element, '.list_shopping > li');
        if (!products.length) {
            products = find_all(block.element, '.item_shopping');
        }
        const offers = find_all(block.element, '.comp-compare li');
        return item_rows(page, block, [...keywords, ...products, ...offers], item => {
            if (item.matches('a.item_link')) {
                return {type: 'shopping-keyword', title: text_of(item.querySelector('.txt_item')) || text_of(item), link: link_of(item, page)};
            }
            if (item.closest('.comp-compare')) {
                // a store and its price for the product
                const store = item.querySelector('.txt_item') || item.querySelector('a');
                return store ? {
                    type: 'shopping-offer',
                    title: text_of(store),
                    link: link_of(store, page),
                    extra: {price: first_match(text_of(item, {words: true}), [/([\d,]*\d)\s*원/], value => value + '원')}
                } : null;
            }
            const title = item.querySelector('.wrap_tit .tit, .tit');
            if (!title) {
                return null;
            }
            const price = item.querySelector('.item_price .txt_price') || item.querySelector('.dl_comp .txt_price');
            const words = text_of(item, {words: true, labels: true});
            const tags = Array.from(item.querySelectorAll('.wrap_tags .txt_info')).map(tag => text_of(tag)).filter(tag => tag);
            return {
                type: 'product',
                title: text_of(title),
                link: link_of(title, page),
                extra: {
                    price: price ? text_of(price) + '원' : undefined,
                    lowest_price: item.querySelector('.item_price.lowest') || /최저가/.test(words) ? true : undefined,
                    shipping: text_of(item.querySelector('.txt_delivery .txt_price')) || undefined,
                    rating: first_match(text_of(item.querySelector('.ico-rate')), [/^(\d+(?:\.\d+)?)$/], parseFloat),
                    reviews: first_match(words, [/리뷰\s*([\d,]+)/], number),
                    sellers: first_match(words, [/판매처\s*([\d,]+)/], number),
                    tags: tags.length ? tags : undefined
                }
            };
        });
    }

    /**
     * Shopping ads (파워쇼핑): products with price, store and promotion. Items
     * after the first page of the carousel are hidden at load.
     */
    function shopping_ad_rows(page, block) {
        return item_rows(page, block, find_all(block.element, '.c-list-basic > li'), item => common_fields(item, page, {
            type: 'shopping-ad',
            publisher: text_of(item.querySelector('.txt_mallname')),
            extra: {
                price: text_of(item.querySelector('.cont_price .txt_price')) || undefined,
                shipping: text_of(item.querySelector('.txt_delivery')) || undefined,
                promotion: text_of(item.querySelector('.txt_promotion')) || undefined,
                hidden_at_load: item.matches('.hide') ? true : undefined
            }
        }));
    }

    /**
     * Places (장소): name, category, rating, reviews, status and address. Then
     * the local trend ranking (맛집 트렌드 랭킹), if the block has one.
     */
    function place_rows(page, block) {
        return item_rows(page, block, find_all(block.element, '.list_place > li, .c-comp-similar li'), item => {
            if (item.closest('.c-comp-similar')) {
                const fields = common_fields(item, page, {type: 'place-ranking'});
                if (fields) {
                    const parts = Array.from(item.querySelectorAll('.conts-subdesc')).map(part => text_of(part));
                    fields.extra = {
                        rank: first_match(text_of(item.querySelector('.badge-basic')), [/^(\d+)$/], number),
                        rating: first_match(text_of(item.querySelector('.gem-star-point')), [/^(\d+(?:\.\d+)?)/], parseFloat),
                        ratings: first_match(parts.join(' '), [/\(\s*([\d,]+)\s*\)/], number),
                        category: parts.find(part => !/^[\d.]*\s*\(/.test(part)) || undefined
                    };
                }
                return fields;
            }
            return place_fields(page, item);
        });
    }

    /**
     * The fields of one place in a place list (.list_place > li)
     */
    function place_fields(page, item) {
        const name = item.querySelector('.fn_tit');
        if (!name) {
            return null;
        }
        const words = text_of(item, {words: true, labels: true});
        return {
            type: 'place',
            title: text_of(name),
            link: link_of(name, page),
            description: text_of(item.querySelector('.txt_address')),
            is_ad: has_ad_label(item),
            extra: {
                category: text_of(item.querySelector('.inner_tit .f_nb')) || undefined,
                marker: text_of(item.querySelector('.mark_count')) || undefined,
                rating: first_match(text_of(item.querySelector('.f_red')), [/^(\d+(?:\.\d+)?)$/], parseFloat),
                ratings: first_match(words, [/\(\s*([\d,]+)\s*\)/], number),
                reviews: first_match(words, [/리뷰\s*([\d,]+\+?)/]),
                status: first_match(words, [/(영업중|영업 중|영업종료|영업 종료|영업전|휴무|브레이크타임|24시간 영업)/]),
                phone: first_match(words, [/(0\d{1,4}-\d{3,4}-\d{4}|1\d{3}-\d{4})/]),
                homepage: link_of(item.querySelector('.link_home'), page) || undefined
            }
        };
    }

    /**
     * The data of the AI summary (AI 요약). A script outside the block starts
     * it, with the answer and its sources as JSON:
     * SG.use.collection({name: 'aio-tot-p', ..., data: {response: {...}}})
     */
    function ai_summary_data(doc) {
        const script = Array.from(doc.querySelectorAll('script')).find(element => element.textContent.includes("'aio-tot-p'"));
        if (!script) {
            return null;
        }
        const text = script.textContent;
        const start = text.indexOf('{', text.indexOf('response:'));
        let depth = 0, in_string = false, escaped = false;
        for (let i = start; start >= 0 && i < text.length; i++) {
            const c = text[i];
            if (in_string) {
                if (escaped) escaped = false;
                else if (c === '\\') escaped = true;
                else if (c === '"') in_string = false;
                continue;
            }
            if (c === '"') in_string = true;
            else if (c === '{') depth++;
            else if (c === '}' && --depth === 0) {
                try {
                    return JSON.parse(text.slice(start, i + 1));
                } catch (e) {
                    console.warn('Daum: could not read the data of the AI summary');
                    return null;
                }
            }
        }
        return null;
    }

    /**
     * AI summary: one row for each passage of the answer (an overview, then
     * sections with a heading), with the sources it cites, then one row for
     * each source. The topic, the question type and the disclaimer are in the
     * first row.
     */
    function ai_summary_rows(page, block) {
        const data = page.ai_summary;
        if (!data) {
            return [];
        }
        let rank = 0;
        const rows = [];
        for (const part of data.response || []) {
            const sources = part.sources || [];
            const text = clean(part.text);
            if (!text) {
                continue;
            }
            rows.push(make_row(page, block, ++rank, {
                type: 'ai-summary-passage',
                title: clean(part.title),
                description: text,
                link: sources.length ? sources[0].url : '',
                domain: '',
                extra: {
                    ui: part.ui !== 'text' ? part.ui : undefined,
                    source_urls: sources.map(source => source.url),
                    source_names: sources.map(source => clean(source.name)),
                    ai_generated: true
                }
            }));
        }
        for (const source of data.sources || []) {
            rows.push(make_row(page, block, ++rank, {
                type: 'ai-summary-source',
                title: clean(source.title),
                link: source.url || '',
                description: clean(source.content).slice(0, 300),
                publisher: clean(source.name),
                published: source.createdAt || '',
                doc_id: source.gsid || source.id,
                extra: {kind: source.collector || undefined}
            }));
        }
        if (rows.length) {
            const first = JSON.parse(rows[0].extra || '{}');
            Object.assign(first, {
                topic: data.domain || undefined,
                question_type: data.queryType || undefined,
                disclaimer: clean(get_value(data, 'disclaimer.text')) || undefined,
                stale: data.stale || undefined
            });
            rows[0].extra = JSON.stringify(first);
        }
        return rows;
    }

    function get_value(object, path) {
        return path.split('.').reduce((value, key) => (value === undefined || value === null) ? undefined : value[key], object);
    }

    /**
     * A place list that loads after a click on a sort option of the places
     * block (정확도순, 거리순) or on its page buttons. The items count on
     * after the items of the block; a place that the block already showed in
     * the same order and page is left out.
     */
    function place_click_rows(response, url, nav_index) {
        const state = pages[nav_index] && pages[nav_index].places;
        const html = state && get_json(response, 'RESULT');
        if (!html || typeof html !== 'string') {
            return [];
        }
        const doc = new DOMParser().parseFromString('<body>' + html + '</body>', 'text/html');
        const sort = url.searchParams.get('poi_sort_type') || 'default';
        const results_page = parseInt(url.searchParams.get('p')) || 1;
        return parse_each(doc.querySelectorAll('.list_place > li'), item => {
            const fields = place_fields(state.page, item);
            const key = sort + ':' + results_page + ':' + (fields && fields.link);
            if (!fields || state.seen.has(key)) {
                return null;
            }
            state.seen.add(key);
            fields.extra = Object.assign(fields.extra, {trigger: 'click', sort: sort, list_page: results_page});
            return make_row(state.page, state, state.next_rank++, fields);
        });
    }

    function get_json(response, key) {
        try {
            return JSON.parse(response)[key];
        } catch (e) {
            return undefined;
        }
    }

    /**
     * Ranked keyword lists (trends, category and theme keywords, shopping
     * keywords): the keyword, its rank, and the tab it is on
     */
    function keyword_rows(page, block, type) {
        const element = block.element;
        const tabs = Array.from(element.querySelectorAll('.list_tab li')).map(tab => text_of(tab));
        const panels = Array.from(element.querySelectorAll('.wrap_rank'));
        const items = find_all(element, '.list_trend > li, .list_rank > li, .list_ranking > li');
        return item_rows(page, block, items, item => {
            const link = item.querySelector('a[href]');
            if (!link) {
                return null;
            }
            const rank = text_of(item.querySelector('.num_rank, .num_ranking'));
            const title = text_of(item.querySelector('.txt_trend, .link_txt')) || text_of(link).replace(new RegExp('^' + rank + '\\s*'), '');
            const panel = panels.findIndex(wrap => wrap.contains(item));
            const change = item.querySelector('.ico_rtl');
            return {
                type: type,
                title: title,
                link: link_of(link, page),
                domain: '',
                extra: {
                    rank: rank ? number(rank) : undefined,
                    tab: tabs.length > 1 && panel >= 0 ? tabs[panel] : undefined,
                    change: change ? text_of(change, {labels: true}) || undefined : undefined,
                    kind: link.getAttribute('data-type') || undefined
                }
            };
        });
    }

    /**
     * Related searches (관련 검색어)
     */
    function related_search_rows(page, block) {
        return item_rows(page, block, find_all(block.element, 'a.keyword, a.link_txt'), link => {
            const log = log_of(link);
            return {
                type: 'related-search',
                title: text_of(link.querySelector('.txt_keyword')) || text_of(link),
                link: link_of(link, page),
                domain: '',
                extra: {daum_rank: log.r ? number(log.r) : undefined}
            };
        });
    }

    /**
     * Images: the description (alt) and the image
     */
    function image_rows(page, block) {
        return item_rows(page, block, find_all(block.element, 'figure img, .image_list img'), image => {
            const source = image.getAttribute('data-original-src') || image.getAttribute('src');
            if (!source) {
                return null;
            }
            return {type: 'image', title: clean(image.getAttribute('alt')), link: absolute(source, page.url), domain: ''};
        });
    }

    /**
     * The sponsor box in the sidebar (스폰서박스)
     */
    function sponsor_rows(page, block) {
        return item_rows(page, block, find_all(block.element, '.list_sponsor > li'), item => {
            const title = item.querySelector('.tit_item');
            if (!title) {
                return null;
            }
            const shown_url = Array.from(item.querySelectorAll('a')).map(link => text_of(link)).find(text => /^[\w.-]+\.[a-z]{2,}(\/|$)/i.test(text));
            return {
                type: 'ad',
                title: text_of(title),
                link: link_of(title, page),
                domain: shown_url ? shown_url.split('/')[0] : undefined,
                description: text_of(item.querySelector('dd:last-of-type')),
                extra: {shown_url: shown_url}
            };
        });
    }

    /**
     * One row for a panel without items: its title, its text, its first link,
     * and the terms of its description lists (birth date, genre)
     */
    function panel_row(page, block, fields = {}) {
        const element = block.element;
        const title = find(element, '.c-tit-exact .tit-g, c-header-content c-title');
        const list = find(element, 'dl, c-list-grid-desc, c-list-desc');
        // the link of the title, else the first link to another site (also "//host/path")
        const link = (title && link_of(title, page)) || link_of(find(element, 'a[href^="http"], a[href^="//"], [data-href^="http"]'), page);
        // a strip of facts, for example 현지시간 "8시간 느림" and 통화 "1493.71원 1EUR"
        const facts = {};
        for (const fact of find_all(element, '.c-carousel .c-item-content .tit_info')) {
            const value = text_of(fact.nextElementSibling, {words: true});
            if (text_of(fact) && value) {
                facts[text_of(fact)] = value;
            }
        }
        return make_row(page, block, 0, Object.assign({
            title: text_of(title) || block.title,
            description: text_of(element).slice(0, 1000),
            link: link,
            extra: {
                details: list ? details_of(list.parentElement || list) : undefined,
                facts: Object.keys(facts).length ? facts : undefined
            }
        }, fields));
    }

    function block_type_of(element) {
        for (const [pattern, type, is_ad] of COLLECTIONS) {
            if (pattern.test(element.id || '')) {
                return [type, !!is_ad];
            }
        }
        if (element.querySelector('.content_sponsor') || element.matches('.content_sponsor')) {
            return ['sponsor-box', true];
        }
        if (element.matches('.wrap_cutoff')) {
            return ['more-results', false];
        }
        return ['unknown', false];
    }

    function title_of(element) {
        const header = find(element, 'c-header-collection[data-title]');
        if (header) {
            return clean(header.getAttribute('data-title'));
        }
        return text_of(element.querySelector('h2, h3'), {labels: true});
    }

    /**
     * Blocks of a results page, in order: the collections in #mArticle, then
     * in #mAside (sidebar), and the parts with text that are not in a
     * collection (the sponsor box)
     */
    function page_blocks(doc) {
        const blocks = [];
        const visit = (element, section) => {
            for (const child of Array.from(element.children)) {
                if (/^(SCRIPT|STYLE|LINK|TEMPLATE|NOSCRIPT)$/.test(child.tagName)) {
                    continue;
                }
                if (child.matches(COLLECTION)) {
                    blocks.push({section, code: child.id, element: child});
                } else if (child.querySelector(COLLECTION)) {
                    visit(child, section);
                } else if (text_of(child)) {
                    const name = (child.getAttribute('class') || '').trim().split(/\s+/)[0];
                    const inner = child.querySelector('[class]');
                    blocks.push({section, code: child.id || (inner && /^g_comp/.test(name) ? inner.getAttribute('class').split(' ')[0] : name), element: child});
                }
            }
        };
        for (const [selector, section] of [['#mArticle', 'main'], ['#mAside', 'sidebar']]) {
            const root = doc.querySelector(selector);
            if (root) {
                visit(root, section);
            }
        }
        return blocks;
    }

    function block_rows(page, block) {
        const element = block.element;
        [block.type, block.is_ad] = block_type_of(element);
        block.title = title_of(element);

        let rows = [];
        switch (block.type) {
            case 'web-results':
                rows = web_rows(page, block);
                break;
            case 'power-links':
            case 'premium-links':
            case 'special-links':
            case 'power-content':
                rows = ad_rows(page, block);
                break;
            case 'power-shopping':
                rows = shopping_ad_rows(page, block);
                break;
            case 'shortcut':
                rows = site_rows(page, block, 'ad');
                break;
            case 'sites':
                rows = site_rows(page, block, 'site');
                break;
            case 'adsense':
                // Google fills this block in a frame after the page loads
                rows = [panel_row(page, block, {description: 'The ads of this block load in a frame from Google.'})];
                break;
            case 'news':
                rows = item_rows(page, block, find_all(element, '.c-list-basic > li'), item => common_fields(item, page, {type: 'news'}));
                break;
            case 'videos':
                // videos, then short videos (다음 루프)
                rows = item_rows(page, block, find_all(element, '.c-list-contents > li, .section_voo .grid_xscroll > li'), item => common_fields(item, page, {
                    type: item.closest('.section_voo') ? 'short-video' : 'video',
                    extra: {
                        platform: text_of(item.querySelector('.txt_cp')) || undefined,
                        duration: text_of(item.querySelector('.badge-basic')) || undefined
                    }
                }));
                break;
            case 'music':
                rows = doc_rows(page, block, 'song');
                break;
            case 'books':
                rows = doc_rows(page, block, 'book');
                break;
            case 'related-people':
                rows = doc_rows(page, block, 'person');
                break;
            case 'movies':
                // the movie chart (다음 영화), in chart order
                rows = doc_rows(page, block, 'movie');
                break;
            case 'images':
                rows = image_rows(page, block);
                break;
            case 'shopping':
                rows = shopping_rows(page, block);
                break;
            case 'places':
                rows = place_rows(page, block);
                // a click on a sort option loads the list again; remember the block and what it showed
                pages[page.id] = Object.assign(pages[page.id] || {}, {places: {
                    ...block, element: null, page: page,
                    next_rank: rows.reduce((max, row) => Math.max(max, row.item_rank), 0) + 1,
                    seen: new Set(rows.filter(row => row.type === 'place').map(row => 'default:1:' + row.link))
                }});
                break;
            case 'donations':
                // a list, or a carousel with one fundraiser for each page
                rows = item_rows(page, block, find_all(element, 'li').filter(item => item.querySelector('a.tit_item')), item => common_fields(item, page, {
                    type: 'donation',
                    extra: {
                        status: text_of(item.querySelector('.txt_status')) || undefined,
                        raised: text_of(item.querySelector('.txt_total')) || undefined
                    }
                }));
                break;
            case 'dictionary':
                // Korean dictionaries (.dictionary) and the exact match of other languages (.box_dic)
                rows = item_rows(page, block, find_all(element, '.dictionary, .box_dic'), entry => {
                    const word = entry.querySelector('.info_word a, .tit a, a.link_word');
                    return word ? {
                        type: 'dictionary-entry',
                        title: text_of(word),
                        link: link_of(word, page),
                        description: Array.from(entry.querySelectorAll('.txt_mean, .info_mean .cont em')).map(mean => text_of(mean)).join(' / '),
                        publisher: Array.from(entry.querySelectorAll('.tit_cate, .txt_langtype')).map(cate => text_of(cate)).join(', '),
                        extra: {pronunciation: text_of(entry.querySelector('.txt_listen')) || undefined}
                    } : null;
                });
                break;
            case 'encyclopedia':
                // an article of 다음백과 (100.daum.net): title, summary, facts
                rows = [panel_row(page, block, {
                    type: 'encyclopedia-article',
                    description: text_of(element.querySelector('.c-item-exact .item-content')).replace(/\s*더보기$/, ''),
                    publisher: '다음백과'
                })];
                break;
            case 'related-searches':
                rows = related_search_rows(page, block);
                break;
            case 'trends':
                rows = keyword_rows(page, block, 'trend');
                break;
            case 'category-keywords':
            case 'theme-keywords':
                rows = keyword_rows(page, block, 'popular-keyword');
                break;
            case 'shopping-keywords':
                rows = keyword_rows(page, block, 'shopping-keyword');
                break;
            case 'sponsor-box':
                rows = sponsor_rows(page, block);
                break;
            case 'more-results':
                // "다른결과 더보기": collections that Daum left off the page, with links to them
                rows = item_rows(page, block, element.querySelectorAll('.list_cutoff a'), link => ({
                    type: 'cut-off-collection',
                    title: text_of(link),
                    link: link_of(link, page),
                    domain: '',
                    extra: {collection: first_match(link.getAttribute('onclick') || '', [/[&']d=([A-Za-z0-9]+)/])}
                }));
                break;
            case 'ai-summary':
                rows = ai_summary_rows(page, block);
                if (!rows.length) {
                    rows = [panel_row(page, block, {description: 'The page has no data for the answer of this block.'})];
                }
                break;
            case 'unknown':
                // a collection that this module does not know yet: cards and documents, if any
                rows = find(element, 'c-card') ? web_rows(page, block) : find(element, 'c-doc') ? doc_rows(page, block, 'unknown') : [];
                break;
        }
        // a block without items still gets a row, so that it shows in the data
        return rows.length ? rows : [panel_row(page, block)];
    }

    zoekplaatje.register_module(
        'Daum',
        'daum.net',
        function (response, source_platform_url, source_url, nav_index) {
            let url;
            try {
                url = new URL(source_url);
            } catch (e) {
                return [];
            }
            // the place list after a click on a sort option of the places block
            if (url.hostname === 'search.daum.net' && url.pathname === '/qsearch2' && url.searchParams.get('coll') === 'poi') {
                return place_click_rows(response, url, nav_index);
            }
            // the integrated search (w=tot) and its next results pages (w=fusion)
            const kind = url.searchParams.get('w');
            if (url.hostname !== 'search.daum.net' || url.pathname !== '/search' || (kind && !['tot', 'fusion'].includes(kind))
                || response.indexOf('id="mArticle"') < 0) {
                return [];
            }

            const page = {
                id: nav_index,
                url: url.href,
                source: url.hostname,
                query: url.searchParams.get('q') || '',
                results_page: parseInt(url.searchParams.get('p')) || 1
            };
            const doc = new DOMParser().parseFromString(response, 'text/html');
            page.ai_summary = ai_summary_data(doc);

            let rank = 0;
            const blocks = page_blocks(doc);
            const rows = parse_each(blocks, block => {
                rank++;
                block.rank = rank;
                return block_rows(page, block);
            });

            // fields of the page record (see js/pages.js); the places block says which area
            // it searched, for example "서울 강남구 강남역 주변 맛집" or "전국의 약국"
            rows.page = {
                query: page.query,
                results_page: page.results_page,
                blocks: blocks.length,
                places_area: text_of(doc.querySelector('#poiColl .txt_result')) || undefined
            };

            // keep what later requests of a page need, for the last 50 pages
            remembered_pages.push(nav_index);
            while (remembered_pages.length > 50) {
                delete pages[remembered_pages.shift()];
            }
            return rows;
        }
    );
})();
