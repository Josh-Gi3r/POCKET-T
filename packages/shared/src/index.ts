// @pocket-t/shared — shared types and wire formats used by every
// package in the workspace (daemon, relay, pt-shim metadata).
//
// Right now there's exactly one thing to share: the ws-v3 binary frame
// protocol that daemons, relay hubs, and browsers speak to each other.
// More shared surface lands here as it stabilises.

export * from './ws-v3.js';
