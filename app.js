// Passenger/LSWS startup shim for shared cPanel hosts (e.g. Server.ir).
// LiteSpeed's lsnode.js loads the startup file with require(), which cannot
// load this project's ES module graph (package.json has "type": "module"
// and the graph contains top-level await). A dynamic import() has no
// top-level await and works under both CommonJS and ESM resolution, so this
// file can act as the Passenger "Application startup file" on such hosts.
// Keep the cPanel startup file set to app.js; server.js boots asynchronously
// and binds the port that Passenger provides via process.env.PORT.
process.env.NODE_ENV = process.env.NODE_ENV || 'production'
import('./server.js')
