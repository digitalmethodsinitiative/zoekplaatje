/**
 * Toolbar popup: what Zoekplaatje captured on the page in the current tab,
 * with a switch for capture of its search engine, a screenshot by hand, and
 * links to the Zoekplaatje window
 */
const background = browser.extension.getBackgroundPage();
let current_tab = null;
// a screenshot by hand is being taken: its status stays until it is saved
let taking = false;

function show(id, text) {
    const element = document.getElementById(id);
    element.textContent = text;
    element.setAttribute('aria-hidden', text ? 'false' : 'true');
}

/**
 * The module of a page, by the host of its address (e.g. search.naver.com → naver.com)
 */
function module_of(url) {
    let host;
    try {
        host = new URL(url).hostname;
    } catch (e) {
        return null;
    }
    return Object.keys(background.zoekplaatje.modules).find(domain => host === domain || host.endsWith('.' + domain)) || null;
}

function screenshot_text(record) {
    const shots = record.screenshots || [];
    if (!shots.length) {
        return 'No screenshot of this page yet.';
    }
    const last = shots[shots.length - 1];
    return 'Screenshot (' + last.trigger + '): ' + last.status + (last.file ? ', ' + last.file.split('/').pop() : '') + '.';
}

async function render() {
    [current_tab] = await browser.tabs.query({active: true, currentWindow: true});
    const nav_index = background.zoekplaatje.pages.current(current_tab.id);
    const record = await background.db.pages.get(nav_index);
    const module = record ? record.source_platform : module_of(current_tab.url);

    if (record) {
        show('page-status', record.engine + ': results page ' + (record.results_page || 1) + (record.query ? ' for "' + record.query + '"' : '') + ' captured.');
        show('page-details', record.rows + ' rows' + (record.blocks ? ' from ' + record.blocks + ' blocks' : '') + '.');
        if (!taking) {
            show('screenshot-status', screenshot_text(record));
        }
    } else {
        show('page-status', 'Nothing captured on this page.');
        show('page-details', '');
        show('screenshot-status', '');
    }
    document.getElementById('screenshot').disabled = !record || taking;

    // capture on or off for the search engine of this page
    const engine_switch = document.getElementById('engine-switch');
    if (module) {
        const key = 'zs-enabled-' + module;
        const stored = await background.browser.storage.local.get([key]);
        document.getElementById('engine-enabled').checked = !!parseInt(stored[key]);
        engine_switch.querySelector('.engine-name').textContent = background.zoekplaatje.modules[module].name;
        engine_switch.setAttribute('aria-hidden', 'false');
        engine_switch.setAttribute('data-key', key);
    } else {
        engine_switch.setAttribute('aria-hidden', 'true');
    }
}

document.addEventListener('DOMContentLoaded', () => {
    render();
    // rows and screenshots come in while the popup is open, and the tab can go to another page
    setInterval(render, 1000);

    document.getElementById('engine-enabled').addEventListener('change', async event => {
        const key = document.getElementById('engine-switch').getAttribute('data-key');
        await background.browser.storage.local.set({[key]: event.target.checked ? '1' : '0'});
    });

    document.getElementById('screenshot').addEventListener('click', async event => {
        const button = event.currentTarget;
        taking = true;
        button.disabled = true;
        show('screenshot-status', 'Taking a screenshot…');
        try {
            const entry = await background.zoekplaatje.files.by_hand(current_tab.id);
            if (entry) {
                show('screenshot-status', 'Screenshot (by hand): ' + entry.status + (entry.file ? ', ' + entry.file.split('/').pop() : '') + '.');
            }
        } finally {
            taking = false;
            button.disabled = false;
        }
    });

    document.getElementById('open').addEventListener('click', () => {
        background.zoekplaatje.open_interface();
        window.close();
    });

    document.getElementById('settings').addEventListener('click', () => {
        background.zoekplaatje.open_interface('settings');
        window.close();
    });
});
