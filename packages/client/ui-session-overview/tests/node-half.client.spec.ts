import { describe, expect, it } from 'vitest'
import { apply } from '../src/index.ts'

describe('ui-session-overview node half', () => {
  it('has no Host behavior', () => {
    apply()
    expect(apply).toBeTypeOf('function')
  })
})
