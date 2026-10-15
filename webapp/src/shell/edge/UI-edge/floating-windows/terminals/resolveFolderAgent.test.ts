// Black-box contract for folder agent rules: a node inside a ruled folder gets the
// rule's agent; anything else (or a rule naming a missing agent) gets none, so the
// caller's default applies.
import { describe, it, expect } from 'vitest';
import type { AgentConfig } from '@vt/graph-model/settings';
import { resolveFolderAgent } from './resolveFolderAgent';

const AGENTS: readonly AgentConfig[] = [
    { name: 'Link', command: 'claude "$AGENT_PROMPT"' },
    { name: 'Cloud', command: 'bash cloud.sh "$AGENT_PROMPT"' },
    {
        name: 'Codex',
        command: 'codex "$AGENT_PROMPT"',
        children: [{ name: 'Remote', command: 'bash codex-remote.sh' }],
    },
];
const RULES: Readonly<Record<string, string>> = { '/job/projects/': 'Cloud' };

describe('resolveFolderAgent', () => {
    it('assigns the rule\'s agent to a node inside the folder', () => {
        expect(resolveFolderAgent(AGENTS, RULES, ['/ws/tree/job/projects/a.md'])?.command).toBe('bash cloud.sh "$AGENT_PROMPT"');
    });

    it('applies when any of several nodes is inside the folder', () => {
        expect(resolveFolderAgent(AGENTS, RULES, ['/ws/tree/school/x.md', '/ws/tree/job/projects/a.md'])?.name).toBe('Cloud');
    });

    it('matches an agent by its full path label as well as its leaf name', () => {
        expect(resolveFolderAgent(AGENTS, { '/job/projects/': 'Codex / Remote' }, ['/ws/tree/job/projects/a.md'])?.name).toBe('Remote');
    });

    it('assigns nothing outside the folder, with no rules, or for an unknown agent', () => {
        expect(resolveFolderAgent(AGENTS, RULES, ['/ws/tree/job/applications/a.md'])).toBeUndefined();
        expect(resolveFolderAgent(AGENTS, undefined, ['/ws/tree/job/projects/a.md'])).toBeUndefined();
        expect(resolveFolderAgent(AGENTS, { '/job/projects/': 'Gone' }, ['/ws/tree/job/projects/a.md'])).toBeUndefined();
    });
});
