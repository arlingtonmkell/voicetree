// Black-box contract for spoken agent commands: only a COMPLETED utterance that
// opens with the trigger phrase yields a task, and the cursor never re-emits an
// utterance or consumes one still being spoken.
import {describe, it, expect} from 'vitest'
import * as O from 'fp-ts/lib/Option.js'
import {parseVoiceAgentCommand, takeCompletedUtterances, type UtteranceToken} from './voiceAgentCommand'

const tokens = (...texts: string[]): UtteranceToken[] => texts.map((text: string) => ({text}))

describe('takeCompletedUtterances', (): void => {
    it('returns nothing while the utterance is still being spoken', (): void => {
        expect(takeCompletedUtterances(tokens('Spin', ' up'), 0)).toEqual({utterances: [], cursor: 0})
    })

    it('emits each utterance closed by an end token and advances past it', (): void => {
        const stream: UtteranceToken[] = tokens('Hello', ' there.', '<end>', 'Second', ' one.', '<end>', 'Half')
        expect(takeCompletedUtterances(stream, 0)).toEqual({utterances: ['Hello there.', 'Second one.'], cursor: 6})
    })

    it('does not re-emit utterances before the cursor', (): void => {
        const stream: UtteranceToken[] = tokens('One.', '<end>', 'Two.', '<end>')
        expect(takeCompletedUtterances(stream, 2)).toEqual({utterances: ['Two.'], cursor: 4})
    })

    it('skips empty utterances', (): void => {
        expect(takeCompletedUtterances(tokens('<end>', ' ', '<end>'), 0)).toEqual({utterances: [], cursor: 3})
    })
})

describe('parseVoiceAgentCommand', (): void => {
    it('extracts the task from the trigger phrase', (): void => {
        expect(parseVoiceAgentCommand('Spin up an agent to list the files in this folder.'))
            .toEqual(O.some('list the files in this folder.'))
    })

    it('accepts filler words and trigger variants', (): void => {
        expect(parseVoiceAgentCommand('Okay, spawn another agent that drafts the outline')).toEqual(O.some('drafts the outline'))
        expect(parseVoiceAgentCommand('please start up a new agent to check the due dates')).toEqual(O.some('check the due dates'))
    })

    it('skips spoken filler before the trigger', (): void => {
        expect(parseVoiceAgentCommand('Um, spin up an agent to list this folder.')).toEqual(O.some('list this folder.'))
        expect(parseVoiceAgentCommand('Uh. Okay, so spin up an agent to list this folder')).toEqual(O.some('list this folder'))
    })

    it('ignores ordinary speech, including the phrase mid-sentence', (): void => {
        expect(parseVoiceAgentCommand('I had tea this morning.')).toEqual(O.none)
        expect(parseVoiceAgentCommand('Maybe later I will spin up an agent to do it.')).toEqual(O.none)
    })

    it('ignores the trigger with no task', (): void => {
        expect(parseVoiceAgentCommand('Spin up an agent to')).toEqual(O.none)
    })
})
