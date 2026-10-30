
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

/**
 * Parse each element with a callback, safely
 *
 * If the callback throws for one element, that element is logged and skipped,
 * so that one unusual result does not lose the other results of the page.
 * The callback can return one item, a list of items, or nothing.
 *
 * @param elements  Elements (or other values) to parse
 * @param callback  Function that gets an element and its position
 * @returns {Array}  The items, in order
 */
function parse_each(elements, callback) {
    let items = [];
    Array.from(elements || []).forEach((element, index) => {
        try {
            const result = callback(element, index);
            if (Array.isArray(result)) {
                items = items.concat(result.filter(item => item));
            } else if (result) {
                items.push(result);
            }
        } catch (error) {
            console.warn('Zoekplaatje: could not parse an element', error, element);
        }
    });
    return items;
}