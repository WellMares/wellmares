// @ts-check
// Import this module BEFORE any 3-rd party library that uses WebSocket to ensure the patch runs 
// before they cache the WebSocket implementation.

const _globalThis = /** @type {any} */ (globalThis);
const WebSocketOriginal = _globalThis.WebSocket;
_globalThis.WebSocket = class PatchedWebSocket extends WebSocketOriginal {
    /**
     * Creates a new PatchedWebSocket instance.
     * @param {...any} args - Arguments to pass to the WebSocket constructor.
     */
    constructor(...args) {
        if (args.length >= 2 && Array.isArray(args[1]) && args[1].length === 0) {
            // This is because the WebSocket constructor in Cloudflare Workers, unlike in browsers,
            // doesn't treat an empty protocols array as no protocols and instead throws an error.
            // This patch is necessary to expand compatibility of 3rd-party libraries with Cloudflare Workers.
            args[1] = undefined;
        }
        super(...args);
    }
};

/**
 * Unpatches the global WebSocket constructor, restoring the original implementation.
 * @return {void}
 */
export function unpatchGlobalWebSocket() {
    _globalThis.WebSocket = WebSocketOriginal;
}