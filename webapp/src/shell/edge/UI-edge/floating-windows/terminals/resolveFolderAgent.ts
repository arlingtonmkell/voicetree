import type { AgentConfig, ResolvedAgent } from "@vt/graph-model/settings";
import { flattenAgentTree } from "@vt/graph-model/settings";

/**
 * Resolve the agent a folder rule assigns to work started on `nodeIds`.
 *
 * `agentByFolder` (settings) maps a path fragment (e.g. '/job/projects/') to an
 * agent name, matched like defaultAgent: a leaf's full path label or its own
 * name. Every node whose id contains the fragment is run by that agent instead of
 * the default one. The first rule matching any of the nodes wins; with no
 * matching rule — or a rule naming an agent that no longer exists — there is no
 * folder agent and the caller falls back to the default.
 */
export function resolveFolderAgent(
    agents: readonly AgentConfig[],
    agentByFolder: Readonly<Record<string, string>> | undefined,
    nodeIds: readonly string[],
): ResolvedAgent | undefined {
    const rule: readonly [string, string] | undefined = Object.entries(agentByFolder ?? {})
        .find(([pathFragment]: readonly [string, string]): boolean =>
            pathFragment !== '' && nodeIds.some((nodeId: string): boolean => nodeId.includes(pathFragment)));
    if (rule === undefined) return undefined;
    return flattenAgentTree(agents).find(
        (leaf: ResolvedAgent): boolean => leaf.label === rule[1] || leaf.name === rule[1],
    );
}
