import { describe, it, expect, vi } from 'vitest'

let appIsReady = false
vi.mock('electron', () => ({ app: { isReady: () => appIsReady } }))

const createWindow = vi.fn()
vi.mock('../src/main/window.js', () => ({ allWindows: () => [], createWindow: () => createWindow() }))

const { enqueue, deliver } = await import('../src/main/open-queue.js')

describe('a file opened to launch the app', () => {
  it('waits for ready before asking for a window, then asks for one', () => {
    enqueue('/Users/someone/notes.md')
    expect(createWindow).not.toHaveBeenCalled()

    appIsReady = true
    deliver()
    expect(createWindow).toHaveBeenCalledTimes(1)
  })
})
