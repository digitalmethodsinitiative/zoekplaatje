
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