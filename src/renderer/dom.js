// The smallest amount of DOM plumbing the views need. There is no framework here: the app has
// four screens and a handful of lists, and a framework would be a larger thing to read than the
// views it replaced.

export function element (tag, attributes = {}, children = []) {
  const node = document.createElement(tag)
  for (const [key, value] of Object.entries(attributes)) {
    if (value === undefined || value === null || value === false) continue
    if (key === 'class') node.className = value
    else if (key === 'text') node.textContent = value
    else if (key === 'html') node.innerHTML = value
    else if (key === 'style') Object.assign(node.style, value)
    else if (key.startsWith('on')) node.addEventListener(key.slice(2).toLowerCase(), value)
    else if (key === 'dataset') Object.assign(node.dataset, value)
    else node.setAttribute(key, value === true ? '' : String(value))
  }
  for (const child of [].concat(children)) {
    if (child === null || child === undefined || child === false) continue
    node.append(child)
  }
  return node
}

export function clear (node) {
  while (node.firstChild) node.removeChild(node.firstChild)
}

/** An SF-Symbol-shaped icon set, drawn inline so the app carries no image files. */
export function icon (name, size = 14) {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg')
  svg.setAttribute('viewBox', '0 0 24 24')
  svg.setAttribute('width', String(size))
  svg.setAttribute('height', String(size))
  svg.setAttribute('fill', 'none')
  svg.setAttribute('stroke', 'currentColor')
  svg.setAttribute('stroke-width', '1.8')
  svg.setAttribute('stroke-linecap', 'round')
  svg.setAttribute('stroke-linejoin', 'round')
  svg.classList.add('icon')
  svg.innerHTML = ICONS[name] ?? ''
  return svg
}

const ICONS = {
  folder: '<path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>',
  doc: '<path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z"/><path d="M14 3v5h5"/>',
  chevron: '<path d="M9 6l6 6-6 6"/>',
  chevronDown: '<path d="M6 9.5l6 6 6-6"/>',
  chevronLeft: '<path d="M15 6l-6 6 6 6"/>',
  chevronUp: '<path d="M6 14.5l6-6 6 6"/>',
  // The glyph a macOS popup button wears: one menu, opening either way.
  chevronUpDown: '<path d="M7.5 10.5L12 6l4.5 4.5"/><path d="M7.5 13.5L12 18l4.5-4.5"/>',
  // Two letters at two sizes — the tab for everything that is about how text looks.
  textSize: '<path d="M2.6 18L6 9.6 9.4 18"/><path d="M3.8 15.2h4.4"/>'
    + '<path d="M12.2 18L17 6l4.8 12"/><path d="M13.9 14h6.2"/>',
  printer: '<path d="M7 9V4.6a.6.6 0 0 1 .6-.6h8.8a.6.6 0 0 1 .6.6V9"/>'
    + '<path d="M7 17H5a2 2 0 0 1-2-2v-4a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v4a2 2 0 0 1-2 2h-2"/>'
    + '<rect x="7" y="14" width="10" height="6.5" rx="1"/><path d="M17.4 11.6h.01"/>',
  newFile: '<path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-8"/><path d="M14 3v5h5"/><path d="M12 11v6M9 14h6"/>',
  newFolder: '<path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><path d="M12 10v6M9 13h6"/>',
  refresh: '<path d="M21 12a9 9 0 1 1-2.6-6.4"/><path d="M21 3v6h-6"/>',
  search: '<circle cx="11" cy="11" r="7"/><path d="M20 20l-3.5-3.5"/>',
  // A filled circle with the cross cut out of it, as a search field's clear button is drawn.
  clear: '<circle cx="12" cy="12" r="9" fill="currentColor" stroke="none"/><path d="M9 9l6 6M15 9l-6 6"/>',
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
  warning: '<path d="M12 4l9 16H3z"/><path d="M12 10v4M12 17h.01"/>',
  question: '<circle cx="12" cy="12" r="9"/><path d="M9.5 9.5a2.5 2.5 0 1 1 3 2.5v1M12 16h.01"/>',
  link: '<path d="M7 17L17 7M9 7h8v8"/>',
  server: '<rect x="3" y="4" width="18" height="7" rx="2"/><rect x="3" y="13" width="18" height="7" rx="2"/><path d="M7 7.5h.01M7 16.5h.01"/>',

  // The iOS bars and the bar above the on-screen keyboard (src/mobile/ui.js).
  back: '<path d="M15 5l-7 7 7 7"/>',
  more: '<circle cx="5.5" cy="12" r="1.2"/><circle cx="12" cy="12" r="1.2"/><circle cx="18.5" cy="12" r="1.2"/>',
  sidebar: '<rect x="3" y="4.5" width="18" height="15" rx="2.5"/><path d="M9.5 4.5v15"/>',
  indent: '<path d="M4 6h16M11 10h9M11 14h9M4 18h16"/><path d="M4 9.5l3.5 2.5L4 14.5"/>',
  outdent: '<path d="M4 6h16M11 10h9M11 14h9M4 18h16"/><path d="M7.5 9.5L4 12l3.5 2.5"/>',
  task: '<rect x="4" y="4" width="16" height="16" rx="3"/>',
  bold: '<path d="M7 5h6a3.5 3.5 0 0 1 0 7H7zM7 12h7a3.5 3.5 0 0 1 0 7H7z"/>',
  italic: '<path d="M10 5h8M6 19h8M14.5 5l-5 14"/>',
  undo: '<path d="M9 14L4 9l5-5"/><path d="M4 9h10.5a5.5 5.5 0 0 1 0 11H11"/>',
  redo: '<path d="M15 14l5-5-5-5"/><path d="M20 9H9.5a5.5 5.5 0 0 0 0 11H13"/>',
  keyboardDown: '<rect x="3" y="4" width="18" height="11" rx="2"/><path d="M7 8h.01M11 8h.01M15 8h.01M8 11.5h8"/><path d="M9 18.5l3 2.5 3-2.5"/>',
}

/** Escapes what goes into a sentence the user reads, so a filename with a `<` in it is safe. */
export function quote (text) {
  return `“${text}”`
}
