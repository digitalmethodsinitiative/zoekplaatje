const background = browser.extension.getBackgroundPage();
var xhr;

/**
 * StreamSaver init
 * Unused for now - see documentation for the download_blob function.
 */
/*var fileStream;
var writer;
var encode = TextEncoder.prototype.encode.bind(new TextEncoder);

streamSaver.mitm = 'mitm.html';
// Abort the download stream when leaving the page
window.isSecureContext && window.addEventListener('beforeunload', evt => {
    writer.abort()
    writer = undefined;
    fileStream = undefined;
})*/

/**
 * Create DOM element
 *
 * Convenience function because we can't use innerHTML very well in an
 * extension context.
 *
 * @param tag  Tag of element
 * @param attributes  Element attributes
 * @param content  Text content of attribute
 * @returns {*}
 */
function createElement(tag, attributes={}, content=undefined) {
    let element = document.createElement(tag);
    for(let attribute in attributes) {
        element.setAttribute(attribute, attributes[attribute]);
    }
    if (content && typeof(content) === 'object' && 'tagName' in content) {
        element.appendChild(content);
    } else if(content !== undefined) {
        element.textContent = content;
    }

    return element;
}

/**
 * Manage availability of interface buttons
 *
 * Some buttons are only available when a 4CAT URL has been provided, or when
 * items have been collected, etc. This function is called periodically to
 * enable or disable buttons accordingly.
 */
function activate_buttons() {
    document.querySelectorAll("td button").forEach(button => {
        let current = button.disabled;
        let items = parseInt(button.parentNode.parentNode.querySelector('.num-items').innerText);
        let new_status = current;

        if(button.classList.contains('download-csv') || button.classList.contains('reset') || button.classList.contains('preview')) {
            new_status = !(items > 0);
        }

        if(new_status !== current) {
            button.disabled = new_status;
        }
    });
}

/**
 * Toggle data capture for a platform
 *
 * Callback; platform depends on the button this callback is called through.
 *
 * @param e
 * @returns {Promise<void>}
 */
async function toggle_listening(e) {
    let platform = e.target.getAttribute('name');
    let now = await background.browser.storage.local.get([platform]);
    let current = !!parseInt(now[platform]);
    let updated = current ? 0 : 1;

    await background.browser.storage.local.set({[platform]: String(updated)});
    update_icon();
}

/**
 * Update favicon depending on whether capture is enabled
 */
function update_icon() {
    const any_enabled = Array.from(document.querySelectorAll('.toggle-switch input')).filter(item => item.checked);
    const path = any_enabled.length > 0 ? '/images/icon-96-enabled.png' : '/images/icon-96.png';
    document.querySelector('link[rel~=icon]').setAttribute('href', path);
}

/**
 * Get stats
 *
 * Loads the amount of items collected, etc. This function is called
 * periodically to keep the numbers in the interface updated as items are
 * coming in.
 *
 * @returns {Promise<void>}
 */
async function get_stats() {
    let response = [];
    let platform_map = [];
    Object.keys(background.zoekplaatje.modules).forEach(function(platform) { platform_map[platform] = background.zoekplaatje.modules[platform].name; });
    for(let module in background.zoekplaatje.modules) {
        response[module] = await background.db.items.where("source_platform").equals(module).count();
    }

    for (let platform in response) {
        let row_id = "stats-" + platform.replace(/[^a-zA-Z0-9]/g, "");
        let new_num_items = parseInt(response[platform]);
        if(!document.querySelector("#" + row_id)) {
            let toggle_field = 'zs-enabled-' + platform;
            let enabled = await background.browser.storage.local.get([toggle_field])
            enabled = enabled.hasOwnProperty(toggle_field) && !!parseInt(enabled[toggle_field]);
            let row = createElement("tr", {"id": row_id});

            // checkbox stuff
            let checker = createElement("label", {"for": toggle_field});
            checker.appendChild(createElement('input', {"id": toggle_field, "name": toggle_field, "type": "checkbox"}))
            checker.appendChild(createElement('span', {"class": "toggle"}));
            if(enabled) { checker.firstChild.setAttribute('checked', 'checked'); }
            checker.addEventListener('change', toggle_listening);

            row.appendChild(createElement("td", {}, createElement('div', {'class': 'toggle-switch'}, checker)));
            row.appendChild(createElement("td", {}, createElement('a', {'href': 'https://' + platform}, platform_map[platform])));
            row.appendChild(createElement("td", {"class": "num-items"}, new Intl.NumberFormat().format(response[platform])));

            let actions = createElement("td");
            let clear_button = createElement("button", {"data-platform": platform, "class": "reset"}, " Clear");
            let preview_button = createElement("button", {"data-platform": platform, "class": "preview"}, " View");
            let download_button = createElement("button", {
                "data-platform": platform,
                "class": "download-csv"
            }, " .csv");
            clear_button.insertAdjacentElement('afterbegin', createElement('i', {class: 'fa fa-times'}));
            preview_button.insertAdjacentElement('afterbegin', createElement('i', {class: 'fa fa-table'}));
            download_button.insertAdjacentElement('afterbegin', createElement('i', {class: 'fa fa-download'}));

            actions.appendChild(clear_button);
            actions.appendChild(preview_button);
            actions.appendChild(download_button);

            row.appendChild(actions);
            document.querySelector("#item-table tbody").appendChild(row);
        } else if(new_num_items !== parseInt(document.querySelector("#" + row_id + " .num-items").innerText)) {
            document.querySelector("#" + row_id + " .num-items").innerText = new Intl.NumberFormat().format(new_num_items);
        }
    }

    activate_buttons();
    update_icon();
    init_tooltips();
}

