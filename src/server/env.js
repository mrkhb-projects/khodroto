// .env loader — runs as a side effect of importing this module.
//
// WHY THIS EXISTS
// `npm start` is `node server.js` and the cPanel/Passenger startup file is app.js.
// Neither passes `--env-file`, and the project has no `dotenv` dependency, so until
// now EVERY variable written into the host's `.env` was silently ignored: the site
// kept running with defaults and the operator had no error to go on. That is exactly
// why BAMA_ENABLED / RING_ENABLED / SHEYPOOR_ENABLED appeared to "do nothing" after
// being configured on the host.
//
// Real environment variables (Passenger panel, shell exports, CI) always win — this
// only fills in what is missing, so it can never override production configuration.

import fs from 'node:fs'
import path from 'node:path'

/** Parse .env text into a plain object. Supports comments, quotes and `export`. */
export function parseEnvFile(text = '') {
  const result = {}
  for (const rawLine of String(text).split(/\r?\n/)) {
    const line = rawLine.trim()
    if (!line || line.startsWith('#')) continue
    const withoutExport = line.startsWith('export ') ? line.slice(7).trim() : line
    const eq = withoutExport.indexOf('=')
    if (eq <= 0) continue
    const key = withoutExport.slice(0, eq).trim()
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) continue
    let value = withoutExport.slice(eq + 1).trim()
    const quoted = (value.startsWith('"') && value.endsWith('"') && value.length > 1)
      || (value.startsWith("'") && value.endsWith("'") && value.length > 1)
    if (quoted) {
      value = value.slice(1, -1)
    } else {
      // Strip a trailing inline comment only on UNQUOTED values.
      const hash = value.indexOf(' #')
      if (hash >= 0) value = value.slice(0, hash).trim()
    }
    result[key] = value
  }
  return result
}

/**
 * Merge a .env file into `env` without clobbering anything already set.
 * @returns {{file:string, loaded:string[], skipped:string[]}|null}
 */
export function loadEnvFile({ file = '.env', env = process.env, cwd = process.cwd() } = {}) {
  const target = path.isAbsolute(file) ? file : path.join(cwd, file)
  let text
  try {
    text = fs.readFileSync(target, 'utf8')
  } catch {
    return null // no .env is a perfectly normal deployment
  }
  const parsed = parseEnvFile(text)
  const loaded = [], skipped = []
  for (const [key, value] of Object.entries(parsed)) {
    if (env[key] === undefined) { env[key] = value; loaded.push(key) }
    else skipped.push(key)
  }
  return { file: target, loaded, skipped }
}

export const envReport = loadEnvFile()
if (envReport?.loaded.length) {
  console.log(`[env] loaded ${envReport.loaded.length} variable(s) from ${envReport.file}`)
}
