// @ts-check

// Time constants
const ONE_SECOND = 1_000;
const ONE_MINUTE = 60_000;
const ONE_HOUR = 3_600_000;

// Firebase token constants
const FB_TOKEN_TTL = ONE_HOUR;
const FB_TOKEN_TTL_S = FB_TOKEN_TTL / ONE_SECOND;
const FB_TOKEN_CLOSE_CALL_THRESHOLD = 10 * ONE_SECOND;
const FB_TOKEN_USER_ID = 'wellmares-worker';

// BPH entry structure
const BPH_VALID_UNTIL = 0;
const BPH_CHANGE = 1;

// Cooldown
const CD_FAIL_LIMIT = 5;

// Boops per Hour (BPH) constants
const BPH_KEY = 'boops-per-hour';
const BPH_SYNC_INTERVAL = ONE_MINUTE;
const BPH_LIMIT = 10_000;

// Boops per Minute (BPM) constants
const BPM_LIMIT = 1_000;

// Global Boops Count (GBC) constants
const GBC_KEY = 'boop-count';
const GBC_SYNC_INTERVAL = 250;

export {
    ONE_SECOND,
    ONE_MINUTE,
    ONE_HOUR,
    FB_TOKEN_TTL,
    FB_TOKEN_TTL_S,
    FB_TOKEN_USER_ID,
    FB_TOKEN_CLOSE_CALL_THRESHOLD,
    BPH_VALID_UNTIL,
    BPH_CHANGE,
    CD_FAIL_LIMIT,
    BPH_KEY,
    BPH_SYNC_INTERVAL,
    BPH_LIMIT,
    BPM_LIMIT,
    GBC_KEY,
    GBC_SYNC_INTERVAL
};