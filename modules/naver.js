/**
 * Naver: integrated search (통합검색) and its next results pages
 *
 * One row for each item on the page. Each row also names its block: the
 * position of the block on the page (block_rank), its kind (block_type), the
 * code that Naver gives it (block_id) and its heading (block_title). Blocks
 * without items (for example the weather panel) give one row with item_rank 0.
 *
 * Most blocks carry their data as JSON in the page, passed to
 * entry.bootstrap(document.getElementById("fdr-..."), {...}). That JSON is read
 * instead of the layout. Ads, shopping, places and info panels have markup only.
 * The related queries block gets its items from a separate request
 * (s.search.naver.com/p/qra/...), parsed when it arrives.
 */
(() => {
    // what the page parse learned that a later data request of the same page needs
    const pages = {};
    const remembered_pages = [];

    const SKIP_CLASSES = /(^|\s)(_scrollLog|_scrollLogEndline|_search_option_detail_wrap|api_sc_page_wrap)(\s|$)/;
    // web result groups: the documents of one area code form one block
    const DOCUMENT_KINDS = ['web', 'review', 'kin', 'video'];
    const PANEL_TYPES = [
        [/cs_kb_weather/, 'weather'],
        [/cs_nexchangerate/, 'exchange-rate'],
        [/_cs_sports_people|_au_people_content_wrap/, 'person'],
        [/_au_people_content_same_name/, 'same-name-people'],
        [/cs_weboriginal/, 'series'],
        [/cs_rank_chart/, 'ranking'],
        [/cs_smart_block|_athlete_expand/, 'smart-block'],
        [/ntalk_wrap/, 'open-talk'],
        [/nx_ts_do/, 'travel-destination'],
        [/m?cs_common_module/, 'info-panel']
    ];
    // panels that list people, players, dramas and similar: the type of their items
    const LIST_PANELS = {'same-name-people': 'person', 'smart-block': 'smart-block-item', 'ranking': 'ranking-item'};

    /**
     * Text without HTML tags and entities, with single spaces
     */
    function clean(value) {
        if (value === undefined || value === null) {
            return '';
        }
        return he.decode(String(value).replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim();
    }

    /**
     * Plain text from Markdown: without headings, list markers, emphasis,
     * link targets and escapes
     */
    function markdown_text(value) {
        return clean(String(value || '')
            .replace(/<template[^>]*><\/template>/g, ' ')
            .replace(/^\s*#+\s*/gm, '')
            .replace(/^\s*[-*]\s+/gm, '')
            .replace(/\*\*|__/g, '')
            .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
            .replace(/\\([\\`*_{}[\]()#+\-.!~|>])/g, '$1'));
    }

    // also icons (svg, with titles such as "panel icon") and buttons ("buttonScroller")
    const HIDDEN_TAGS = ['STYLE', 'SCRIPT', 'TEMPLATE', 'NOSCRIPT', 'BUTTON', 'SVG'];
    const BLOCK_TAGS = /^(DIV|P|LI|UL|OL|DL|DT|DD|H[1-6]|SECTION|ARTICLE|HEADER|FOOTER|TABLE|TR|TD|TH|BR)$/;
    // labels for screen readers ("새 창 링크") and the closed ad information layers
    const LABEL_CLASSES = /(^|\s)(blind|place_blind|ly_api_info)(\s|$)/;

    /**
     * The text of an element, like innerText: without the content of style and
     * script elements and screen reader labels, and with a space between block
     * elements. Options: words, a space between all elements; labels, with the
     * screen reader labels. With both, labelled values can be found, for
     * example "할인 전 판매가 100,000 원".
     */
    function text_of(element, {words = false, labels = false} = {}) {
        if (!element) {
            return '';
        }
        const parts = [];
        const visit = node => {
            if (node.nodeType === 3) {
                parts.push(node.nodeValue);
            } else if (node.nodeType === 1 && !HIDDEN_TAGS.includes(node.tagName.toUpperCase())
                && (labels || !LABEL_CLASSES.test(node.getAttribute('class') || ''))) {
                const space = words || BLOCK_TAGS.test(node.tagName);
                if (space) parts.push(' ');
                node.childNodes.forEach(visit);
                if (space) parts.push(' ');
            }
        };
        visit(element);
        return parts.join('').replace(/\s+/g, ' ').trim();
    }

    /**
     * Whether an item has its own ad label (광고) or links through Naver's ad server
     */
    function has_ad_label(element) {
        return !!element.querySelector('a[href*="ader.naver.com"]')
            || Array.from(element.querySelectorAll('span, em, i, a, button, strong')).some(node => node.textContent.trim() === '광고');
    }

    // amounts that are not the price: list prices, shipping fees, points
    const NOT_PRICE = /(판매가|배송비|최대|포인트|적립)\s*$/;

    /**
     * The price that an item shows: the price after a discount, the lowest
     * price, or else the first amount that is not a list price, shipping fee or
     * points. From the text of the item with labels.
     */
    function price_of(words) {
        const labelled = words.match(/%\s*할인\s*([\d,]*\d)\s*원/) || words.match(/최저\s*([\d,]*\d)\s*원/);
        if (labelled) {
            return labelled[1] + '원';
        }
        const amount = /([\d,]*\d)\s*원(\s*적립)?/g;
        let match;
        while ((match = amount.exec(words)) !== null) {
            if (!match[2] && !NOT_PRICE.test(words.slice(Math.max(0, match.index - 12), match.index))) {
                return match[1] + '원';
            }
        }
        return undefined;
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

    function absolute(link, base) {
        if (!link) {
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

    function get(object, path) {
        return path.split('.').reduce((value, key) => (value === undefined || value === null) ? undefined : value[key], object);
    }

    /**
     * The JSON objects that Fender blocks pass to entry.bootstrap(), by element id
     */
    function fender_json(html) {
        const blocks = {};
        const pattern = /bootstrap\(document\.getElementById\("(fdr-[0-9a-f]+)"\),\s*/g;
        let match;
        while ((match = pattern.exec(html)) !== null) {
            const start = match.index + match[0].length;
            let depth = 0, in_string = false, escaped = false, end = -1;
            for (let i = start; i < html.length; i++) {
                const c = html[i];
                if (in_string) {
                    if (escaped) escaped = false;
                    else if (c === '\\') escaped = true;
                    else if (c === '"') in_string = false;
                    continue;
                }
                if (c === '"') in_string = true;
                else if (c === '{') depth++;
                else if (c === '}' && --depth === 0) {
                    end = i + 1;
                    break;
                }
            }
            if (end < 0) {
                continue;
            }
            try {
                blocks[match[1]] = JSON.parse(html.slice(start, end));
            } catch (e) {
                console.warn('Naver: could not read the JSON of block', match[1]);
            }
        }
        return blocks;
    }

    /**
     * All objects in a Fender template tree with one of the given templateIds
     */
    function templates(node, ids, found = []) {
        if (!node || typeof node !== 'object') {
            return found;
        }
        if (Array.isArray(node)) {
            node.forEach(child => templates(child, ids, found));
            return found;
        }
        if (node.templateId && ids.includes(node.templateId)) {
            found.push(node);
        }
        for (const [key, value] of Object.entries(node)) {
            if (value && typeof value === 'object' && !/^(nlogSpec|clickLog)$/.test(key)) {
                templates(value, ids, found);
            }
        }
        return found;
    }

    function header_title(body) {
        const header = templates(body, ['header', 'sdsFeedSearchHeader'])[0];
        if (!header || !header.props) {
            return '';
        }
        if (header.props.title) {
            return clean(header.props.title);
        }
        const title = header.props.titleTemplate && header.props.titleTemplate.props;
        return title ? clean([title.prefix, title.highlight, title.suffix].filter(part => part).join(' ')) : '';
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
            overall_rank: '',
            is_ad: fields.is_ad ? 'yes' : 'no',
            publisher: fields.publisher || '',
            gdid: fields.gdid || '',
            extra: fields.extra && Object.keys(fields.extra).length ? JSON.stringify(fields.extra) : ''
        };
    }

    function gdid_of(item) {
        const spec = item && item.nlogSpec;
        if (!spec) {
            return '';
        }
        for (const part of Object.values(spec)) {
            if (part && part.nlogParams && part.nlogParams.gdid) {
                return part.nlogParams.gdid;
            }
        }
        return '';
    }

    function naver_rank(item) {
        const spec = item && item.nlogSpec;
        for (const part of Object.values(spec || {})) {
            if (part && part.nlogParams && part.nlogParams.cr_rank_legacy) {
                return parseInt(part.nlogParams.cr_rank_legacy);
            }
        }
        return undefined;
    }

    /**
     * Rows for a web result group: web pages, blogs and cafes, KnowledgeiN, videos
     */
    function document_rows(page, block, documents) {
        let rank = 0;
        return parse_each(documents, json => {
            const state = json.data.state;
            const kind = json.meta.ssuid;
            const items = kind === 'video' ? [state] : (state.items || []);
            return parse_each(items, item => {
                rank++;
                if (kind === 'web') {
                    return make_row(page, block, rank, {
                        type: 'web',
                        title: clean(item.title),
                        link: item.href,
                        description: clean(item.bodyText),
                        publisher: clean(get(item, 'profile.title')),
                        published: clean(get(item, 'profile.createdDate')),
                        gdid: gdid_of(item),
                        extra: {
                            naver_rank: naver_rank(item),
                            ai_generated_snippet: get(item, 'notice.aiGenerated') ? true : undefined,
                            sublinks: (item.subLinks || []).length || undefined
                        }
                    });
                } else if (kind === 'review') {
                    const profile = item.sourceProfile || {};
                    const link = item.titleHref || item.contentHref;
                    const host = domain_of(link);
                    const is_ad = !!(profile.isAd || item.adProps);
                    return make_row(page, block, rank, {
                        type: host.startsWith('cafe.') ? 'cafe' : host.startsWith('blog.') ? 'blog' : (is_ad ? 'sponsored-content' : 'review'),
                        title: clean(item.title),
                        link: link,
                        description: clean(item.content),
                        publisher: clean(profile.title),
                        published: clean(profile.createdDate),
                        is_ad: is_ad,
                        gdid: gdid_of(item),
                        extra: {
                            naver_rank: naver_rank(item),
                            official: profile.isOfficial ? true : undefined,
                            images: (item.images || []).length || undefined,
                            replies: (item.replies || []).length || undefined
                        }
                    });
                } else if (kind === 'kin') {
                    const title = clean(item.questionTitle);
                    const question = clean(item.questionContent);
                    return make_row(page, block, rank, {
                        type: 'knowledge-in',
                        title: title,
                        link: item.questionHref,
                        // short questions are their title only
                        description: question !== title ? question : '',
                        publisher: clean(item.author),
                        published: clean(item.createdDate),
                        gdid: gdid_of(item),
                        extra: {
                            naver_rank: naver_rank(item),
                            answer: clean(item.answer),
                            answer_badge: clean(item.badgeText) || undefined
                        }
                    });
                } else {
                    return make_row(page, block, rank, {
                        type: 'video',
                        title: clean(item.title),
                        link: item.titleHref,
                        description: clean(item.description),
                        publisher: clean(item.profileTitle),
                        published: clean(item.profileCreatedDate),
                        gdid: gdid_of(item),
                        extra: {
                            naver_rank: naver_rank(item),
                            platform: clean(item.profileCategory) || undefined,
                            duration_seconds: item.playDuration
                        }
                    });
                }
            });
        });
    }

    /**
     * AI Briefing: one row for each passage of the answer, with the sources it
     * cites, then one row for each source and each image
     */
    function ai_briefing_rows(page, block, props) {
        const sources = props.sources || [];
        const by_index = {};
        sources.forEach(source => by_index[source.footnoteSourceIndex] = source);
        const rows = [];
        let rank = 0;

        const markdown = get(props, 'summary.markdown') || '';
        const chip = /<template data-fender-markdown-id="source-chip"[^>]*?data-list="\[([^\]]*)\]"[^>]*><\/template>/g;
        let last = 0, match;
        const passage = (text, cited) => {
            const description = markdown_text(text);
            if (!description) {
                return;
            }
            const cited_sources = cited.map(index => by_index[index]).filter(source => source);
            rank++;
            rows.push(make_row(page, block, rank, {
                type: 'ai-briefing-passage',
                domain: '',
                description: description,
                link: cited_sources.length ? cited_sources[0].url : '',
                extra: {
                    source_indexes: cited,
                    source_urls: cited_sources.map(source => source.url)
                }
            }));
        };
        while ((match = chip.exec(markdown)) !== null) {
            passage(markdown.slice(last, match.index), match[1].split(',').map(index => parseInt(index)).filter(index => !isNaN(index)));
            last = match.index + match[0].length;
        }
        passage(markdown.slice(last), []);

        rows.push(...parse_each(sources, source => {
            rank++;
            return make_row(page, block, rank, {
                type: 'ai-briefing-source',
                title: clean(source.title),
                link: source.url,
                description: clean(source.content),
                publisher: clean(source.platform || source.sourceName),
                published: clean(source.dateText),
                gdid: source.gdid,
                extra: {footnote_index: source.footnoteSourceIndex, order: source.order, official: source.official ? true : undefined}
            });
        }));
        rows.push(...parse_each(props.multimedia || [], media => {
            rank++;
            return make_row(page, block, rank, {
                type: 'ai-briefing-' + (media.type || 'media'),
                title: clean(media.title),
                link: media.url,
                publisher: clean(media.platform),
                gdid: media.gdid,
                extra: {thumbnail: media.thumbnailUrl}
            });
        }));
        if (get(props, 'disclaimerInfo.text') && rows.length) {
            const first = JSON.parse(rows[0].extra || '{}');
            first.disclaimer = clean(props.disclaimerInfo.text);
            rows[0].extra = JSON.stringify(first);
        }
        return rows;
    }

    /**
     * Rows for a Fender block with a template tree (body), by kind
     */
    function fender_rows(page, block, json) {
        const body = json.body || {};
        const props = body.props || {};
        const kind = json.meta.ssuid;
        const template_rows = (ids, map) => {
            let rank = 0;
            return parse_each(templates(body, ids), node => {
                const fields = map(node.props || {});
                if (!fields) {
                    return null;
                }
                rank++;
                return make_row(page, block, rank, fields);
            });
        };

        switch (kind) {
            case 'ex_csa':
                return ai_briefing_rows(page, block, props);

            case 'clip':
                return template_rows(['clipItem'], item => ({
                    type: 'clip',
                    title: clean(item.description),
                    link: item.descriptionHref,
                    publisher: clean(item.source),
                    published: clean(item.createdAt),
                    gdid: get(item, 'gdid.image') || '',
                    extra: {views: clean(item.viewCount) || undefined, certified: item.isCertified ? true : undefined}
                }));

            case 'news': {
                const rows = [];
                let rank = 0;
                for (const node of templates(body, ['newsItem'])) {
                    const item = node.props || {};
                    const profile = item.sourceProfile || {};
                    rank++;
                    rows.push(make_row(page, block, rank, {
                        type: 'news',
                        title: clean(item.title),
                        link: item.titleHref,
                        description: clean(item.content),
                        publisher: clean(profile.title),
                        published: clean(get(profile, 'subTexts.0.text')),
                        gdid: gdid_of(item),
                        extra: {naver_news: get(profile, 'subTexts.0.textHref') || undefined}
                    }));
                    // related articles that Naver shows under an article
                    for (const related of item.subInfoCluster || []) {
                        rank++;
                        rows.push(make_row(page, block, rank, {
                            type: 'news-related',
                            title: clean(related.title),
                            link: related.titleHref,
                            publisher: clean(get(related, 'sourceProfile.title')),
                            published: clean(get(related, 'sourceProfile.subTexts.0.text')),
                            gdid: gdid_of(related)
                        }));
                    }
                }
                return rows;
            }

            case 'fuq': {
                const questions = templates(body, ['relatedQuestions']).flatMap(node => get(node, 'props.questions') || []);
                let rank = 0;
                return parse_each(questions, question => {
                    rank++;
                    const answer = question.answer || {};
                    return make_row(page, block, rank, {
                        type: 'related-question',
                        domain: '',
                        title: clean(question.title),
                        description: markdown_text(answer.markdown),
                        extra: {
                            answer_source_urls: (answer.sources || []).map(source => source.url),
                            ai_generated: true
                        }
                    });
                });
            }

            case 'image':
                return template_rows(['imageItem'], item => item.src ? {
                    type: 'image',
                    title: clean(item.alt),
                    link: item.src,
                    domain: ''
                } : null);

            case 'shortents': {
                const contents = templates(body, ['shortents']).flatMap(node => get(node, 'props.contents') || []);
                let rank = 0;
                return parse_each(contents, content => {
                    rank++;
                    return make_row(page, block, rank, {
                        type: 'short-form-topic',
                        title: clean(content.title),
                        link: absolute(content.keywordHref, page.url),
                        description: clean(content.keyword),
                        published: clean(content.date),
                        gdid: content['data-gdid'],
                        extra: {category: clean(content.category) || undefined, ai_generated_topic: true}
                    });
                });
            }

            case 'influencer':
                if (/aipick/.test(get(json, 'refs.blockId') || '')) {
                    return template_rows(['aipickItem'], item => ({
                        type: 'ai-pick-creator',
                        title: clean(item.title),
                        link: item.profileHref,
                        description: clean(item.description),
                        publisher: clean(item.serviceName),
                        extra: {citations: item.mateCitationCount}
                    }));
                }
                return template_rows(['ugcItemDesk'], item => ({
                    type: 'influencer-post',
                    title: clean(get(item, 'article.title')),
                    link: get(item, 'article.titleHref'),
                    description: clean(get(item, 'article.content')),
                    publisher: clean(get(item, 'profile.text')),
                    published: clean(get(item, 'profile.subText'))
                }));

            case 'smartblock_travel':
                return template_rows(['travelItem'], item => ({
                    type: 'travel-product',
                    title: clean(item.title || item.text),
                    link: item.titleHref || item.href || item.thumbnailHref,
                    publisher: clean(item.corpName),
                    is_ad: !!item.isAd,
                    extra: {
                        price: item.price ? clean(item.price) + '원' : undefined,
                        duration: clean(item.subInfo1) || undefined,
                        status: item.statusBadgeState || undefined,
                        badge: clean(item.thumbnailBadgeText) || undefined
                    }
                }));

            case 'qra':
                // the items arrive with a separate request; see related_query_rows()
                return [];

            default: {
                // a kind this module does not know yet: items that have a title and a link
                let rank = 0;
                const rows = [];
                const visit = node => {
                    if (!node || typeof node !== 'object') return;
                    if (Array.isArray(node)) return node.forEach(visit);
                    if (typeof node.title === 'string' && typeof (node.titleHref || node.href) === 'string' && node.templateId !== 'header') {
                        rank++;
                        rows.push(make_row(page, block, rank, {type: 'unknown', title: clean(node.title), link: absolute(node.titleHref || node.href, page.url)}));
                    }
                    Object.entries(node).forEach(([key, value]) => { if (!/^(nlogSpec|clickLog)$/.test(key)) visit(value); });
                };
                visit(body);
                return rows;
            }
        }
    }

    function block_type_of_fender(json) {
        const types = {
            ex_csa: 'ai-briefing', clip: 'clips', news: 'news', fuq: 'related-questions', image: 'images',
            shortents: 'short-form-feed', qra: 'related-queries', smartblock_travel: 'travel'
        };
        const kind = json.meta.ssuid;
        if (kind === 'influencer') {
            return /aipick/.test(get(json, 'refs.blockId') || '') ? 'ai-pick' : 'influencers';
        }
        return types[kind] || kind;
    }

    /**
     * Ads (파워링크): the advertiser, the shown URL, the title and the description
     */
    function ad_rows(page, block, element) {
        let rank = 0;
        return parse_each(element.querySelectorAll('ul.lst_type > li'), item => {
            const title = Array.from(item.querySelectorAll('.lnk_tit')).map(text_of).filter(part => part).join(' ');
            const shown_url = text_of(item.querySelector('.lnk_url'));
            const link = item.querySelector('a.lnk_head, a.site, a[href]');
            if (!title && !shown_url) {
                return null;
            }
            rank++;
            return make_row(page, block, rank, {
                type: 'ad',
                title: title,
                link: link ? link.getAttribute('href') : '',
                domain: shown_url.split('/')[0],
                description: text_of(item.querySelector('.link_desc')),
                publisher: text_of(item.querySelector('.site')),
                is_ad: true,
                extra: {shown_url: shown_url}
            });
        });
    }

    /**
     * Shopping (price comparison, Naver Plus Store): products by their links,
     * because the class names of these blocks change
     */
    function product_rows(page, block, element) {
        const product_link = /shopping\.naver\.com\/.*(nv_mid|catalog|products)|smartstore\.naver\.com\/main\/products|brand\.naver\.com\/.+\/products/;
        const items = [];
        for (const link of element.querySelectorAll('a[href]')) {
            const item = link.closest('li');
            if (item && product_link.test(link.getAttribute('href')) && text_of(link) && !items.includes(item)) {
                items.push(item);
            }
        }
        let rank = 0;
        return parse_each(items, item => {
            const links = Array.from(item.querySelectorAll('a[href]'));
            const product_links = links.filter(link => product_link.test(link.getAttribute('href')) && text_of(link));
            const title_link = product_links.sort((a, b) => text_of(b).length - text_of(a).length)[0];
            const store = links.find(link => /outlink|smartstore\.naver\.com\/(?!main)|brand\.naver\.com/.test(link.getAttribute('href')) && text_of(link) && link !== title_link);
            const words = text_of(item, {words: true, labels: true});
            const rating = words.match(/(\d\.\d+)\s*\(\s*([\d,]+)\s*\)/);
            rank++;
            return make_row(page, block, rank, {
                type: 'product',
                title: text_of(title_link),
                link: title_link.getAttribute('href'),
                publisher: store ? text_of(store).replace(/공식$/, '') : '',
                is_ad: has_ad_label(item),
                extra: {
                    price: price_of(words),
                    list_price: first_match(words, [/할인 전 판매가\s*([\d,]*\d)\s*원/], value => value + '원'),
                    rating: rating ? parseFloat(rating[1]) : undefined,
                    reviews: rating ? number(rating[2]) : undefined,
                    sellers: first_match(words, [/판매처\s*([\d,]+)/], number)
                }
            });
        });
    }

    /**
     * Places (플레이스): name, category, opening state and distance
     */
    function place_rows(page, block, element) {
        let rank = 0;
        const items = Array.from(element.querySelectorAll('li')).filter(item =>
            item.querySelector('a[href*="map.naver.com"], a[href*="place.naver.com"]') && !item.querySelector('li'));
        return parse_each(items, item => {
            // the first place link with text; the photo before it links to the place too
            const links = Array.from(item.querySelectorAll('a[href*="map.naver.com"], a[href*="place.naver.com"]'));
            const link = links.find(a => text_of(a)) || links[0];
            // the name link holds the name, icons (reservation, coupon) and the category, in that order
            const parts = Array.from(link.children).filter(child => child.tagName === 'SPAN' && !child.querySelector('span, svg') && text_of(child)).map(child => text_of(child));
            const name = parts[0] || text_of(link);
            // the heading part of the item; the photos and reviews below it are left out
            const heading = Array.from(item.children).find(child => child.contains(link)) || item;
            const words = text_of(item, {words: true, labels: true});
            rank++;
            return make_row(page, block, rank, {
                type: 'place',
                title: name,
                link: link.getAttribute('href'),
                description: text_of(heading, {words: true}).slice(0, 300),
                is_ad: has_ad_label(item),
                extra: {
                    category: parts.length > 1 ? parts[parts.length - 1] : undefined,
                    status: first_match(words, [/(곧 영업 종료|곧 영업 시작|영업 중|영업 종료|영업 전|브레이크타임|24시간 영업|정기휴무|휴무)/]),
                    rating: first_match(words, [/별점\s*(\d+(?:\.\d+)?)/, /(\d\.\d+)\s*별점/], parseFloat),
                    reviews: first_match(words, [/리뷰\s*([\d,]+)/], number),
                    phone: first_match(words, [/(0\d{1,4}-\d{3,4}-\d{4})/]),
                    distance_from_current_location: first_match(words, [/현재 위치에서\s*([\d.,]+\s*k?m)/])
                }
            });
        });
    }

    /**
     * Books (네이버 도서): title, author, publisher, date and price. Books from
     * a store that pays for the place have an ad label.
     */
    function book_rows(page, block, element) {
        let rank = 0;
        return parse_each(element.querySelectorAll('li'), item => {
            const link = item.querySelector('a.item_title') || Array.from(item.querySelectorAll('a[href]')).find(a => text_of(a));
            if (!link || item.querySelector('li')) {
                return null;
            }
            const words = text_of(item, {words: true, labels: true});
            // the store link names one store, or the number of stores ("판매처 26")
            const store = text_of(item.querySelector('a.shop'));
            const sellers = first_match(store, [/^판매처\s*([\d,]+)$/], number);
            rank++;
            return make_row(page, block, rank, {
                type: 'book',
                title: text_of(link),
                link: absolute(link.getAttribute('href'), page.url),
                publisher: text_of(item.querySelector('.publish')) || first_match(words, [/출판\s+(\S+)/]) || '',
                published: text_of(item.querySelector('.book_info .date')),
                is_ad: has_ad_label(item),
                extra: {
                    author: text_of(item.querySelector('.writer')) || first_match(words, [/저자\s+(.+?)\s+출판/]),
                    price: price_of(words),
                    store: store && sellers === undefined ? store : undefined,
                    sellers: sellers
                }
            });
        });
    }

    /**
     * Items of a panel with a list: the name, the line under it and the link
     * (most link to a Naver search for the item). Tabs and "more" buttons are
     * not items.
     */
    function panel_list_rows(page, block, element, type) {
        let rank = 0;
        const items = Array.from(element.querySelectorAll('li')).filter(item => !item.querySelector('li') && !item.closest('.tab_list'));
        return parse_each(items, item => {
            const title = item.querySelector('.name, ._text, .title');
            const link = title && (title.closest('a[href]') || title.querySelector('a[href]') || item.querySelector('a[href]'));
            if (!title || !text_of(title) || !link) {
                return null;
            }
            rank++;
            return make_row(page, block, rank, {
                type: type,
                title: text_of(title),
                link: absolute(link.getAttribute('href'), page.url),
                description: text_of(item.querySelector('.sub_text, .desc'))
            });
        });
    }

    function panel_type(element) {
        // the class can be on the block or a few levels down (the block is then a wrapper)
        const classes = [element, ...Array.from(element.querySelectorAll('[class]')).slice(0, 3)]
            .map(node => node.getAttribute('class') || '').join(' ');
        for (const [pattern, type] of PANEL_TYPES) {
            if (pattern.test(classes)) {
                return type;
            }
        }
        return null;
    }

    /**
     * Blocks of a results page, in order: Fender blocks with their JSON (web
     * result documents grouped by area code), and blocks with markup only
     */
    function page_blocks(doc, json_by_id) {
        const blocks = [];
        for (const [selector, section] of [['#main_pack', 'main'], ['#sub_pack', 'sidebar']]) {
            const root = doc.querySelector(selector);
            if (!root) {
                continue;
            }
            for (const child of Array.from(root.children)) {
                if (['SCRIPT', 'STYLE', 'LINK', 'TEMPLATE', 'NOSCRIPT'].includes(child.tagName)
                    || SKIP_CLASSES.test(child.getAttribute('class') || '')
                    || /^S:\d+$/.test(child.id || '')) {
                    continue;
                }
                const fender = child.id && json_by_id[child.id]
                    ? [child]
                    : Array.from(child.querySelectorAll('[id^="fdr-"]')).filter(element => json_by_id[element.id] && !element.parentElement.closest('[id^="fdr-"]'));
                if (fender.length) {
                    for (const element of fender) {
                        const json = json_by_id[element.id];
                        const previous = blocks[blocks.length - 1];
                        const is_document = DOCUMENT_KINDS.includes(json.meta.ssuid) && json.data && json.data.state;
                        // a video document is its own state, so its title is the video's, not a block title
                        const own_title = is_document && json.meta.ssuid !== 'video' ? clean(get(json, 'data.state.title')) : '';
                        if (is_document && previous && previous.documents && previous.code === json.meta.area && !own_title) {
                            previous.documents.push(json);
                        } else if (is_document) {
                            blocks.push({section, code: json.meta.area, documents: [json], title: own_title, element: element});
                        } else {
                            blocks.push({section, code: json.meta.area || get(json, 'refs.blockId') || '', json: json, element: element});
                        }
                    }
                } else if (text_of(child)) {
                    blocks.push({section, code: child.id || '', element: child});
                }
            }
        }
        return blocks;
    }

    function block_rows(page, block) {
        if (block.documents) {
            const kinds = [...new Set(block.documents.map(json => json.meta.ssuid))];
            block.type = /^urB_/.test(block.code) ? 'web-results'
                : kinds.length === 1 ? {web: 'web-results', review: 'blogs-cafes', kin: 'knowledge-in', video: 'videos'}[kinds[0]] : 'web-results';
            const rows = document_rows(page, block, block.documents);
            if (page.start) {
                // the next results pages list web documents from number "start" on
                rows.forEach(row => row.overall_rank = page.start - 1 + row.item_rank);
            }
            return rows;
        }

        const element = block.element;
        const heading = text_of(element.querySelector('h2, h3')).replace(/\s*펴고 접기$/, '');

        if (block.json) {
            block.type = block_type_of_fender(block.json);
            block.title = header_title(block.json.body) || clean(get(block.json, 'body.props.header.title')) || heading;
            if (block.type === 'related-queries') {
                // the items arrive later with their own request, and not on every
                // page view; remember the block, and give it a row of its own
                pages[page.id] = Object.assign(pages[page.id] || {}, {related_queries: {...block, element: null}});
                return [make_row(page, block, 0, {title: block.title, description: 'The items of this block load with a separate request.'})];
            }
            const rows = fender_rows(page, block, block.json);
            // a block without items still gets a row, so that it shows in the data
            return rows.length ? rows : [make_row(page, block, 0, {title: block.title, description: text_of(element).slice(0, 1000)})];
        }

        block.title = heading;
        let rows = [];
        if (element.matches('.ad_section') || element.querySelector('.ad_section')) {
            block.type = 'ads';
            rows = ad_rows(page, block, element);
        } else if (/^shp_\w+_root$/.test(element.id)) {
            block.type = 'price-comparison';
            rows = product_rows(page, block, element);
        } else if (/^shs_\w+_root$/.test(element.id)) {
            block.type = 'plus-store';
            rows = product_rows(page, block, element);
        } else if (element.id === 'place-app-root' || /플레이스/.test(block.title)) {
            block.type = 'places';
            rows = place_rows(page, block, element);
        } else if (element.matches('.sp_nbook') || element.querySelector('.sp_nbook')) {
            block.type = 'books';
            rows = book_rows(page, block, element);
        } else if (block.section === 'sidebar' && element.querySelector('a[href*="mkt.naver.com"]')) {
            // Naver's own banners for its services and campaigns
            block.type = 'naver-promotions';
            let rank = 0;
            rows = parse_each(element.querySelectorAll('a[href*="mkt.naver.com"]'), link => {
                if (!text_of(link)) {
                    return null;
                }
                rank++;
                return make_row(page, block, rank, {type: 'promotion', title: text_of(link), link: link.getAttribute('href')});
            });
        } else {
            // the overseas destination panel (해외인기지역) has other class names than the domestic one
            block.type = panel_type(element)
                || (element.querySelector('a[href*="travel.naver.com/overseas/"], a[href*="travel.naver.com/domestic/"]') ? 'travel-destination' : 'unknown');
            if (LIST_PANELS[block.type]) {
                rows = panel_list_rows(page, block, element, LIST_PANELS[block.type]);
            }
        }
        if (!rows.length) {
            // a block without items: one row with its heading and text
            const link = Array.from(element.querySelectorAll('a[href^="http"]'))[0];
            rows = [make_row(page, block, 0, {
                title: block.title,
                description: text_of(element).slice(0, 1000),
                link: link ? link.getAttribute('href') : '',
                is_ad: block.type === 'ads'
            })];
        }
        return rows;
    }

    /**
     * The related queries block (함께 많이 찾는), from its own request
     */
    function related_query_rows(response, source_platform_url, nav_index) {
        const state = pages[nav_index] && pages[nav_index].related_queries;
        if (!state) {
            return [];
        }
        let data;
        try {
            data = JSON.parse(response);
        } catch (e) {
            return [];
        }
        const page = state.page;
        let rank = 0;
        return parse_each(get(data, 'result.contents') || [], content => {
            rank++;
            return make_row(page, state, rank, {
                type: 'related-query',
                title: clean(content.query || content.title),
                link: absolute(content.href, page.url),
                domain: '',
                extra: {badge: clean(get(content, 'badge.text')) || undefined}
            });
        });
    }

    zoekplaatje.register_module(
        'Naver',
        'naver.com',
        function (response, source_platform_url, source_url, nav_index) {
            let url;
            try {
                url = new URL(source_url);
            } catch (e) {
                return [];
            }
            if (url.hostname === 's.search.naver.com' && url.pathname.startsWith('/p/qra/')) {
                return related_query_rows(response, source_platform_url, nav_index);
            }
            if (url.hostname !== 'search.naver.com' || url.pathname !== '/search.naver' || response.indexOf('id="main_pack"') < 0) {
                return [];
            }

            const page_url = new URL(source_platform_url || source_url);
            const page = {
                id: nav_index,
                url: page_url.href,
                source: url.hostname,
                query: url.searchParams.get('query') || page_url.searchParams.get('query') || '',
                results_page: parseInt(url.searchParams.get('page')) || 1,
                start: parseInt(url.searchParams.get('start')) || null
            };
            const doc = new DOMParser().parseFromString(response, 'text/html');
            const json_by_id = fender_json(response);
            const blocks = page_blocks(doc, json_by_id);

            let rank = 0;
            const rows = parse_each(blocks, block => {
                rank++;
                block.rank = rank;
                block.page = page;
                return block_rows(page, block);
            });
            if (!page.start) {
                // results page 1: the web documents count on over the web result blocks, in page
                // order. The next results pages are Naver's list of web documents: page 2 starts
                // at 1 again, with mostly the same documents as page 1.
                let position = 0;
                rows.filter(row => row.block_type === 'web-results').forEach(row => row.overall_rank = ++position);
            }

            // keep what later requests of a page need, for the last 50 pages
            remembered_pages.push(nav_index);
            while (remembered_pages.length > 50) {
                delete pages[remembered_pages.shift()];
            }
            return rows;
        }
    );
})();
