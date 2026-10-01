import { describe, expect, it } from 'vitest'
import { ContentError, emptyContent, parseContent } from '../src/shared/model.ts'
import { sampleContent } from './fixtures.ts'

describe('parseContent', () => {
  it('accepts a complete valid document', () => {
    const doc = sampleContent()

    expect(parseContent(structuredClone(doc))).toEqual(doc)
  })

  it('accepts an empty document', () => {
    const doc = emptyContent('Marta', 'Fer')

    expect(parseContent(doc)).toEqual(doc)
  })

  it('rejects non-objects', () => {
    expect(() => parseContent(null)).toThrow(ContentError)
    expect(() => parseContent('hola')).toThrow(ContentError)
  })

  it('rejects an unknown schema version', () => {
    const doc = { ...sampleContent(), schemaVersion: 2 }

    expect(() => parseContent(doc)).toThrow(/schemaVersion/)
  })

  it('reports the path of a missing field', () => {
    const doc = sampleContent()
    const [first] = doc.messages
    const broken = { ...doc, messages: [{ ...first, title: undefined }] }

    expect(() => parseContent(broken)).toThrow(/messages\[0\]\.title/)
  })

  it('rejects an unknown message style', () => {
    const doc = sampleContent()
    const broken = { ...doc, messages: [{ ...doc.messages[0], style: 'rosa' }] }

    expect(() => parseContent(broken)).toThrow(/style/)
  })

  it('rejects an unknown reminder repeat', () => {
    const doc = sampleContent()
    const broken = { ...doc, reminders: [{ ...doc.reminders[0], repeat: 'yearly' }] }

    expect(() => parseContent(broken)).toThrow(/repeat/)
  })

  it('rejects a negative gift card amount', () => {
    const doc = sampleContent()
    const broken = { ...doc, giftCards: [{ ...doc.giftCards[0], initialAmount: -5 }] }

    expect(() => parseContent(broken)).toThrow(/initialAmount/)
  })

  it('rejects a malformed expiration date', () => {
    const doc = sampleContent()
    const broken = { ...doc, giftCards: [{ ...doc.giftCards[0], expiresOn: '19/11/2026' }] }

    expect(() => parseContent(broken)).toThrow(/expiresOn/)
  })

  it('rejects a malformed timestamp', () => {
    const doc = sampleContent()
    const broken = { ...doc, reminders: [{ ...doc.reminders[0], startsAt: 'mañana' }] }

    expect(() => parseContent(broken)).toThrow(/startsAt/)
  })

  it('rejects a trash item of unknown kind', () => {
    const doc = sampleContent()
    const broken = { ...doc, trash: [{ kind: 'foto', item: {}, deletedAt: '2026-10-01T10:00:00.000Z' }] }

    expect(() => parseContent(broken)).toThrow(/trash\[0\]\.kind/)
  })

  it('validates the item inside a trash entry', () => {
    const doc = sampleContent()
    const broken = {
      ...doc,
      trash: [{ kind: 'message', item: { id: 'x' }, deletedAt: '2026-10-01T10:00:00.000Z' }],
    }

    expect(() => parseContent(broken)).toThrow(/trash\[0\]\.item\.title/)
  })

  it('rejects image ids that are not safe file names', () => {
    const doc = sampleContent()
    const broken = { ...doc, messages: [{ ...doc.messages[0], imageId: '../../index' }] }

    expect(() => parseContent(broken)).toThrow(/imageId/)
  })

  it('drops unknown extra fields', () => {
    const doc = { ...sampleContent(), extra: 'x' }

    expect(parseContent(doc)).not.toHaveProperty('extra')
  })
})
