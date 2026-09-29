// ⇧⌘K — Connect to Server.
//
// Takes an address — `user@host:/path`, or `ssh://user@host:port/path` — logs in over SSH, and
// from then on that window is an ordinary LoText window: the sidebar lists the remote folder,
// files open in the editor, ⌘S writes them back, and new, rename, duplicate, move, delete and
// drag-to-rearrange all do what they do locally.
//
// **The app has its own key.** It logs in with that and nothing else, so the first connection
// to any server fails until that line is in the server's `authorized_keys` — and this sheet is
// where the user finds that out. Passwords are not offered: there is no terminal behind this
// process to type one into.
//
// **Servers that answered are remembered — ten of them, here in the sheet.** An address is
// written down only after a connection has succeeded, so the list is places that have answered
// rather than a history of things that were typed. It is not on a menu, unlike Recent Folders:
// a remote folder is not something the system grants but something a key opens, so an entry is
// the address as text and belongs under the field it would otherwise be typed into.

import { element, clear, icon } from '../dom.js'

export class ConnectSheet {
  constructor (model) {
    this.model = model
    this.busy = false
  }

  build () {
    this.field = element('input', {
      class: 'sheet-field',
      type: 'text',
      placeholder: 'user@host:/path',
      spellcheck: 'false',
      onkeydown: (event) => {
        if (event.key === 'Enter') { event.preventDefault(); this.connect(this.field.value) }
        if (event.key === 'Escape') { event.preventDefault(); this.model.closeSheet() }
      },
    })
    this.listNode = element('div', { class: 'sheet-list short' })
    this.keyNode = element('code', { class: 'public-key', text: 'Making a key…' })
    this.statusNode = element('div', { class: 'sheet-status' })

    this.node = element('div', { class: 'sheet connect' }, [
      element('div', { class: 'sheet-title' }, [icon('server', 16), element('span', { text: 'Connect to Server' })]),
      element('div', { class: 'sheet-field-row' }, [this.field]),
      this.listNode,
      element('div', { class: 'sheet-divider' }),
      element('div', { class: 'key-block' }, [
        element('p', {
          class: 'key-explain',
          text: 'LoText logs in with its own key. Put this line in the server’s ~/.ssh/authorized_keys before the first connection.',
        }),
        this.keyNode,
        element('button', {
          class: 'text-button',
          text: 'Copy',
          onclick: () => this.model.bridge.copyToClipboard(this.keyNode.textContent),
        }),
      ]),
      this.statusNode,
    ])

    requestAnimationFrame(() => this.field.focus())
    this.loadKey()
    this.loadServers()
    return this.node
  }

  dispose () {}

  async loadKey () {
    try {
      this.keyNode.textContent = await this.model.bridge.publicKey() ?? 'No key could be made.'
    } catch (error) {
      this.keyNode.textContent = error.message
    }
  }

  async loadServers () {
    const servers = await this.model.bridge.recentServers().catch(() => [])
    clear(this.listNode)
    for (const server of servers) {
      this.listNode.append(element('div', {
        class: 'sheet-row',
        onmousedown: (event) => { event.preventDefault(); this.connect(server.address) },
      }, [
        icon('server', 14),
        element('div', { class: 'sheet-row-text' }, [
          element('div', { class: 'sheet-row-name', text: server.address }),
        ]),
      ]))
    }
  }

  async connect (address) {
    if (this.busy || !address.trim()) return
    this.busy = true
    this.statusNode.textContent = 'Connecting…'
    try {
      await this.model.connectToServer(address.trim())
      this.model.closeSheet()
    } catch (error) {
      this.statusNode.textContent = error.message
    } finally {
      this.busy = false
    }
  }

  render () {}
}
