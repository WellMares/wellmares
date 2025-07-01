// @ts-check

// Heartbeat
const HEARTBEAT_TIMEOUT = 30_000;

// WebSocket protocol error codes and messages
const INTERNAL_SERVER_ERROR_ERRCODE = 1000;
const INTERNAL_SERVER_ERROR_ERRMSG = "Internal Server Error";
const NO_HEARTBEAT_ERRCODE = 1001;
const NO_HEARTBEAT_ERRMSG = "No heartbeat received within the timeout period";
const TOO_MANY_COOLDOWN_FAILS_ERRCODE = 1002;
const TOO_MANY_COOLDOWN_FAILS_ERRMSG = "Too many cooldown failures, connection closed";

// WebSocket protocol bidirectional messages
const PROTO_HEARTBEAT = 'h';

// WebSocket protocol client to server messages
const PROTO_BOOP_REQUEST = 'b';
const PROTO_COOLDOWN_QUERY = 'd';

// WebSocket protocol server to client messages
const PROTO_BOOP_REPLY = 'b';
const PROTO_BOOP_REJECT = 'r';
const PROTO_COOLDOWN_REPLY = 'd';
const PROTO_INVALID = 'i';
const PROTO_BOOP_COUNT = 'c';


export {
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
};