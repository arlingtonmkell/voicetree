// Impure edge for spoken agent commands: watches the TranscriptionStore and, when
// a completed utterance is "spin up an agent to <task>", runs an agent on the
// currently selected graph nodes — the same gesture as the node menu's
// "Run Agent", minus the task popup.

import * as O from 'fp-ts/lib/Option.js'
import type {NodeIdAndFilePath} from '@vt/graph-model/graph'
import {getFinalTokens, subscribe} from '@/shell/edge/UI-edge/state/stores/TranscriptionStore'
import {getCyInstance} from '@/shell/edge/UI-edge/state/controllers/cytoscape-state'
import {flushEditorForNode} from '@/shell/edge/UI-edge/floating-windows/editors/flushEditorForNode'
import {parseVoiceAgentCommand, takeCompletedUtterances, type CompletedUtterances} from '@/shell/UI/views/hooks/voiceAgentCommand'
import {showBriefNotice} from '@/shell/UI/views/components/overlays/briefNotice'
import type {} from '@/shell/hostApi'

async function runAgentOnSelection(taskDescription: string): Promise<void> {
    const selectedNodeIds: NodeIdAndFilePath[] =
        getCyInstance().$(':selected').nodes().map((node): NodeIdAndFilePath => node.id() as NodeIdAndFilePath)
    if (selectedNodeIds.length === 0) {
        showBriefNotice('Heard the agent command, but no node is selected. Click a node, then say it again.')
        return
    }
    await Promise.all(selectedNodeIds.map((nodeId: NodeIdAndFilePath) => flushEditorForNode(nodeId)))
    showBriefNotice(`Starting an agent to ${taskDescription}`)
    await window.hostAPI?.main.runAgentOnSelectedNodes({selectedNodeIds, taskDescription})
}

/**
 * Start listening for spoken agent commands. Returns the unsubscribe function.
 */
export function listenForVoiceAgentCommands(): () => void {
    let cursor: number = 0
    return subscribe((): void => {
        const tokens = getFinalTokens()
        // The store was reset (new transcription session) — start over.
        if (tokens.length < cursor) cursor = 0
        const completed: CompletedUtterances = takeCompletedUtterances(tokens, cursor)
        cursor = completed.cursor
        for (const utterance of completed.utterances) {
            const task: O.Option<string> = parseVoiceAgentCommand(utterance)
            if (O.isNone(task)) continue
            runAgentOnSelection(task.value).catch((error: unknown) => {
                showBriefNotice('Could not start the agent. See the console for details.')
                console.error('[VoiceAgentCommand] Failed to run agent:', error)
            })
        }
    })
}
