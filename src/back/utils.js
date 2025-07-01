// @ts-check

import { BPH_CHANGE, BPH_VALID_UNTIL } from "./constants";

/**
 * @typedef {Object} TokenData
 * @property {string} token - The Firebase custom token.
 * @property {number} expiresAt - The expiration time of the token in milliseconds since epoch.
 */

/**
 * Checks if the given data is a valid TokenData object.
 *
 * @param {any} data - The data to check.
 * @returns {data is TokenData} True if valid TokenData, false otherwise.
 */
function isTokenData(data) {
    return (
        data != null &&
        typeof data === 'object' &&
        !Array.isArray(data) &&
        Object.keys(data).length === 2 &&
        typeof data.expiresAt === 'number' &&
        typeof data.token === 'string'
    );
}

/**
 * Checks if the given value is a valid boops per hour entry.
 * 
 * @param {any} val The value to check.
 * @return {val is [number, number]}
 */
function isValidBPHEntry(val) {
    return Array.isArray(val) && val.length === 2 &&
        typeof val[BPH_VALID_UNTIL] === 'number' && val[BPH_VALID_UNTIL] > 0 &&
        !isNaN(val[BPH_VALID_UNTIL]) && typeof val[BPH_CHANGE] === 'number';
}

export {
    isTokenData,
    isValidBPHEntry,
};