/**
 * Handle button clicks
 *
 * Since buttons are created dynamically, the buttons don't have individual
 * listeners but this function listens to incoming events and dispatches
 * accordingly.
 *
 * @param event
 * @returns {Promise<void>}
 */
async function button_handler(event) {
    let status = document.getElementById('upload-status');

    if (event.target.matches('.popup-close')) {
        document.querySelector('#popup').setAttribute('aria-hidden', 'true');

    } else if (event.target.matches('.preview')) {
        const platform = event.target.getAttribute('data-platform');
        const entries = await get_results(platform);
        const popup = document.querySelector('#popup table');
        popup.textContent = '';

        const headers = get_headers(entries);
        const header = createElement('tr');
        for(const field of headers) {
            const th = createElement('th', {}, field);
            header.appendChild(th);
        }

        popup.appendChild(header);
        for(const item of entries) {
            const row = createElement('tr', {});
            for(const field of headers) {
                const td = createElement('td', {}, item[field]);
                row.appendChild(td);
            }
            popup.appendChild(row);
        }

        document.querySelector('#popup').setAttribute('aria-hidden', 'false');


    } else if (event.target.matches('.reset')) {
        let platform = event.target.getAttribute('data-platform');
        await background.db.items.where("source_platform").equals(platform).delete();

    } else if (event.target.matches('.reset-all')) {
        await background.db.items.clear();

    } else if (event.target.matches('.download-csv')) {
        let platform = event.target.getAttribute('data-platform');
        let date = new Date();
        event.target.classList.add('loading');

        //let blob = await download_blob(platform, 'zeeschuimer-export-' + platform + '-' + date.toISOString().split(".")[0].replace(/:/g, "") + '.ndjson');
        let blob = await get_blob(platform);
        let filename = 'zoekplaatje-export-' + platform + '-' + date.toISOString().split(".")[0].replace(/:/g, "") + '.csv';
        await browser.downloads.download({
            url: window.URL.createObjectURL(blob),
            filename: filename,
            conflictAction: 'uniquify'
        });

        event.target.classList.remove('loading');

    } else if(event.target.matches('#clear-history')) {
        await background.db.uploads.clear();
        document.querySelector('#clear-history').remove();
        document.querySelectorAll("#upload-table tbody tr").forEach(x => x.remove());

    }

    get_stats();
}

async function get_results(platform) {
    let results = [];

    await iterate_items(platform, function(item) {
        results.push(export_row(item))
    });

    return results;
}

/**
 * Row for a stored item, as the CSV file and the preview show it
 *
 * The timestamp comes from timestamp_collected (milliseconds), which every
 * stored item has. All rows then have the same format in UTC, also rows that
 * an older version stored with a local 12-hour time.
 *
 * @param item  Item as stored in the database
 * @returns {Object}
 */
function export_row(item) {
    const row = {...item['data']};
    if (item['timestamp_collected']) {
        row['timestamp'] = new Date(item['timestamp_collected']).toISOString().replace('T', ' ').slice(0, 19);
    }
    return row;
}

/**
 * Fields that most modules write, in the order of the Google module. Exports
 * put these first, so that a column keeps its place whichever row comes first.
 */
