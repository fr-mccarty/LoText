// The right-click menu the app draws itself, for the sidebar's rows and the editor.

import { element } from './dom.js'

/**
 * A small menu of our own, drawn under the pointer, for the sidebar's rows and the editor. An
 * item is { label, action }, with `destructive` to draw it red and `disabled` to grey it out;
 * { separator: true } is a rule.
 */
export function showContextMenu (event, items) {
  document.querySelector('.context-menu')?.remove()
  const menu = element('div', { class: 'context-menu' })
  for (const item of items) {
    if (item.separator) { menu.append(element('div', { class: 'menu-separator' })); continue }
    menu.append(element('div', {
      class: `menu-item${item.destructive ? ' destructive' : ''}${item.disabled ? ' disabled' : ''}`,
      text: item.label,
      onmousedown: (mouse) => {
        mouse.preventDefault()
        if (item.disabled) return
        menu.remove()
        item.action()
      },
    }))
  }
  document.body.append(menu)
  const { clientX, clientY } = event
  menu.style.left = `${Math.min(clientX, window.innerWidth - menu.offsetWidth - 8)}px`
  menu.style.top = `${Math.min(clientY, window.innerHeight - menu.offsetHeight - 8)}px`
  const dismiss = () => { menu.remove(); document.removeEventListener('mousedown', dismiss) }
  setTimeout(() => document.addEventListener('mousedown', dismiss), 0)
}
