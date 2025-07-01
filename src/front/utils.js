// @ts-check

/**
 * Retrieves the value of a CSS variable from the document's root element.
 * 
 * @param {string} name The name of the CSS variable (e.g., '--my-variable').
 * @returns {string | null} The value of the CSS variable, or null if not found or if the environment does not support it.
 */
function getCssVariable(name) {
    if (typeof name !== 'string' || !name.startsWith('--')) {
        throw new TypeError('CSS variable name must be a string starting with "--".');
    }
    if (!globalThis.document || !globalThis.document.documentElement || typeof getComputedStyle !== 'function') {
        return null;
    }
    const root = document.documentElement;
    const computedStyle = getComputedStyle(root);
    if (!computedStyle || typeof computedStyle.getPropertyValue !== 'function') {
        return null;
    }
    const valueRaw = computedStyle.getPropertyValue(name);
    if (typeof valueRaw !== 'string') {
        return null;
    }
    const value = valueRaw.trim();
    if (value === '') {
        return null;
    }
    return value;
}

/**
 * Parses a CSS duration string and returns the duration in milliseconds.
 * 
 * @param {string} duration The CSS duration string (e.g., '500ms', '2s').
 * @returns {number} The duration in milliseconds, or NaN if the input is invalid.
 */
function parseCssDuration(duration, defaultValue = 0) {
    if (typeof duration !== 'string') {
        return defaultValue;
    }

    let multiplier = 1;
    if (duration.endsWith('ms')) {
        multiplier = 1;
        duration = duration.slice(0, -2);
    } else if (duration.endsWith('s')) {
        multiplier = 1000;
        duration = duration.slice(0, -1);
    } else {
        return defaultValue;
    }

    const parsedValue = parseFloat(duration);
    if (isNaN(parsedValue)) {
        return defaultValue;
    }

    return parsedValue * multiplier;
}

export { getCssVariable, parseCssDuration };