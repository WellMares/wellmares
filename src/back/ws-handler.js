// @ts-check
/// <reference types="@cloudflare/workers-types" />
import { unpatchGlobalWebSocket } from "./patch-global-websocket";
import { deleteApp, initializeApp } from "firebase/app";
import {
    HEARTBEAT_TIMEOUT,
    INTERNAL_SERVER_ERROR_ERRCODE,
    INTERNAL_SERVER_ERROR_ERRMSG,
    NO_HEARTBEAT_ERRCODE,
    NO_HEARTBEAT_ERRMSG,
    TOO_MANY_COOLDOWN_FAILS_ERRCODE,
    TOO_MANY_COOLDOWN_FAILS_ERRMSG,
    PROTO_HEARTBEAT,
    PROTO_BOOP_REQUEST,
    PROTO_COOLDOWN_QUERY,
    PROTO_BOOP_REPLY,
    PROTO_BOOP_REJECT,
    PROTO_COOLDOWN_REPLY,
    PROTO_INVALID,
    PROTO_BOOP_COUNT
} from "../shared/protocol";
import {
    ONE_MINUTE,
    ONE_HOUR,
    FB_TOKEN_TTL,
    FB_TOKEN_TTL_S,
    FB_TOKEN_CLOSE_CALL_THRESHOLD,
    FB_TOKEN_USER_ID,
    BPH_VALID_UNTIL,
    BPH_CHANGE,
    CD_FAIL_LIMIT,
    BPH_KEY,
    BPH_SYNC_INTERVAL,
    BPH_LIMIT,
    BPM_LIMIT,
    GBC_KEY,
    GBC_SYNC_INTERVAL
} from "./constants";
import { isObject } from "../shared/utils";
import { isTokenData, isValidBPHEntry } from "./utils";
import { getAuth, signInWithCustomToken } from "firebase/auth";
import {
    getDatabase,
    ref,
    get,
    set,
    push,
    remove,
    increment,
    onChildAdded,
    onChildRemoved,
    onValue
} from "firebase/database";

/** @typedef {import("./index").Env} Env */

unpatchGlobalWebSocket();

const NOOP = () => { };

class WellMaresWSHandler {
    /**
     * The environment variables.
     * @type {Env}
     */
    #env;

    /**
     * The host of the request.
     * @type {string}
     */
    #host;

    /**
     * The waitUntil function to extend the lifetime of the request.
     * @type {(promise: Promise<void>) => void}
     */
    #waitUntil = NOOP;

    /**
     * The WebSocket server.
     * @type {WebSocket}
     */
    #ws;

    /**
     * The client ID.
     * @type {string}
     */
    #id;

    /**
     * Firebase app name.
     * @type {string}
     */
    #appName = `WM-${crypto.randomUUID()}`;

    /**
     * The Firebase app instance.
     * @type {import("firebase/app").FirebaseApp}
     */
    #app;

    /**
     * The Firebase authentication instance.
     * @type {import("firebase/auth").Auth}
     */
    #auth;

    /**
     * The Firebase Realtime Database instance.
     * @type {import("firebase/database").Database}
     */
    #db = /** @type {any} */ (null);

    /**
     * The Boops per Hour (BPH) reference.
     * @type {import("firebase/database").DatabaseReference}
     */
    #bphRef = /** @type {any} */ (null);

    /**
     * The Global Boops Count (GBC) reference.
     * @type {import("firebase/database").DatabaseReference}
     */
    #gbcRef = /** @type {any} */ (null);

    /**
     * The last Global Boops Count (GBC) value.
     * @type {number}
     */
    #lastGBC = 0;

    /**
     * The last Global Boops Count (GBC) sync timestamp.
     * @type {number}
     */
    #lastGBCSync = 0;

    /**
     * The unsynced Global Boops Count (GBC) value.
     * @type {number}
     */
    #unsyncedGBC = 0;


    /**
     * Whether the Global Boops Count (GBC) sync interval warning has been shown.
     * @type {boolean}
     */
    #gbcSyncInterwalWarningShown = false;

    /**
     * The bound Global Boops Count (GBC) sync function.
     * @type {() => Promise<void>}
     */
    #boundGBCSync;

