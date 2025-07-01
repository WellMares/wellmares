// @ts-check
import { WorkerEntrypoint } from "cloudflare:workers";
import { cert, deleteApp, initializeApp } from "firebase-admin/app";
import { getAuth } from 'firebase-admin/auth';

/**
 * Put your custom environment variables and bindings you defined in the Dashboard and/or wrangler.toml here.
 * @typedef {Object} Env
 * @property {string} FIREBASE_SAK_JSON The Firebase service account key.
 */

/**
 * @type {WorkerEntrypoint<Env>}
 */
export default class FirebaseTokenService extends WorkerEntrypoint {
    /**
     * @override
     * Default fetch handler for the Worker.
     * 
     * @param {Request} request The incoming request.
     * @returns {Response} The response to be sent back to the client.
     */
    fetch(request) { return new Response(null, { status: 404 }); }

    /**
     * Generates a Firebase custom token for the given user ID.
     * 
     * @param {string} uid The user ID for which to generate the token.
     * @return {Promise<string>} A promise that resolves to the custom token.
     */
    async generateToken(uid) {
        const appName = `FTS-${crypto.randomUUID()}`;
        /** @type {import('firebase-admin/app').App | null} */
        let app = null;
        try {
            app = initializeApp({
                credential: cert(JSON.parse(this.env.FIREBASE_SAK_JSON)),
            }, appName);
            return await getAuth(app).createCustomToken(uid);
        } catch (error) {
            console.error(`[${appName}] Error generating Firebase token for UID ${uid}:`, error);
            const anyError = /** @type {any} */ (error);
            let errorMsg = "";
            let errorName = "";
            try {
                errorMsg = anyError.message || errorMsg;
            } catch (e) { }
            try {
                errorName = anyError.name || errorName;
            } catch (e) { }
            if (!errorMsg) {
                try {
                    errorMsg = `${error}`;
                } catch (e) { }
            }
            errorMsg = errorMsg || "Failed to generate Firebase token";
            errorName = errorName || Error.name;
            const e = new Error(errorMsg);
            e.name = errorName;
            throw e;
        } finally {
            if (app) {
                try {
                    await deleteApp(app);
                } catch (err) {
                    console.error(`[${appName}] Error deleting Firebase app:`, err);
                }
            }
        }
    }
}