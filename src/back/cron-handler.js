// @ts-check

import { deleteApp, initializeApp } from "firebase/app";
import { getAuth, signInWithCustomToken } from "firebase/auth";
import {
    get,
    getDatabase,
    ref,
    remove,
    set
} from "firebase/database";
import { isTokenData, isValidBPHEntry } from "./utils";
import { isObject } from "../shared/utils";
import {
    BPH_KEY,
    BPH_VALID_UNTIL,
    FB_TOKEN_TTL,
    FB_TOKEN_TTL_S,
    FB_TOKEN_CLOSE_CALL_THRESHOLD,
    ONE_HOUR,
    FB_TOKEN_USER_ID
} from "./constants";

/** @typedef {import('./index').Env} Env */

/** 
 * Cleans up stale BPH entries.
 * 
 * @param {Env} env The environment variables and bindings.
 * @returns {Promise<void>} A promise that resolves when the cron job is handled.
 */
async function handleCron(env) {
    const appName = `WM-${crypto.randomUUID()}`;
    const app = initializeApp(JSON.parse(env.FIREBASE_CONFIG), appName);
    try {
        const auth = getAuth(app);
        const token = await getToken(appName, env, FB_TOKEN_USER_ID);
        const creds = await signInWithCustomToken(auth, token);
        const db = getDatabase(app);
        const bphRootRef = ref(db, BPH_KEY);
        const bphRootSS = await get(bphRootRef);
        const bphRootSSVal = bphRootSS.val();
        if (!isObject(bphRootSSVal)) {
            await set(bphRootRef, {});
            return;
        }

        const now = Date.now();
        /** @type {Array<string>} */
        const toRemove = [];
        for (const [cleintId, bphEntries] of Object.entries(bphRootSSVal)) {
            if (!isObject(bphEntries)) {
                console.warn(`[${appName}] Invalid BPH entries for client ${cleintId}:`, { bphEntries });
                toRemove.push(`${BPH_KEY}/${cleintId}`);
                continue;
            }
            for (const [key, value] of Object.entries(bphEntries)) {
                if (!isValidBPHEntry(value)) {
                    console.warn(`[${appName}] Invalid BPH entry for client ${cleintId}, key ${key}:`, { value });
                    toRemove.push(`${BPH_KEY}/${cleintId}/${key}`);
                    return;
                }

                // Add one hour just to be sure it is truly stale
                const validUntil = value[BPH_VALID_UNTIL] + ONE_HOUR;
                if (validUntil < now) {
                    toRemove.push(`${BPH_KEY}/${cleintId}/${key}`);
                }
            }
        }

        const promises = [];
        for (const key of toRemove) {
            const refToRemove = ref(db, key);
            promises.push(remove(refToRemove).catch((err) => {
                console.error(`[${appName}] Error removing BPH entry ${key}:`, err);
            }));
        }
        await Promise.all(promises);
    } finally {
        try {
            await deleteApp(app);
        } catch (err) {
            console.error(`[${appName}] Error deleting Firebase app:`, err);
        }
    }
}

/**
 * Gets a Firebase custom token for the specified user ID.
 * 
 * @param {string} appName The name of the Firebase app instance.
 * @param {Env} env The environment variables and bindings.
 * @param {string} uid The user ID for which to generate the token.
 * @returns {Promise<string>} A promise that resolves to the custom token.
 */
async function getToken(appName, env, uid) {
    const now = Date.now();
    const tokenKey = `firebase_token:${env.FIREBASE_TOKEN_PREFIX}:${uid}`;
    const kvResp = await env.FIREBASE_TOKEN_CACHE.get(tokenKey, "json").catch((err) => {
        console.error(`[${appName}] Firebase token KV get error:`, err);
        return null;
    });
    /** @type {string | null} */
    let token = null;
    let expiresAt = 0;

    if (isTokenData(kvResp) && kvResp.expiresAt > now + FB_TOKEN_CLOSE_CALL_THRESHOLD) {
        token = kvResp.token;
        expiresAt = kvResp.expiresAt;
    } else {
        console.info(`[${appName}] Firebase token KV miss or expired, generating new token for UID: ${uid}`);
        token = await env.FIREBASE_TOKEN_SERVICE.generateToken(uid).catch((err) => {
            console.error(`[${appName}] Firebase token generation error for UID ${uid}:`, err);
            return null;
        });
        if (token === null) {
            throw new Error(`Failed to generate token for UID: ${uid}`);
        }
        expiresAt = now + FB_TOKEN_TTL;

        await env.FIREBASE_TOKEN_CACHE.put(
            tokenKey,
            JSON.stringify({ token, expiresAt }),
            { expirationTtl: FB_TOKEN_TTL_S }
        ).catch((err) => {
            console.error(`[${appName}] Firebase token KV put error for UID ${uid}:`, err);
            // If we fail to store the token in KV, we still return the token
            // but it won't be cached for future requests.
        });
    }

    return token;
}

export { handleCron }