    /**
     * The Boops per Hour (BPH) data.
     * @type {Record<string, [number, number]>}
     */
    #bph = {};

    /**
     * The last Boops per Hour (BPH) sum.
     * @type {number}
     */
    #lastBPH = 0;

    /**
     * The unsynced Boops per Hour (BPH) value.
     * @type {number}
     */
    #unsyncedBPH = 0;

    /**
     * The cooldown until timestamp.
     * @type {number}
     */
    #cooldownUntil = 0;

    /**
     * The number of consecutive cooldown failures.
     * @type {number}
     */
    #cooldownFails = 0;

    /**
     * The Boops per Minute (BPM) timestamps.
     * @type {number[]}
     */
    #bpmBoops = [];

    /**
     * The heartbeat timeout.
     * @type {NodeJS.Timeout | number | null}
     */
    #heartbeatTimeout = null;

    /**
     * The Boops per Hour (BPH) sync interval.
     * @type {NodeJS.Timeout | number}
     */
    #bphSyncInterval = /** @type {any} */ (null);

    /**
     * The Boops per Hour (BPH) child added listener.
     * @type {() => void}
     */
    #offBPHChildAdded = NOOP;

    /**
     * The Boops per Hour (BPH) child removed listener.
     * @type {() => void}
     */
    #offBPHChildRemoved = NOOP;

    /**
     * The Global Boops Count (GBC) change listener.
     * @type {() => void}
     */
    #offGBCChange = NOOP;

    /**
     * The Global Boops Count (GBC) sync timeout.
     * @type {NodeJS.Timeout | number}
     */
    #gbcSyncTimeout = /** @type {any} */ (null);

    /**
     * The promise for the Global Boops Count (GBC) sync.
     * @type {Promise<void> | null}
     */
    #gbcSyncPromise = null;

    /**
     * The Boops per Hour (BPH) remove timeouts.
     * @type {Map<string, NodeJS.Timeout>}
     */
    #bphRemoveTimeouts = new Map();

    /**
     * The promise that resolves when the WebSocket handler is initialized.
     * @type {Promise<void>}
     */
    #initPromise;

    /**
     * Creates a new WebSocket handler.
     * 
     * @param {Env} env The environment variables.
     * @param {Request} request The incoming request.
     * @param {WebSocket} ws The WebSocket server instance.
     */
    constructor(env, request, ws) {
        this.#env = env;
        const url = new URL(request.url);
        this.#host = url.host;
        this.#ws = ws;
        const ip = request.headers.get('cf-connecting-ip') || request.headers.get('x-forwarded-for') || request.headers.get('x-real-ip') || 'default';
        if (ip === 'default') {
            console.warn(`[${this.#appName}] No IP address found in request headers, using 'default' as fallback.`);
        }
        this.#id = `c${btoa(ip).replace(/=/g, '')}`;

        this.#boundGBCSync = this.#gbcSync.bind(this);

        this.#app = initializeApp(JSON.parse(env.FIREBASE_CONFIG), this.#appName);
        this.#auth = getAuth(this.#app);

        this.#initPromise = this.#asyncInit();
    }

    /**
     * Sets the waitUntil function to extend the lifetime of the request.
     * 
     * @param {(promise: Promise<void>) => void} waitUntil The waitUntil function.
     * @return {void}
     */
    set waitUntil(waitUntil) {
        this.#waitUntil = waitUntil;
    }

    /**
     * Awaits the initialization of the WebSocket handler.
     * 
     * @return {Promise<void>} A promise that resolves when the WebSocket handler is initialized.
     */
    init() {
        return this.#initPromise;
    }

    /**
     * Asynchronously initializes the WebSocket handler.
     * 
     * @return {Promise<void>} A promise that resolves when the WebSocket handler is initialized.
     */
    async #asyncInit() {
        try {
            await this.#signIn();
        } catch (error) {
            console.error(`[${this.#appName}] Failed to sign in to Firebase:`, error);
            this.#ws.accept();
            this.#ws.close(INTERNAL_SERVER_ERROR_ERRCODE, INTERNAL_SERVER_ERROR_ERRMSG);
            return;
        }

        this.#db = getDatabase(this.#app);

