/**
 * Passenger entry point for Scalahosting's Node.js App Manager.
 *
 * Passenger reserves process.env.PORT and expects us to listen on it.
 * The API's server.ts reads API_PORT from env — we bridge the two here.
 *
 * The API server is ESM; Passenger's entry can be either — we use
 * dynamic import so this file stays CommonJS-compatible (some Passenger
 * versions still prefer CJS entry points).
 */

if (process.env.PORT) {
  process.env.API_PORT = process.env.PORT;
}
// Bind to localhost only — Passenger/Apache proxies from the outside.
process.env.API_HOST = process.env.API_HOST || '127.0.0.1';

import('./apps/api/dist/server.js').catch((err) => {
  console.error('Failed to start API:', err);
  process.exit(1);
});
