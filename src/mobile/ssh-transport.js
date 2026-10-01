// How a remote folder's commands reach the server on iPhone and iPad: the native plugin's SSH
// (ios/App/App/LoTextNative+SSH.swift), which keeps one connection per server open in the app.
//
// The transport half of `src/shared/store/remote-store.js`; the Mac's is
// `src/main/store/ssh-transport.js`. The device logs in with a key of its own, made on first use
// and kept in its keychain — iOS has no `~/.ssh` to borrow one from.

import { StoreError } from '../shared/store/errors.js'
import { Native, fromBase64, toBase64 } from './native.js'

function server (location) {
  return { user: location.user, host: location.host, port: location.port ?? 22 }
}

export const sshTransport = {
  async run ({ location, command, input, timeout }) {
    try {
      const answer = await Native.sshRun({
        ...server(location),
        command,
        input: input ? toBase64(input) : null,
        timeout,
      })
      return { status: answer.status, output: fromBase64(answer.output), diagnostic: answer.diagnostic ?? '' }
    } catch (error) {
      throw new StoreError(error?.code === 'refused' ? 'refused' : 'unreachable',
        error?.message ?? 'The server could not be reached.')
    }
  },

  close (location) {
    return Native.sshClose(server(location))
  },
}

/** This device's key, as the line that goes into a server's `authorized_keys`. */
export async function publicKey (device) {
  const { key } = await Native.sshPublicKey({ device })
  return key ?? null
}