        const results = await Promise.allSettled([
            this.#initBPH(),
            this.#initGBC(),
        ]);
        if (results[0].status === 'rejected' || results[1].status === 'rejected') {
            if (results[0].status === 'rejected') {
                console.error(`[${this.#appName}] Failed to initialize Boops per Hour (BPH):`, results[0].reason);
            }
            if (results[1].status === 'rejected') {
                console.error(`[${this.#appName}] Failed to initialize Global Boops Count (GBC):`, results[1].reason);
            }
            this.#ws.accept();
            this.#ws.close(INTERNAL_SERVER_ERROR_ERRCODE, INTERNAL_SERVER_ERROR_ERRMSG);
            return;
        }
        this.#afterAsyncInit();
    }

    /**
     * Handles the post-async initialization of the WebSocket handler.
     * 
     * @return {void}
     */
    #afterAsyncInit() {
        // Set up the WebSocket connection
        this.#ws.accept();
        this.#resetHeartbeatTimeout();

        // Socket event listeners
        this.#ws.addEventListener('message', this.#onMessage.bind(this));
        this.#ws.addEventListener('close', this.#onClose.bind(this));

        // Send initial boop count
        this.#sendBoopCount();
    }

    /**
     * Gets the Firebase custom token for the given user ID.
     * 
     * @param {string} uid The user ID for which to get the token.
     * @return {Promise<string>} A promise that resolves to the custom token.
     */
    async #getToken(uid) {
        const tokenKey = `firebase_token:${this.#env.FIREBASE_TOKEN_PREFIX}:${uid}`;
        const cacheKey = new Request(`https://${this.#host}/${this.#env.FIREBASE_TOKEN_PREFIX}/${uid}/token`);

        const cache = caches.default;
        let cacheResp = await cache.match(cacheKey).catch((err) => {
            console.error(`[${this.#appName}] Firebase token cache match error:`, err);
            return null;
        });
        const now = Date.now();

        if (cacheResp) {
            const cachedValue = await cacheResp.json().catch((err) => {
                console.error(`[${this.#appName}] Firebase token cache JSON parse error:`, err);
                return null;
            });

            if (isTokenData(cachedValue) && cachedValue.expiresAt > now + FB_TOKEN_CLOSE_CALL_THRESHOLD) {
                console.info(`[${this.#appName}] Firebase token cache hit for UID: ${uid}`);
                return cachedValue.token;
            }

            await cache.delete(cacheKey).catch((err) => {
                console.error(`[${this.#appName}] Firebase token cache delete error:`, err);
            });
        }

        console.info(`[${this.#appName}] Firebase token cache miss or expired, checking KV...`);

        const kvResp = await this.#env.FIREBASE_TOKEN_CACHE.get(tokenKey, "json").catch((err) => {
            console.error(`[${this.#appName}] Firebase token KV get error:`, err);
            return null;
        });
        /** @type {string | null} */
        let token = null;
        let expiresAt = 0;
        if (isTokenData(kvResp) && kvResp.expiresAt > now + FB_TOKEN_CLOSE_CALL_THRESHOLD) {
            token = kvResp.token;
            expiresAt = kvResp.expiresAt;
        } else {
            console.info(`[${this.#appName}] Firebase token KV miss or expired, generating new token for UID: ${uid}`);
            token = await this.#env.FIREBASE_TOKEN_SERVICE.generateToken(uid).catch((err) => {
                console.error(`[${this.#appName}] Firebase token generation error for UID ${uid}:`, err);
                return null;
            });
            if (token === null) {
                throw new Error(`Failed to generate token for UID: ${uid}`);
            }
            expiresAt = now + FB_TOKEN_TTL;

            await this.#env.FIREBASE_TOKEN_CACHE.put(
                tokenKey,
                JSON.stringify({ token, expiresAt }),
                { expirationTtl: FB_TOKEN_TTL_S }
            ).catch((err) => {
                console.error(`[${this.#appName}] Firebase token KV put error for UID ${uid}:`, err);
                // If we fail to store the token in KV, we still return the token
                // but it won't be cached for future requests.
            });
        }

        const ttl = Math.floor((expiresAt - now) / 1000);
        /** @type {import("./utils").TokenData} */
        const tokenData = { token, expiresAt };
        cacheResp = Response.json(tokenData, {
            headers: { 'Cache-Control': `public, max-age=${ttl}` }
        });
        await cache.put(cacheKey, cacheResp).catch((err) => {
            console.error(`[${this.#appName}] Firebase token cache put error for UID ${uid}:`, err);
            // If we fail to store the token in cache, we still return the token
            // but it won't be cached for future requests.
        });

        return token;
    }

    /**
     * Signs in to Firebase using a custom token.
     * 
     * @return {Promise<void>} A promise that resolves when the sign-in is complete.
     */
    async #signIn() {
        const token = await this.#getToken(FB_TOKEN_USER_ID);
        const creds = await signInWithCustomToken(this.#auth, token);
    }

    /**
     * Initializes the Boops per Hour (BPH) reference and sets up listeners.
     * 
     * @return {Promise<void>} A promise that resolves when the BPH reference is initialized.
     */
    async #initBPH() {
        const bphRootRef = ref(this.#db, BPH_KEY);
        const bphRootSS = await get(bphRootRef);
        const bphRootSSVal = bphRootSS.val();
        if (!isObject(bphRootSSVal)) {
            await set(bphRootRef, {});
        }
        this.#bphRef = ref(this.#db, `${BPH_KEY}/${this.#id}`);
        this.#bphSyncInterval = setInterval(this.#syncBPH.bind(this), BPH_SYNC_INTERVAL);
        this.#offBPHChildAdded = onChildAdded(this.#bphRef, this.#onBPHChildAdded.bind(this));
        this.#offBPHChildRemoved = onChildRemoved(this.#bphRef, this.#onBPHChildRemoved.bind(this));
        const bphSS = await get(this.#bphRef);
        const bphSSVal = bphSS.val();
        if (!isObject(bphSSVal)) {
            if (bphSSVal != null) {
                console.warn(`[${this.#appName}] Invalid Boops per Hour (BPH) data for client ${this.#id}, resetting.`);
            }
            await set(this.#bphRef, {});
        }
    }

    /**
     * Initializes the Global Boops Count (GBC) reference and sets up listeners.
     * 
     * @return {Promise<void>} A promise that resolves when the GBC reference is initialized.
     */
    async #initGBC() {
        this.#gbcRef = ref(this.#db, GBC_KEY);
        const gbcSS = await get(this.#gbcRef);
        let gbcSSVal = gbcSS.val();
        if (gbcSSVal != null && (typeof gbcSSVal !== 'number' || gbcSSVal < 0)) {
            console.warn(`[${this.#appName}] Invalid Global Boops Count (GBC) data for client ${this.#id}, resetting.`);
            gbcSSVal = null;
        }
        this.#lastGBC = gbcSSVal || 0;
        if (gbcSSVal == null) {
            await set(this.#gbcRef, 0);
        }

        this.#gbcSyncTimeout = setTimeout(this.#gbcSync.bind(this), GBC_SYNC_INTERVAL);
        this.#offGBCChange = onValue(this.#gbcRef, this.#onGBCChange.bind(this));
    }

    /**
     * Resets the heartbeat timeout.
     * 
     * @return {void}
     */
    #resetHeartbeatTimeout() {
        if (this.#heartbeatTimeout) {
            clearTimeout(this.#heartbeatTimeout);
        }
        this.#heartbeatTimeout = setTimeout(() => {
            this.#ws.close(NO_HEARTBEAT_ERRCODE, NO_HEARTBEAT_ERRMSG);
            this.#heartbeatTimeout = null;
        }, HEARTBEAT_TIMEOUT);
    }

    /**
     * Handles incoming WebSocket messages.
     * 
     * @param {MessageEvent} event The WebSocket message event.
     * @return {void}
     */
    #onMessage(event) {
        const data = event.data;
        if (typeof data !== 'string') {
            console.warn(`[${this.#appName}] Received non-string data from client ${this.#id}:`, { data });
            return;
        }

        if (data === PROTO_HEARTBEAT) {
            this.#ws.send(PROTO_HEARTBEAT);
            this.#resetHeartbeatTimeout();
            return;
        }

        const now = Date.now();
        if (data.startsWith(PROTO_BOOP_REQUEST)) {
            const match = data.slice(PROTO_BOOP_REQUEST.length).match(/^([\da-z]{1,11})$/);
            if (match) {
                this.#onBoop(now, parseInt(match[1], 36));
                return;
            }
        }

        if (data.startsWith(PROTO_COOLDOWN_QUERY)) {
            const match = data.slice(PROTO_COOLDOWN_QUERY.length).match(/^([\da-z]{1,11})$/);
            if (match) {
                this.#onCooldownQuery(parseInt(match[1], 36), now);
                return;
            }
        }

        console.warn(`[${this.#appName}] Received invalid data from client ${this.#id}:`, { data });
        this.#ws.send(PROTO_INVALID);
    }

    /**
     * Handles the WebSocket close event.
     * 
     * @param {CloseEvent} event The WebSocket close event.
     * @return {void}
     */
    #onClose(event) {
        // Clean up listeners, intervals, and timeouts
        this.#offGBCChange();
        clearTimeout(this.#gbcSyncTimeout);
        this.#offBPHChildAdded();
        this.#offBPHChildRemoved();
        clearInterval(this.#bphSyncInterval);
        this.#bphRemoveTimeouts.forEach((timeout, key) => {
            clearTimeout(timeout);
        });
        this.#bphRemoveTimeouts.clear();
        if (this.#heartbeatTimeout) clearTimeout(this.#heartbeatTimeout);

        this.#waitUntil((async () => {
            await Promise.all([
                this.#gbcSync(Date.now() + GBC_SYNC_INTERVAL + ONE_MINUTE),
                this.#syncBPH(),
            ]);

            await deleteApp(this.#app).catch((err) => {
                console.error(`[${this.#appName}] Failed to delete Firebase app:`, err);
                return;
            });
        })());
    }

    /**
     * Handles a boop request from the client.
     * 
     * @param {number} now The current timestamp.
     * @param {number} boopId The boop ID sent by the client.
     * @return {void}
     */
    #onBoop(now, boopId) {
        if (this.#cooldownUntil !== 0) {
            if (now < this.#cooldownUntil) {
                if (this.#cooldownFails++ >= CD_FAIL_LIMIT) {
                    console.warn(`[${this.#appName}] Too many cooldown fails for client ${this.#id}, closing WebSocket.`);
                    this.#ws.close(TOO_MANY_COOLDOWN_FAILS_ERRCODE, TOO_MANY_COOLDOWN_FAILS_ERRMSG);
                    return;
                }
                // Reject the boop
                this.#ws.send(PROTO_BOOP_REJECT + boopId.toString(36) + ',' + (this.#cooldownUntil - now).toString(36));
                return;
            }
            this.#cooldownUntil = 0;
        }

        const cooldown = this.#getCooldown(now);
        if (cooldown !== 0) {
            this.#cooldownUntil = cooldown;
            // Reject the boop
            this.#ws.send(PROTO_BOOP_REJECT + boopId.toString(36) + ',' + (this.#cooldownUntil - now).toString(36));
            return;
        }

        this.#cooldownFails = 0;
        this.#unsyncedGBC++;
        this.#gbcSync(now);
        this.#bpmBoops.push(now);
        this.#unsyncedBPH++;

        // Acknowledge the boop to the client
        this.#ws.send(PROTO_BOOP_REPLY + boopId.toString(36));
        this.#sendBoopCount();
    }

    /**
     * Handles a cooldown query from the client.
     * 
     * @param {number} queryId The query ID sent by the client.
     * @param {number} now The current timestamp.
     * @return {void}
     */
    #onCooldownQuery(queryId, now) {
        if (this.#cooldownUntil !== 0) {
            if (now < this.#cooldownUntil) {
                // If we are still in cooldown, send the remaining time
                this.#ws.send(PROTO_COOLDOWN_REPLY + queryId.toString(36) + ',' + (this.#cooldownUntil - now).toString(36));
                return;
            }
            this.#cooldownUntil = 0;
        }

        const cooldown = this.#getCooldown(now);
        if (cooldown !== 0) {
            // If we are in cooldown, send the remaining time
            this.#cooldownUntil = cooldown;
            this.#ws.send(PROTO_COOLDOWN_REPLY + queryId.toString(36) + ',' + (this.#cooldownUntil - now).toString(36));
            return;
        }

        // If no cooldown is needed, send an empty response
        this.#ws.send(PROTO_COOLDOWN_REPLY + queryId.toString(36));
    }

    /**
     * Calculates the cooldown time based on the current state of boops.
     * 
     * @param {number} now The current timestamp.
     * @return {number} The cooldown time in milliseconds, or 0 if no cooldown is needed.
     */
    #getCooldown(now) {
        if (this.#lastBPH + this.#unsyncedBPH >= BPH_LIMIT) {
            const bphKeys = Object.keys(this.#bph).sort((a, b) => {
                return this.#bph[a][BPH_VALID_UNTIL] - this.#bph[b][BPH_VALID_UNTIL];
            });
            let virtualBPH = this.#lastBPH + this.#unsyncedBPH;
            let soonest = 0;

            // Virtually remove boop packs until we are below the limit
            for (const key of bphKeys) {
                const entry = this.#bph[key];
                soonest = entry[BPH_VALID_UNTIL];
                virtualBPH -= entry[BPH_CHANGE];
                if (virtualBPH < BPH_LIMIT) {
                    // If we are below the limit, break out of the loop
                    break;
                }
            }

            if (virtualBPH >= BPH_LIMIT) {
                // If even after subtracting all the boop packs we are still above the limit,
                // set the soonest to be one hour from now
                soonest = now + ONE_HOUR;
            }

            return now + Math.max(0, soonest - now);
        }

        if (this.#bpmBoops.length >= BPM_LIMIT) {
            const oldest = this.#bpmBoops[0];
            if (now - oldest >= ONE_MINUTE) {
                // Remove all boops older than one minute
                this.#bpmBoops = this.#bpmBoops.filter((timestamp) => now - timestamp < ONE_MINUTE);
                return 0;
            }

            return now + Math.max(0, ONE_MINUTE - (now - oldest));
        }

        return 0;
    }

    /**
     * Synchronizes the Boops per Hour (BPH) data with the Firebase database.
     * 
     * @return {Promise<void>} A promise that resolves when the synchronization is complete.
     */
    async #syncBPH() {
        if (this.#unsyncedBPH === 0) {
            return;
        }
        const validUntil = Date.now() + ONE_HOUR;
        const change = this.#unsyncedBPH;
        this.#unsyncedBPH = 0;
        await push(this.#bphRef, [validUntil, change]).catch((err) => {
            console.error(`[${this.#appName}] Failed to sync Boops per Hour (BPH) for client ${this.#id}:`, err);
            // Revert unsyncedBPH if sync fails
            this.#unsyncedBPH += change;
        });
    }

    /**
     * Handles a child added event in the Boops per Hour (BPH) reference.
     * 
     * @param {import("firebase/database").DataSnapshot} snapshot The snapshot of the added child.
     * @return {void}
     */
    #onBPHChildAdded(snapshot) {
        const val = snapshot.val();
        const key = snapshot.key;
        if (key == null || !isValidBPHEntry(val)) {
            if (key == null) {
                console.warn(`[${this.#appName}] Received Boops per Hour (BPH) entry with null key for client ${this.#id}.`);
                return;
            }

            console.warn(`[${this.#appName}] Received invalid Boops per Hour (BPH) entry (${key}) for client ${this.#id}:`, { val });
            // Remove the invalid entry
            remove(ref(this.#db, `${BPH_KEY}/${this.#id}/${key}`)).catch((err) => {
                console.error(`[${this.#appName}] Failed to remove invalid Boops per Hour (BPH) entry (${key}) for client ${this.#id}:`, err);
                return;
            });
            return;
        }
        this.#bph[key] = val;
        this.#lastBPH += val[BPH_CHANGE];

        let timeout = this.#bphRemoveTimeouts.get(key);
        if (timeout != null) {
            clearTimeout(timeout);
        }

        // Set the timer to remove the entry when it expires
        const timeLeft = Math.max(0, val[BPH_VALID_UNTIL] - Date.now());
        timeout = setTimeout(async () => {
            try {
                await remove(ref(this.#db, `${BPH_KEY}/${this.#id}/${key}`));
            } catch (err) {
                console.error(`[${this.#appName}] Failed to remove Boops per Hour (BPH) entry (${key}) for client ${this.#id}:`, err);
            }
        }, timeLeft);
        this.#bphRemoveTimeouts.set(key, timeout);
    }

    /**
     * Handles a child removed event in the Boops per Hour (BPH) reference.
     * 
     * @param {import("firebase/database").DataSnapshot} snapshot The snapshot of the removed child.
     * @return {void}
     */
    #onBPHChildRemoved(snapshot) {
        const key = snapshot.key;
        if (key == null || !(key in this.#bph)) {
            console.warn(`[${this.#appName}] Received removal for unknown Boops per Hour (BPH) entry (${key}) for client ${this.#id}.`);
            return;
        }
        const val = this.#bph[key];
        this.#lastBPH -= val[BPH_CHANGE];
        delete this.#bph[key];

        // Clear and remove the timeout for this entry if it exists
        const timeout = this.#bphRemoveTimeouts.get(key);
        if (timeout != null) {
            clearTimeout(timeout);
            this.#bphRemoveTimeouts.delete(key);
        }
    }

    /**
     * Handles changes to the Global Boops Count (GBC) reference.
     * 
     * @param {import("firebase/database").DataSnapshot} snapshot The snapshot of the GBC reference.
     * @return {void}
     */
    #onGBCChange(snapshot) {
        const val = snapshot.val();
        if (typeof val !== 'number') {
            console.warn(`[${this.#appName}] Received invalid Global Boops Count (GBC) value for client ${this.#id}:`, { val });
            return;
        }
        if (val === this.#lastGBC) {
            return; // No change
        }
        this.#lastGBC = val;
        this.#sendBoopCount();
    }

    /**
     * Synchronizes the Global Boops Count (GBC) with the Firebase database.
     * 
     * @param {number} [now] The current timestamp. Defaults to Date.now().
     * @param {boolean} [finalSync=false] Whether this is the final synchronization before closing the WebSocket.
     * @return {Promise<void>} A promise that resolves when the synchronization is complete.
     */
    #gbcSync(now, finalSync = false) {
        if (this.#gbcSyncPromise) {
            return this.#gbcSyncPromise;
        }
        now = now || Date.now();
        if (finalSync || now - this.#lastGBCSync >= GBC_SYNC_INTERVAL) {
            // Sync recent boops tally to the global boop count
            this.#lastGBCSync = now;
            if (this.#unsyncedGBC !== 0) {
                const change = this.#unsyncedGBC;
                this.#unsyncedGBC = 0;
                this.#lastGBC += change;
                this.#gbcSyncPromise = set(this.#gbcRef, increment(change)).catch((err) => {
                    console.error(`[${this.#appName}] Failed to sync Global Boops Count (GBC) for client ${this.#id}:`, err);
                    // Revert unsyncedGBC if sync fails
                    this.#unsyncedGBC += change;
                }).finally(() => {
                    this.#gbcSyncPromise = null;
                    if (finalSync) {
                        return;
                    }
                    const now = Date.now();
                    // If the sync interval has passed while we were syncing,
                    // schedule the next sync immediately
                    if (now - this.#lastGBCSync >= GBC_SYNC_INTERVAL) {
                        if (!this.#gbcSyncInterwalWarningShown) {
                            console.warn(`[${this.#appName}] GBC sync took too long, or the sync interval is too short, scheduling immediate sync.`);
                            this.#gbcSyncInterwalWarningShown = true;
                        }
                        this.#gbcSync(now, finalSync);
                    }
                });
            }
        }
        this.#resetGBCSyncTimeout();
        return Promise.resolve();
    }

    /**
     * Resets the Global Boops Count (GBC) synchronization timeout.
     * 
     * @return {void}
     */
    #resetGBCSyncTimeout() {
        clearTimeout(this.#gbcSyncTimeout);
        this.#gbcSyncTimeout = setTimeout(this.#boundGBCSync, GBC_SYNC_INTERVAL);
    }

    /**
     * Sends the current boop count to the client.
     * 
     * @return {void}
     */
    #sendBoopCount() {
        if (this.#ws.readyState === WebSocket.OPEN) {
            this.#ws.send(PROTO_BOOP_COUNT + (this.#lastGBC + this.#unsyncedGBC).toString(36));
        }
    }
}


export {
    WellMaresWSHandler
}