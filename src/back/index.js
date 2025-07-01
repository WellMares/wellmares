// @ts-check
/// <reference types="@cloudflare/workers-types" />
import { WorkerEntrypoint } from "cloudflare:workers";
import { WellMaresWSHandler } from "./ws-handler";
import { handleCron } from "./cron-handler";

/**
 * Put your custom environment variables and bindings you defined in the Dashboard and/or wrangler.toml here.
 * @typedef {Object} Env
 * @property {Fetcher} ASSETS The static assets for the worker.
 * @property {string} FIREBASE_CONFIG The Firebase configuration JSON string.
 * @property {string} FIREBASE_TOKEN_PREFIX The prefix for Firebase tokens.
 * @property {KVNamespace} FIREBASE_TOKEN_CACHE The Firebase token cache KV.
 * @property {Fetcher<import('../firebase-token-service').default>} FIREBASE_TOKEN_SERVICE The Firebase token service binding.
 */

// Constants for WebSocket pair indices
const CLIENT = 0;
const SERVER = 1;

/**
 * @type {WorkerEntrypoint<Env>}
 */
export default class WellMaresWSServer extends WorkerEntrypoint {
    /**
     * @override
     * Handles incoming requests to the worker.
     * 
     * @param {Request} request The incoming request.
     * @returns {Promise<Response> | Response} The response to be sent back to the client.
     */
    fetch(request) {
        const url = new URL(request.url);

        if (url.pathname === "/ws") {
            return this.#handleWebSocket(request);
        }

        return new Response(null, { status: 404 });
    }

    /**
     * Handles WebSocket requests.
     * 
     * @param {Request} request The incoming request.
     * @returns {Promise<Response>} The response to be sent back to the client.
     */
    async #handleWebSocket(request) {
        const upgradeHeader = request.headers.get("Upgrade");
        if (upgradeHeader !== "websocket") {
            return new Response("Expected WebSocket Upgrade", { status: 426 });
        }
        const pair = new WebSocketPair();
        try {
            const webSocketHandler = new WellMaresWSHandler(this.env, request, pair[SERVER]);
            // Give the WebSocket handler access our waitUntil method
            webSocketHandler.waitUntil = (promise) => {
                this.ctx.waitUntil(promise);
            };
            await webSocketHandler.init();
        } catch (error) {
            console.error("Error in WebSocket handler:", error);
        }
        return new Response(null, {
            status: 101,
            webSocket: pair[CLIENT],
        });
    }

    /**
     * @override
     * Handles cron triggers.
     * 
     * @param {ScheduledController} controller The scheduled controller.
     * @returns {void | Promise<void>} Nothing to do here.
     */
    scheduled(controller) {
        controller.noRetry();
        return handleCron(this.env);
    }
}