const COMMON_FIELDS = ['id', 'timestamp', 'source', 'query', 'type', 'domain', 'title', 'published', 'description', 'link', 'section'];

function get_headers(results) {
    // rows of one engine can have different fields, so use the fields of all
    // rows: the common fields first, then the others in order of appearance
    const fields = new Set();
    for (const result of results) {
        for (const field of Object.keys(result)) {
            fields.add(field);
        }
    }
    return COMMON_FIELDS.filter(field => fields.has(field))
        .concat([...fields].filter(field => !COMMON_FIELDS.includes(field)));
}
/**
 * Get a CSV dump of items
 *
 * Returns a Blob
 *
 * @param platform
 * @returns {Promise<Blob>}
 */
async function get_blob(platform) {
    // read the items once and take the header from the same items, so that an
    // item captured during the export cannot have a field without a column
    const results = await get_results(platform);
    const headers = get_headers(results);

    // the byte order mark makes Excel read the file as UTF-8, e.g. for Korean text
    let csv = ['\ufeff', headers.map(csv_value).join(','), "\r\n"];
    for (const result of results) {
        csv.push(headers.map(field => csv_value(result[field])).join(','));
        csv.push("\r\n");
    }

    return new Blob(csv, {type: 'text/csv'});
}

/**
 * Format a value as a CSV field
 *
 * A missing value is an empty field. Other values are written as they were
 * captured.
 *
 * @param value
 * @returns {string}
 */
function csv_value(value) {
    if(value === undefined || value === null) {
        return '';
    }
    value = String(value).replace(/"/g, '""');
    if(value.indexOf("\n") >= 0
        || value.indexOf("\r") >= 0
        || value.indexOf('"') >= 0
        || value.indexOf(',') >= 0) {
        return '"' + value + '"';
    }
    return value;
}

/**
 * Use StreamSaver to download a Blob
 *
 * This is advantageous for very large files because the download starts
 * while items are being collected, instead of only after a CSV has been
 * created and stored in memory. However, StreamSaver is kind of awkward to
 * use in an extension context, so for now this function is not used.
 *
 * @param platform
 * @param filename
 * @returns {Promise<void>}
 */
async function download_blob(platform, filename) {
    if (!fileStream) {
        fileStream = streamSaver.createWriteStream(filename)
        writer = fileStream.getWriter()
    }

    await iterate_items(platform, function(item) {
        writer.write(encode(JSON.stringify(item) + "\n"));
    });

    await writer.close();
    writer = undefined;
    fileStream = undefined;
}

/**
 * Iterate through all collected items for a given platform
 *
 * A callback function will be called with each item as its only argument. This
 * function iterates over the items in chunks of 500, to avoid issues with
 * large datasets that are too much for the browser to handle in one go.
 *
 * @param platform  Platform to iterate items for
 * @param callback  Callback to call for each item
 * @returns {Promise<void>}
 */
async function iterate_items(platform, callback) {
    let previous;
    while(true) {
        let items;
        // we paginate here in this somewhat roundabout way because firefox
        // crashes if we query everything in one go for large datasets
        if(!previous) {
            items = await background.db.items
                .orderBy('id')
                .filter(item => item.source_platform === platform)
                .limit(500).toArray();
        } else {
            items = await background.db.items
                .where('id')
                .aboveOrEqual(previous.id)
                .filter(fastForward(previous, 'id', item => item.source_platform === platform))
                .limit(500).toArray();
        }

        if(!items.length) {
            break;
        }

        items.forEach(item => {
            callback(item);
            previous = item;
        })
    }
}

/**
 * Helper function for Dexie pagination
 *
 * Used to paginate through results where large result sets may be too much for
 * Firefox to handle.
 *
 * See https://dexie.org/docs/Collection/Collection.offset().
 *
 * @param lastRow  Last seen row (that should not be included)
 * @param idProp  Property to compare between items
 * @param otherCriteria  Other filters, as a function that returns a bool.
 * @returns {(function(*): (*|boolean))|*}
 */
function fastForward(lastRow, idProp, otherCriteria) {
    let fastForwardComplete = false;
    return item => {
        if (fastForwardComplete) return otherCriteria(item);
        if (item[idProp] === lastRow[idProp]) {
            fastForwardComplete = true;
        }
        return false;
    };
}

/**
 * Init!
 */
document.addEventListener('DOMContentLoaded', async function () {
    get_stats();
    setInterval(get_stats, 1000);

    document.addEventListener('click', button_handler);
});