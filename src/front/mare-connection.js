// @ts-check

import {
    PROTO_HEARTBEAT,
    PROTO_BOOP_REQUEST,
    PROTO_COOLDOWN_QUERY,
    PROTO_BOOP_REPLY,
    PROTO_BOOP_REJECT,
    PROTO_BOOP_COUNT,
    PROTO_COOLDOWN_REPLY,
    PROTO_INVALID,
    TOO_MANY_COOLDOWN_FAILS_ERRCODE,
    HEARTBEAT_TIMEOUT
} from "../shared/protocol";

class BoopCountEvent extends Event {
    /**
     * Boop count.
     * @type {number}
     */
    #boopCount;

    /**
     * Create a new BoopCountEvent instance.
     * @param {number} boopCount The boop count.
     * @param {EventInit} [eventInitDict] Optional event initialization options.
     */
    constructor(boopCount, eventInitDict) {
        super('boopcount', eventInitDict);
        this.#boopCount = boopCount;
    }

    /**
     * Get the boop count.
     * @readonly
     * @returns {number} The boop count.
     */
    get boopCount() {
        return this.#boopCount;
    }
}

class BoopRejectedError extends Error {
    /**
     * Boop ID that was rejected.
     * @type {number}
     */
    #boopId;

    /**
     * Cooldown duration in milliseconds.
     * @type {number}
     */
    #cooldown;

    /**
     * Create a new BoopRejectedError instance.
     * @param {string} message The error message.
     * @param {number} boopId The ID of the boop that was rejected.
     * @param {number} cooldown The cooldown duration in milliseconds.
     */
    constructor(message, boopId, cooldown) {
        super(message);
        this.#boopId = boopId;
        this.#cooldown = cooldown;
        this.name = 'BoopRejectedError';
    }

    /**
     * Get the boop ID that was rejected.
     * @readonly
     * @returns {number} The boop ID.
     */
    get boopId() {
        return this.#boopId;
    }

    /**
     * Get the cooldown duration in milliseconds.
     * @readonly
     * @returns {number} The cooldown duration.
     */
    get cooldown() {
        return this.#cooldown;
    }
}

class BoopTimeoutError extends Error {
    /**
     * Boop ID that timed out.
     * @type {number}
     */
    #boopId;

    /**
     * Timeout duration in milliseconds.
     * @type {number}
     */
    #timeoutMs;

    /**
     * Create a new BoopTimeoutError instance.
     * @param {string} message The error message.
     * @param {number} boopId The ID of the boop that timed out.
     * @param {number} timeoutMs The timeout duration in milliseconds.
     */
    constructor(message, boopId, timeoutMs) {
        super(message);
        this.#boopId = boopId;
        this.#timeoutMs = timeoutMs;
        this.name = 'BoopTimeoutError';
    }

    /**
     * Get the boop ID that timed out.
     * @readonly
     * @returns {number} The boop ID.
     */
    get boopId() {
        return this.#boopId;
    }

    /**
     * Get the timeout duration in milliseconds.
     * @readonly
     * @returns {number} The timeout duration.
     */
    get timeoutMs() {
        return this.#timeoutMs;
    }
}

class MareNetworkError extends Error {
    /**
     * Create a new MareNetworkError instance.
     * @param {string} message The error message.
     */
    constructor(message) {
        super(message);
        this.name = 'MareNetworkError';
    }
}

class MareCloseEvent extends CloseEvent {
    /**
     * Flag indicating if the connection will be reestablished automatically.
     * @type {boolean}
     */
    #autoReconnect;

    /**
     * Create a new MareCloseEvent instance.
     * @param {boolean} [autoReconnect=true] Flag indicating if the connection will be reestablished automatically.
     * @param {CloseEventInit} [eventInitDict] Optional event initialization options.
     */
    constructor(autoReconnect = true, eventInitDict) {
        super('close', eventInitDict);
        this.#autoReconnect = autoReconnect;
    }

    /**
     * Check if the connection will be reestablished automatically.
     * @readonly
     * @returns {boolean} True if the connection will be reestablished, false otherwise.
     */
    get autoReconnect() {
        return this.#autoReconnect;
    }
}

// 5 seconds less than the timeout to allow for network delays
const HEARTBEAT_INTERVAL_MS = HEARTBEAT_TIMEOUT - 5_000;

