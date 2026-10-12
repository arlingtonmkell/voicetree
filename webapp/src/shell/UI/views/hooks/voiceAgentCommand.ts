// Spoken agent commands: "spin up an agent to <task>".
//
// The transcription stream is a flat list of final tokens; Soniox endpoint
// detection marks the end of each utterance with an `<end>` token. A command is
// recognised only on a COMPLETED utterance, so a pause mid-sentence can never
// spawn an agent on half a task.
//
// Both functions are pure; SpokenSpawnListener is the impure edge that
// reads the store, the graph selection, and calls the spawn.

import * as O from 'fp-ts/lib/Option.js'

export const UTTERANCE_END_TOKEN: string = '<end>'

export interface UtteranceToken {
    readonly text: string
}

export interface CompletedUtterances {
    readonly utterances: readonly string[]
    /** Index of the first token not yet consumed — pass back as `cursor` next time. */
    readonly cursor: number
}

/**
 * Collect every utterance that completed at or after `cursor`. Tokens after the
 * last `<end>` belong to an utterance still being spoken and are left unconsumed.
 */
export function takeCompletedUtterances(tokens: readonly UtteranceToken[], cursor: number): CompletedUtterances {
    const utterances: string[] = []
    let utteranceStart: number = cursor
    for (let index: number = cursor; index < tokens.length; index += 1) {
        if (tokens[index].text !== UTTERANCE_END_TOKEN) continue
        const text: string = tokens.slice(utteranceStart, index).map((t: UtteranceToken) => t.text).join('').trim()
        if (text) utterances.push(text)
        utteranceStart = index + 1
    }
    return {utterances, cursor: utteranceStart}
}

// "spin up an agent to …", "spawn an agent that …", "start up a new agent to …".
// Leading filler ("um, okay, so …") is skipped — speech rarely starts cleanly.
const AGENT_COMMAND_RE: RegExp =
    /^(?:(?:u+[hm]+|e+r+m*|h+m+|ok(?:ay)?|hey|please|so|well|and|now|right|alright)[,.!]?\s+)*(?:spin\s+up|start\s+up|fire\s+up|spawn|launch|start)\s+(?:an?|another)\s+(?:new\s+)?agent\s+(?:to|that|which|for)\s+(.+)$/is

/** The task description if the utterance is an agent command, else none. */
export function parseVoiceAgentCommand(utterance: string): O.Option<string> {
    const match: RegExpMatchArray | null = utterance.trim().match(AGENT_COMMAND_RE)
    const task: string = match?.[1]?.trim() ?? ''
    return task ? O.some(task) : O.none
}
