// The one bridge between the model and the file system. Everything the renderer can reach is
// on this object and nothing else is: there is no Node in the window, and no path here gets to
// the disk without a window's own store resolving it first.

import { contextBridge, ipcRenderer } from 'electron'

/**
 * Unwraps the `{ ok, value | error }` every handler answers with, rejecting with what it carries.
 * A plain object, not an `Error`: `contextBridge` copies an `Error` as its message alone, so the
 * code would never reach the window. `src/renderer/bridge-errors.js` makes it an `Error` again.
 */
async function call (channel, ...args) {
  const reply = await ipcRenderer.invoke(channel, ...args)
  if (reply?.ok) return reply.value
  throw {
    message: reply?.error?.message ?? 'Something went wrong.',
    code: reply?.error?.code ?? 'failed',
    current: reply?.error?.current ?? null,
  }
}

function on (channel, listener) {
  const wrapped = (_event, payload) => listener(payload)
  ipcRenderer.on(channel, wrapped)
  return () => ipcRenderer.off(channel, wrapped)
}

contextBridge.exposeInMainWorld('lotext', {
  // `darwin` or `win32`; the iOS bridge says `ios`. For wording and the window's frame only.
  platform: process.platform,

  // The folder
  openFolder: () => call('folder:open'),
  adoptFolder: (folder) => call('folder:adopt', folder),
  connectToServer: (address) => call('folder:connect', address),
  describeFolder: () => call('folder:describe'),
  refreshAvailability: () => call('folder:refreshAvailability'),
  saveExpansion: (paths) => call('folder:saveExpansion', paths),

  // The one door
  children: (folder) => call('store:children', folder),
  readText: (file) => call('store:readText', file),
  writeText: (file, text, lineEnding, expected) =>
    call('store:writeText', file, text, lineEnding, expected),
  stamp: (file) => call('store:stamp', file),
  saveCopyAs: (name, text, lineEnding) => call('file:saveCopyAs', name, text, lineEnding),
  exists: (file) => call('store:exists', file),
  create: (kind, name, parent) => call('store:create', kind, name, parent),
  rename: (file, name) => call('store:rename', file, name),
  move: (file, destination) => call('store:move', file, destination),
  duplicate: (file) => call('store:duplicate', file),
  remove: (file, options) => call('store:delete', file, options),
  reveal: (file, isFolder) => call('store:reveal', file, isFolder),
  copyAbsolutePath: (file) => call('store:copyAbsolutePath', file),
  openLinkAsFolder: (file) => call('store:linkTarget', file),

  // The viewers
  loadForViewer: (file, viewer) => call('viewer:load', file, viewer),

  // Finding a file by name
  startWalk: (token) => call('search:walk', token),
  cancelWalk: () => call('search:cancel'),
  onSearchBatch: (listener) => on('search:batch', listener),
  onSearchDone: (listener) => on('search:done', listener),

  // Recently edited files
  recentlyEdited: (token) => call('recent:list', token),
  cancelRecentlyEdited: () => call('recent:cancel'),

  // The working save
  writeRecovery: (file, text) => call('recovery:write', file, text),
  readRecovery: (file, diskText) => call('recovery:read', file, diskText),
  discardRecovery: (file) => call('recovery:discard', file),

  // Settings
  readSettings: () => call('settings:read'),
  setView: (patch) => call('settings:setView', patch),
  restoreViewDefaults: () => call('settings:restoreView'),
  selectPreset: (id) => call('settings:selectPreset', id),
  updatePreset: (patch) => call('settings:updatePreset', patch),
  addPreset: (kind) => call('settings:addPreset', kind),
  duplicatePreset: () => call('settings:duplicatePreset'),
  renamePreset: (name) => call('settings:renamePreset', name),
  deletePreset: () => call('settings:deletePreset'),
  restorePrintDefaults: () => call('settings:restorePrint'),
  exportSettings: () => call('settings:export'),
  importSettings: () => call('settings:import'),
  openSettings: () => call('settings:open'),
  cloudStatus: () => call('cloud:status'),
  setCloudSync: (on) => call('cloud:setEnabled', on),
  onCloudStatus: (listener) => on('cloud:status', listener),

  // Where each document was left
  readPosition: (file) => call('position:read', file),
  savePosition: (file, position) => call('position:save', file, position),
  setSettingsTitle: (title) => call('settings:title', title),

  // The lists the app keeps
  recentFolders: () => call('recents:folders'),
  openRecentFolder: (id) => call('recents:openFolder', id),
  forgetRecentFolder: (id) => call('recents:forgetFolder', id),
  clearRecentFolders: () => call('recents:clearFolders'),
  recentServers: () => call('recents:servers'),
  publicKey: () => call('ssh:publicKey'),
  copyToClipboard: (text) => call('clipboard:write', text),
  performEdit: (action) => call('edit:perform', action),

  // Cut and Send to DayCap
  sendsToDayCap: true,
  dayCapFolder: () => call('daycap:folder'),
  chooseDayCapFolder: () => call('daycap:chooseFolder'),
  sendToDayCap: (text) => call('daycap:send', text),

  // Printing
  print: (job) => call('print:file', job),

  // The window
  setTitle: (title, isEdited) => call('window:title', title, isEdited),
  noteOpenFile: (file) => call('window:noteOpenFile', file),
  newWindow: () => call('window:new'),
  closeWindow: () => call('window:close'),
  windowSettled: () => call('window:settled'),
  holdClose: () => call('window:holdClose'),
  cancelClose: () => call('window:cancelClose'),
  restoreRecord: () => call('window:restoreRecord'),
  queueClaims: (folder) => ipcRenderer.invoke('open-queue:claims', folder),
  ready: () => ipcRenderer.send('window:ready'),
  ask: (options) => call('dialog:message', options),
  quit: () => call('app:quit'),

  // What the menu needs to know, and what it sends back
  reportMenuState: (patch) => ipcRenderer.send('menu:state', patch),
  rebuildMenu: () => ipcRenderer.send('menu:rebuild'),
  onMenuCommand: (listener) => on('menu:command', listener),
  onFolderChanged: (listener) => on('folder:changed', listener),
  onSettingsChanged: (listener) => on('settings:changed', listener),
  onThemeChanged: (listener) => on('theme:changed', listener),
  onOpenFile: (listener) => on('app:openFile', listener),
  onSettle: (listener) => on('window:settle', listener),
})
