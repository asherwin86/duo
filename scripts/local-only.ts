// Who may use the dev server's powerful routes (the storage folder, the Android emulator): this machine's own page.
//
// Three separate questions, because each one stops something different:
// - the connection really comes from this machine. A Host header is whatever the sender writes, so a client on
//   the network could claim `localhost`; only the address of the socket cannot be written by the sender.
// - the Host names this machine, which stops another site's name from being pointed at it (DNS rebinding).
// - a request that carries an Origin carries this page's own, which stops another website from sending it. A
//   `text/plain` POST needs no preflight, and a WebSocket is not subject to CORS at all.

const LOOPBACK = /^(127(\.\d{1,3}){3}|::1|::ffff:127(\.\d{1,3}){3})$/
const LOCAL_HOST = /^(localhost|127\.0\.0\.1|\[::1\]|[\w-]+\.localhost)(:\d+)?$/

/** An address as a socket reports it, for this machine itself. */
export const isLoopbackAddress = (address: string | null | undefined) => Boolean(address && LOOPBACK.test(address))

/** `peer` is the address of the other end of the connection (`server.requestIP(req)?.address`). */
export function fromThisMachine(req: Request, peer: string | null | undefined) {
  if (!isLoopbackAddress(peer)) return false
  const host = req.headers.get('host') ?? ''
  if (!LOCAL_HOST.test(host)) return false
  const origin = req.headers.get('origin')
  if (origin === null) return true
  try {
    return new URL(origin).host === host
  } catch {
    // `Origin: null` (a sandboxed frame, a redirect across sites) and anything unparsable are not this page.
    return false
  }
}
