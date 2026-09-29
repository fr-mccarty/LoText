// iCloud Drive skips any name ending in .nosync, so the packages live in node_modules.nosync
// behind a node_modules symlink. npm replaces that symlink with a real folder on every install,
// and package.json's "dependencies" script — which npm runs after anything changes node_modules —
// runs this to move the packages back behind the link.
import { lstatSync, renameSync, rmSync, symlinkSync } from 'node:fs'

const packagesOutsideICloud = 'node_modules.nosync'
if (!lstatSync('node_modules').isSymbolicLink()) {
  rmSync(packagesOutsideICloud, { recursive: true, force: true })
  renameSync('node_modules', packagesOutsideICloud)
  symlinkSync(packagesOutsideICloud, 'node_modules')
}
