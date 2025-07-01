// @ts-check

/**
 * Checks if a value is an object.
 * 
 * @param {any} value The value to check.
 * @returns {value is Record<string, any>} True if the value is an object, false otherwise.
 */
function isObject(value) {
    return value != null && typeof value === 'object' && !Array.isArray(value);
}

export { isObject };