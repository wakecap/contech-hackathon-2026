// The local viewer's random session token authorizes reruns. Embedded browsers
// can rewrite Origin, so do not require Origin to equal the loopback Host.
// The server still binds to loopback, validates Host, and exposes no CORS access.
export function authorizedRerun(headers, token) {
  return typeof token === 'string' && token.length > 0 && headers['x-viewer-token'] === token;
}
