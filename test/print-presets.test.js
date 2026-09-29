import { describe, it, expect } from 'vitest'
import { createSettings } from '../src/shared/settings-store.js'
import { standardPreset, DEFAULT_PRESET_ID } from '../src/shared/settings-shape.js'

function memoryPrefs (initial = {}) {
  const values = { ...initial }
  return {
    get: (key, fallback) => (key in values ? structuredClone(values[key]) : fallback),
    set: (key, value) => { values[key] = structuredClone(value) },
    flush () {},
    values,
  }
}

const byName = (list, name) => list.find((preset) => preset.name === name)

describe('print presets', () => {
  it('start with Default in Times New Roman and the three built-ins', () => {
    const settings = createSettings(memoryPrefs(), () => 'x')
    const list = settings.presets()
    expect(list.map((preset) => preset.name))
      .toEqual(['Default', 'Presentation Script', 'Formal Document', 'Letterhead'])
    expect(list[0].bodyFont).toBe('times')
    expect(list[0].headingFont).toBe('times')

    const script = byName(list, 'Presentation Script')
    expect(script.fontSize).toBe(22)
    expect(script.margins).toEqual({ top: 0.75, bottom: 0.75, left: 0.75, right: 0.75 })

    for (const name of ['Formal Document', 'Letterhead']) {
      const preset = byName(list, name)
      expect(preset.fontSize).toBe(12)
      expect(preset.bodyFont).toBe('times')
      expect(preset.margins).toEqual({ top: 1, bottom: 1, left: 1, right: 1 })
    }
    expect(byName(list, 'Letterhead').showsHeaderAndFooter).toBe(true)
  })

  it('are added once to settings saved before they existed, and moved off the old mono default', () => {
    const old = { ...standardPreset(), bodyFont: 'systemMono', headingFont: 'systemMono' }
    const mine = { ...standardPreset('mine', 'Letterhead'), fontSize: 14 }
    const prefs = memoryPrefs({ 'print.presets': [old, mine] })
    const settings = createSettings(prefs, () => 'x')

    const list = settings.presets()
    expect(list.map((preset) => preset.name))
      .toEqual(['Default', 'Letterhead', 'Presentation Script', 'Formal Document'])
    expect(list[0].bodyFont).toBe('times')
    expect(byName(list, 'Letterhead').fontSize).toBe(14)        // theirs, not replaced

    // Deleted afterwards, it stays deleted.
    settings.selectPreset(byName(list, 'Formal Document').id)
    settings.deleteActivePreset()
    expect(settings.presets().map((preset) => preset.name)).not.toContain('Formal Document')
  })

  it('leave a Default someone set to another face alone', () => {
    const chosen = { ...standardPreset(), bodyFont: 'georgia', headingFont: 'systemMono' }
    const settings = createSettings(memoryPrefs({ 'print.presets': [chosen] }), () => 'x')
    expect(settings.presets()[0].bodyFont).toBe('georgia')
  })

  it('keep a mono Default chosen on a fresh install', () => {
    const settings = createSettings(memoryPrefs(), () => 'x')
    settings.updateActivePreset({ bodyFont: 'systemMono', headingFont: 'systemMono' })
    expect(settings.activePreset().bodyFont).toBe('systemMono')
  })

  it('restore to the kind they were made from', () => {
    const settings = createSettings(memoryPrefs(), () => 'x')
    const script = byName(settings.presets(), 'Presentation Script')
    settings.selectPreset(script.id)
    settings.updateActivePreset({ fontSize: 9 })
    settings.restorePrintDefaults()
    expect(settings.activePreset().fontSize).toBe(22)
    expect(settings.activePreset().name).toBe('Presentation Script')
    expect(settings.activePresetID()).not.toBe(DEFAULT_PRESET_ID)
  })

  it('name a new preset after its kind', () => {
    const settings = createSettings(memoryPrefs(), () => 'new')
    settings.addPreset('formal')
    expect(settings.activePreset().name).toBe('Formal Document 2')
  })
})
