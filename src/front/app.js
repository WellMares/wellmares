// @ts-check
import { BoopCountEvent, BoopRejectedError, BoopTimeoutError, MareCloseEvent, MareConnection, MareNetworkError } from "./mare-connection";
import { strictGetElementById } from "./index";
import { getCssVariable, parseCssDuration } from "./utils";
import { LOCAL_KEY } from "./constants";

// DOM elements
const boopCountEl = strictGetElementById("boop-count", HTMLSpanElement);
const boopCountInnerEl = strictGetElementById("boop-count-inner", HTMLSpanElement);
const boopBtn = strictGetElementById("boop-btn", HTMLButtonElement);
const mareContainer = strictGetElementById("mare-container", HTMLDivElement);

// WebSocket URL based on current location
const WS_URL =
    localStorage.getItem('mare-test-server') ||
    `ws${location.protocol === "https:" ? "s" : ""}://${location.host}/ws`;
const DEFAULT_BOOP_TEXT = "Boop a mare!";
const BOOPED_DURATION_CSS = parseCssDuration(getCssVariable("--booped-duration") || "", 200);
const BOOPED_DURATION = BOOPED_DURATION_CSS * 1.5

// Local optimistic count
let optimisticCount = /** @type {number | null} */ (null);
let lastServerCount = 0;

let clearCooldown = /** @type {(() => void) | null} */ (null);
let clearError = /** @type {(() => void) | null} */ (null);

let boopedStateTimeout = /** @type {number | NodeJS.Timeout | null} */ (null);
function startBoopAnimation() {
    if (boopedStateTimeout) {
        clearTimeout(boopedStateTimeout);
    }
    boopCountEl.classList.add("booped");
    mareContainer.classList.add("booped");
    boopedStateTimeout = setTimeout(() => {
        boopCountEl.classList.remove("booped");
        mareContainer.classList.remove("booped");
        boopedStateTimeout = null;
    }, BOOPED_DURATION);
}

function clearButtonState() {
    if (clearCooldown) {
        clearCooldown();
    }
    if (clearError) {
        clearError();
    }
}

/**
 * Sets the boop button to an error state with a message.
 * @param {string} text The error message to display.
 */
function setError(text, isReconnecting = false) {
    clearButtonState();
    boopBtn.disabled = true;
    boopBtn.innerHTML = isReconnecting ?
        text + '<span class="loading-dots"></span>' : text;
    boopBtn.classList.add(isReconnecting ? "reconnecting" : "error");
    clearError = () => {
        boopBtn.disabled = false;
        boopBtn.innerText = DEFAULT_BOOP_TEXT;
        boopBtn.classList.remove(isReconnecting ? "reconnecting" : "error");
        clearError = null;
    }
}

/**
 * Sets the boop button cooldown state.
 * @param {number} ms The cooldown time in milliseconds. If 0 or less, enables the button.
 */
function setBoopButtonCooldown(ms) {
    clearButtonState();
    if (ms <= 0) {
        return;
    }
    boopBtn.disabled = true;
    boopBtn.classList.add("cooldown");

    if (ms <= 150) {
        clearCooldown = () => {
            clearTimeout(cooldownTimeout);
            boopBtn.disabled = false;
            boopBtn.classList.remove("cooldown");
            clearCooldown = null;
        }
        const cooldownTimeout = setTimeout(clearCooldown, ms);
        return;
    }

    const cooldownUntil = Date.now() + ms;
    const textUpdateInterval = setInterval(() => {
        const left = cooldownUntil - Date.now();
        updateCountdownText(left);
    }, 100);

    clearCooldown = () => {
        clearInterval(textUpdateInterval);
        clearTimeout(cooldownTimeout);
        boopBtn.disabled = false;
        boopBtn.innerText = DEFAULT_BOOP_TEXT;
        boopBtn.classList.remove("cooldown");
        clearCooldown = null;
    }

    const cooldownTimeout = setTimeout(clearCooldown, ms);
    updateCountdownText(ms);
}

/**
 * Updates the boop button text to show the remaining cooldown time.
 * @param {number} ms The remaining cooldown time in milliseconds.
 */
function updateCountdownText(ms) {
    const s = Math.round(ms / 100).toString();
    if (s.length < 2) {
        boopBtn.innerText = `Wait 0.${s}s...`;
    } else {
        boopBtn.innerText = `Wait ${s.slice(0, -1)}.${s.slice(-1)}s...`;
    }
}

const conn = new MareConnection(WS_URL);

conn.addEventListener("open", () => {
    conn.queryCooldown(2000).then((cooldown) => {
        setBoopButtonCooldown(cooldown);
    }).catch(() => {
        console.warn("Failed to query initial cooldown, enabling boop button.");
        setError("Error querying cooldown");
    });
});

conn.addEventListener("close", (close) => {
    if (close instanceof MareCloseEvent) {
        if (!close.autoReconnect) {
            console.warn("Disconnected from server:", close.reason);
            setError("Disconnected");
            return;
        }
    }
    console.warn("Connection closed, attempting to reconnect...");
    setError("Reconnecting", true);
});

conn.addEventListener("error", (event) => {
    console.warn("Connection error:", event);
});

// Listen for boop count events
conn.addEventListener("boopcount", (e) => {
    if (!(e instanceof BoopCountEvent)) {
        console.warn("Unexpected event:", e);
        return;
    }
    lastServerCount = e.boopCount;
    localStorage.setItem(LOCAL_KEY, e.boopCount.toString());
    if (optimisticCount == null || lastServerCount >= optimisticCount) {
        optimisticCount = null;
        boopCountInnerEl.innerText = e.boopCount.toString();
    }
});

function boop() {
    if (clearCooldown || clearError) {
        return;
    }

    if (optimisticCount === null) {
        optimisticCount = lastServerCount;
    }
    optimisticCount++;
    boopCountInnerEl.innerText = optimisticCount.toString();

    startBoopAnimation();

    // Send boop to server
    conn.boop().then(() => {
        if (optimisticCount == null || lastServerCount >= optimisticCount) {
            optimisticCount = null;
        }
    }).catch((err) => {
        optimisticCount = null;
        boopCountInnerEl.innerText = lastServerCount.toString();
        if (err instanceof BoopRejectedError) {
            setBoopButtonCooldown(err.cooldown);
        } else if (err instanceof BoopTimeoutError) {
            console.warn("Boop timed out!");
        } else if (err instanceof MareNetworkError) {
            console.warn("Network error:", err.message);
        } else {
            console.error("Unknown error:", err);
        }
    });
}


let previousEvent = 0;
/**
 * Handles types of pointer events to trigger a boop.
 * 
 * @param {Event} e The pointer event triggered by the user.
 */
function onPointerEvent(e) {
    e.preventDefault();
    const now = Date.now();
    if (now - previousEvent < 10) {
        // Ignore same-event clicks
        return;
    }
    previousEvent = now;
    boop();
}

['mousedown', 'pointerdown', 'touchstart'].forEach(eventType => {
    boopBtn.addEventListener(eventType, onPointerEvent);
    mareContainer.addEventListener(eventType, onPointerEvent);
});

setError("Connecting", true);