const BACKOFF_BASE_MS = 1_000;
const BACKOFF_MAX_MS = 30_000;
const NOOP = () => { };

class MareConnection extends EventTarget {
    /**
     * URL to connect to.
     * @type {string}
     */
    #url;

    /**
     * WebSocket instance.
     * @type {WebSocket}
     */
    #ws;

    /**
     * Unhook WebSocket event handlers.
     * @type {() => void}
     */
    #unhookWS = NOOP;

    /**
     * Flag to indicate if the connection should be automatically reestablished after being closed.
     * @type {boolean}
     */
    #reconnectOnClose = true;

    /**
     * Flag to indicate if the connection should be reestablished immediately after being closed.
     * @type {boolean}
     */
    #reconnectImmediately = true;

    /**
     * Flag to indicate if the connection should be established after the window gains focus.
     * @type {boolean}
     */
    #connectOnFocus = false;

    /**
     * Number of consecutive reconnect attempts.
     * @type {number}
     */
    #reconnectAttempts = 0;

    /**
     * Backoff timeout ID.
     * @type {number | NodeJS.Timeout | null}
     */
    #backoffTimeout = null;

    /**
     * Heartbeat interval ID.
     * @type {number | NodeJS.Timeout | null}
     */
    #heartbeatInterval = null;

    /**
     * Last boop id.
     * @type {number}
     */
    #lastBoopId = 0;

    /**
     * Pending boops.
     * @type {Map<number, [() => void, (error: any) => void]>}
     */
    #pendingBoops = new Map();

    /**
     * Last cooldown query id.
     * @type {number}
     */
    #lastCooldownQueryId = 0;

    /**
     * Pending cooldown queries.
     * @type {Map<number, [(cooldown: number) => void, (error: any) => void]>}
     */
    #pendingCooldownQueries = new Map();

    /**
     * Create a new MareConnection instance.
     * @param {string} url The URL to connect to.
     */
    constructor(url) {
        super();

        if (typeof url !== 'string' || (!url.startsWith('ws://') && !url.startsWith('wss://'))) {
            throw new TypeError('Invalid URL');
        }
        try {
            new URL(url);
        } catch (e) {
            throw new TypeError('Invalid URL');
        }

        this.#url = url;
        this.#ws = new WebSocket(url);

        // Hook up WebSocket event handlers.
        this.#hookWS();

        window.addEventListener('focus', () => {
            if (this.#connectOnFocus) {
                this.#connectOnFocus = false;
                this.connect();
            }
        });
    }

