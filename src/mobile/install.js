// Put the iOS bridge and shell where the renderer looks for them, before the renderer loads.

import { createBridge } from './bridge.js'
import { MobileShell } from './ui.js'

const bridge = createBridge()
window.lotext = bridge
window.lotextShell = (parts) => new MobileShell(parts, bridge)
