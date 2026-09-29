// The editor's right-click menu: Cut, Copy and Paste, and Cut and Send to DayCap, which saves the
// selection as a new file in the DayCap folder (`specs/send-to-daycap.md`). A right-click inside
// the selection keeps it, so what was highlighted is what the menu acts on. iOS has no right-click
// here: the system's own text menu stands in for this one.

import { showContextMenu } from '../context-menu.js'

export function attachEditorMenu (editor, model, bridge) {
  editor.view.contentDOM.addEventListener('contextmenu', (event) => {
    event.preventDefault()
    const selected = editor.takeSelection() !== null
    const items = [
      { label: 'Cut', disabled: !selected, action: () => bridge.performEdit('cut') },
      { label: 'Copy', disabled: !selected, action: () => bridge.performEdit('copy') },
      { label: 'Paste', action: () => bridge.performEdit('paste') },
    ]
    if (bridge.sendsToDayCap) {
      items.push({ separator: true })
      items.push({ label: 'Cut and Send to DayCap', disabled: !selected, action: () => model.cutAndSendToDayCap() })
    }
    showContextMenu(event, items)
  })
}