    /**
     * Connect to the server.
     * @returns {void}
     */
    connect() {
        this.#reconnectOnClose = true;
        if (this.#ws.readyState === WebSocket.OPEN || this.#ws.readyState === WebSocket.CONNECTING) {
            // The websocket is already open or in the process of connecting.
            return;
        }
        if (this.#ws.readyState === WebSocket.CLOSING) {
            this.#reconnectImmediately = true;
            return;
        }
        if (this.#ws.readyState === WebSocket.CLOSED) {
            if (this.#backoffTimeout) return;
            this.#ws = new WebSocket(this.#url);
            this.#hookWS();
            return;
        }
        console.warn('WebSocket is in an unexpected state:', this.#ws.readyState);
    }

    /**
     * Disconnect from the server.
     * @returns {void}
     */
    disconnect() {
        this.#reconnectOnClose = false;
        this.#clearBackoff();
        if (this.#ws.readyState === WebSocket.CLOSED || this.#ws.readyState === WebSocket.CLOSING) {
            this.#reconnectImmediately = false;
            return;
        }
        if (this.#ws.readyState === WebSocket.OPEN || this.#ws.readyState === WebSocket.CONNECTING) {
            this.#ws.close();
            return;
        }
        console.warn('WebSocket is in an unexpected state:', this.#ws.readyState);
    }

    /**
     * Reconnect to the server.
     * @returns {void}
     */
    reconnect() {
        this.#reconnectOnClose = true;
        this.#clearBackoff();
        if (this.#ws.readyState === WebSocket.CLOSED) {
            this.connect();
            return;
        }
        if (this.#ws.readyState === WebSocket.CLOSING) {
            this.#reconnectImmediately = true;
            return;
        }
        if (this.#ws.readyState === WebSocket.OPEN || this.#ws.readyState === WebSocket.CONNECTING) {
            this.#reconnectImmediately = true;
            this.#ws.close();
            return;
        }
        console.warn('WebSocket is in an unexpected state:', this.#ws.readyState);
    }

    /**
     * Send a boop to the server.
     * @param {number} [timeoutMs] The timeout in milliseconds for the boop.
     * @return {Promise<void>} A promise that resolves when the boop is accepted or rejects if it is rejected/timed out/connection closes.
     */
    boop(timeoutMs) {
        if (typeof timeoutMs !== 'number' || timeoutMs < 0 || timeoutMs > Number.MAX_SAFE_INTEGER || isNaN(timeoutMs) || !isFinite(timeoutMs)) {
            timeoutMs = 0;
        }
        return new Promise((resolve, reject) => {
            if (this.#ws.readyState !== WebSocket.OPEN) {
                setTimeout(() => reject(new Error(this.#getWSStateMessage())), 0);
                return;
            }
            const boopId = ++this.#lastBoopId;
            this.#ws.send(PROTO_BOOP_REQUEST + boopId.toString(36));
            if (timeoutMs === 0) {
                this.#pendingBoops.set(boopId, [resolve, reject]);
                return;
            }
            const timeoutId = setTimeout(() => {
                this.#pendingBoops.delete(boopId);
                reject(new BoopTimeoutError(`Boop ${boopId} timed out after ${timeoutMs} ms`, boopId, timeoutMs));
            }, timeoutMs);
            const wrappedResolve = () => {
                clearTimeout(timeoutId);
                resolve();
            }
            const wrappedReject = (error) => {
                clearTimeout(timeoutId);
                reject(error);
            };
            this.#pendingBoops.set(boopId, [wrappedResolve, wrappedReject]);
        });
    }

    /**
     * Query the server for the current cooldown.
     * @param {number} timeoutMs The timeout in milliseconds for the cooldown query.
     * @return {Promise<number>} A promise that resolves with the cooldown in milliseconds or rejects if the query fails.
     */
    queryCooldown(timeoutMs) {
        if (typeof timeoutMs !== 'number' || timeoutMs < 0 || timeoutMs > Number.MAX_SAFE_INTEGER || isNaN(timeoutMs) || !isFinite(timeoutMs)) {
            timeoutMs = 0;
        }
        return new Promise((resolve, reject) => {
            if (this.#ws.readyState !== WebSocket.OPEN) {
                setTimeout(() => reject(new Error(this.#getWSStateMessage())), 0);
                return;
            }
            const cooldownQueryId = ++this.#lastCooldownQueryId;
            this.#ws.send(PROTO_COOLDOWN_QUERY + cooldownQueryId.toString(36));
            if (timeoutMs === 0) {
                this.#pendingCooldownQueries.set(cooldownQueryId, [resolve, reject]);
                return;
            }
            const timeoutId = setTimeout(() => {
                this.#pendingCooldownQueries.delete(cooldownQueryId);
                reject(new BoopTimeoutError(`Cooldown query ${cooldownQueryId} timed out after ${timeoutMs} ms`, cooldownQueryId, timeoutMs));
            }, timeoutMs);
            const wrappedResolve = (cooldown) => {
                clearTimeout(timeoutId);
                resolve(cooldown);
            }
            const wrappedReject = (error) => {
                clearTimeout(timeoutId);
                reject(error);
            };
            this.#pendingCooldownQueries.set(cooldownQueryId, [wrappedResolve, wrappedReject]);
        });
    }

    /**
     * Helper function to get a message based on the WebSocket state.
     * @returns {string} A message describing the current WebSocket state.
     */
    #getWSStateMessage() {
        switch (this.#ws.readyState) {
            case WebSocket.CONNECTING:
                return 'WebSocket is still connecting.';
            case WebSocket.CLOSING:
                return 'WebSocket is closing.';
            case WebSocket.CLOSED:
                return 'WebSocket is closed.';
        }
        return 'WebSocket is in an unexpected state (' + this.#ws.readyState + ').';
    }

    /**
     * Clear the backoff timeout if it exists.
     * @returns {void}
     */
    #clearBackoff() {
        if (this.#backoffTimeout) {
            clearTimeout(this.#backoffTimeout);
            this.#backoffTimeout = null;
        }
    }

    /**
     * Hook WebSocket event handlers.
     * @returns {void}
     */
    #hookWS() {
        const ws = this.#ws;
        this.#unhookWS();
        const onOpen = this.#onOpen.bind(this);
        const onMessage = this.#onMessage.bind(this);
        const onClose = this.#onClose.bind(this);
        const onError = this.#onError.bind(this);
        this.#unhookWS = () => {
            this.#unhookWS = NOOP;
            ws.removeEventListener('open', onOpen);
            ws.removeEventListener('message', onMessage);
            ws.removeEventListener('close', onClose);
            ws.removeEventListener('error', onError);
        };
        ws.addEventListener('open', onOpen);
        ws.addEventListener('message', onMessage);
        ws.addEventListener('close', onClose);
        ws.addEventListener('error', onError);
    }

    /**
     * Check if the window is focused.
     * @returns {boolean} True if the window is focused, false otherwise.
     */
    #isFocused() {
        return !!(typeof document?.hasFocus === 'function' && document.hasFocus());
    }

    /**
     * Send a heartbeat message to the server.
     * @returns {void}
     */
    #heartbeat() {
        if (this.#ws.readyState !== WebSocket.OPEN) {
            console.warn('Cannot send heartbeat, WebSocket is not open:', this.#ws.readyState);
            return;
        }
        this.#ws.send(PROTO_HEARTBEAT);
        console.log('Heartbeat sent');
    }

    /**
     * Handle WebSocket open events.
     * @param {Event} event The open event.
     * @return {void}
     */
    #onOpen(event) {
        this.#clearBackoff();
        this.dispatchEvent(new Event('open'));
        if (this.#heartbeatInterval != null) {
            clearInterval(this.#heartbeatInterval);
            this.#heartbeatInterval = null;
        }
        this.#heartbeatInterval = setInterval(this.#heartbeat.bind(this), HEARTBEAT_INTERVAL_MS);
    }

    /**
     * Handle incoming WebSocket messages.
     * @param {MessageEvent} event The message event.
     * @return {void}
     */
    #onMessage(event) {
        this.#reconnectAttempts = 0;
        const data = event?.data;
        if (typeof data !== 'string') {
            console.warn('Received invalid data:', { data });
            return;
        }

        if (data.length === 0) {
            console.warn('Received invalid data:', { data });
            return;
        }

        // Heartbeat acknowledgment
        if (data === PROTO_HEARTBEAT) {
            console.log('Heartbeat acknowledged');
            return;
        }

        // Invalid command message
        if (data === PROTO_INVALID) {
            console.warn('Server responded with "invalid command"');
            return;
        }

        // Boop count message
        if (data.startsWith(PROTO_BOOP_COUNT)) {
            const match = data.slice(PROTO_BOOP_COUNT.length).match(/^([0-9a-z]{1,11})$/);
            if (!match) {
                console.warn('Received invalid data:', { data });
                return;
            }
            const boopCount = parseInt(match[1], 36);
            this.dispatchEvent(new BoopCountEvent(boopCount));
            return;
        }

        // Boop acceptance
        if (data.startsWith(PROTO_BOOP_REPLY)) {
            const match = data.slice(PROTO_BOOP_REPLY.length).match(/^([0-9a-z]{1,11})$/);
            if (!match) {
                console.warn('Received invalid data:', { data });
                return;
            }
            const boopId = parseInt(match[1], 36);
            const boop = this.#pendingBoops.get(boopId);
            if (!boop) {
                console.warn('Received boop reply for unknown boop:', { boopId });
                return;
            }
            this.#pendingBoops.delete(boopId);
            const [resolve] = boop;
            resolve();
            return;
        }

        // Boop rejection
        if (data.startsWith(PROTO_BOOP_REJECT)) {
            const match = data.slice(PROTO_BOOP_REJECT.length).match(/^([0-9a-z]{1,11}),([0-9a-z]{1,11})$/);
            if (!match) {
                console.warn('Received invalid data:', { data });
                return;
            }
            const boopId = parseInt(match[1], 36);
            const cooldown = parseInt(match[2], 36);
            const boop = this.#pendingBoops.get(boopId);
            if (!boop) {
                console.warn('Received boop reject for unknown boop:', { boopId, cooldown });
                return;
            }
            this.#pendingBoops.delete(boopId);
            const [_, reject] = boop;
            reject(new BoopRejectedError(`Boop ${boopId} has been rejected due to boop rate limit. Cooldown: ${cooldown} ms`, boopId, cooldown));
            return;
        }

        // Cooldown query response
        if (data.startsWith(PROTO_COOLDOWN_REPLY)) {
            const match = data.slice(PROTO_COOLDOWN_REPLY.length).match(/^([0-9a-z]{1,11})(?:,([0-9a-z]{1,11}))?$/);
            if (!match) {
                console.warn('Received invalid data:', { data });
                return;
            }
            const cooldownQueryId = parseInt(match[1], 36);
            const cooldown = match[2] ? parseInt(match[2], 36) : 0;
            const query = this.#pendingCooldownQueries.get(cooldownQueryId);
            if (!query) {
                console.warn('Received cooldown query response for unknown query:', { cooldownQueryId, cooldown });
                return;
            }
            this.#pendingCooldownQueries.delete(cooldownQueryId);
            const [resolve] = query;
            resolve(cooldown);
            return;
        }

        console.warn('Received invalid data:', { data });
    }

    /**
     * Handle WebSocket close events (inner method).
     * @param {CloseEvent} event The close event.
     * @returns {boolean} True if the connection will be reestablished, false otherwise.
     */
    #onCloseInner(event) {
        // Clear the heartbeat interval if it exists.
        if (this.#heartbeatInterval != null) {
            clearInterval(this.#heartbeatInterval);
            this.#heartbeatInterval = null;
        }

        // Reject all pending boops and cooldown queries.
        for (const [boopId, [_, reject]] of this.#pendingBoops.entries()) {
            reject(new MareNetworkError(`Boop ${boopId} failed due to connection close`));
        }
        this.#pendingBoops.clear();
        for (const [cooldownQueryId, [_, reject]] of this.#pendingCooldownQueries.entries()) {
            reject(new MareNetworkError(`Cooldown query ${cooldownQueryId} failed due to connection close`));
        }
        this.#pendingCooldownQueries.clear();

        // Unhook WebSocket event handlers.
        this.#unhookWS();

        // If the close event has a code indicating too many cooldown fails,
        // (a.k.a. the server has kicked us for exceeding the rate limit)
        // we should reset the connection state and not attempt to reconnect.
        if (event.code === TOO_MANY_COOLDOWN_FAILS_ERRCODE) {
            this.#reconnectOnClose = false;
            this.#reconnectImmediately = false;
            this.#connectOnFocus = false;
            this.#reconnectAttempts = 0;
            this.#clearBackoff();
            return false;
        }

        // If the reconnectOnClose flag is false (e.g. user called disconnect),
        // we should not attempt to reconnect.
        if (!this.#reconnectOnClose) {
            return false;
        }

        // If we are not reconnecting immediately and the window is not focused,
        // set the falg to reconnect on focus.
        if (!this.#reconnectImmediately && !this.#isFocused()) {
            this.#connectOnFocus = true;
            return true;
        }

        const tryReconnect = () => {
            this.#ws = new WebSocket(this.#url);
            this.#reconnectImmediately = false;
            this.#hookWS();
        };

        // If we were instructed to reconnect immediately, do so.
        if (this.#reconnectImmediately) {
            tryReconnect();
            return true;
        }

        // Otherwise, reconnect after a backoff delay.
        this.#reconnectAttempts++;
        const delay = Math.min(
            BACKOFF_BASE_MS * Math.pow(2, this.#reconnectAttempts - 1),
            BACKOFF_MAX_MS
        );
        console.info(`Backoff delay: ${delay} ms (attempt ${this.#reconnectAttempts})`);

        this.#backoffTimeout = setTimeout(() => {
            this.#backoffTimeout = null;
            tryReconnect();
        }, delay);
        return true;
    }


    /**
     * Handle WebSocket close events.
     * @param {CloseEvent} event The close event.
     * @return {void}
     */
    #onClose(event) {
        const autoReconnect = this.#onCloseInner(event);
        setTimeout(() => this.dispatchEvent(new MareCloseEvent(autoReconnect, {
            code: event.code,
            reason: event.reason,
            wasClean: event.wasClean
        })), 0);
    }

    /**
     * Handle WebSocket error events.
     * @param {Event} event The error event.
     * @return {void}
     */
    #onError(event) {
        console.error('WebSocket error:', event);
        this.dispatchEvent(new Event('error'));
    }
}

export {
    MareConnection,
    BoopCountEvent,
    BoopRejectedError,
    BoopTimeoutError,
    MareNetworkError,
    MareCloseEvent
};