import { kindOf } from '../domain/builtins';
const paths: Record<string, string[]> = {
  system: ['M3 3h18v18H3z', 'M7 7h4v4H7zM14 7h3M14 11h3M7 16h10'],
  person: ['M16 7a4 4 0 1 1-8 0 4 4 0 0 1 8 0', 'M4 21v-3a8 8 0 0 1 16 0v3'],
  role: ['M4 4h16v16H4z', 'M8 9h3M8 13h8M8 16h5'],
  goal: ['M21 12a9 9 0 1 1-9-9', 'M17 12a5 5 0 1 1-5-5', 'M12 12l9-9M16 3h5v5'],
  capability: ['M13 2 4 14h7l-1 8 10-13h-7z'],
  document: ['M5 2h9l5 5v15H5z', 'M14 2v6h5M8 12h8M8 16h8'],
  skill: ['M3 4h8l1 2 1-2h8v16h-8l-1 2-1-2H3z', 'M12 6v14'],
  tool: ['M14 3a6 6 0 0 0-7 7L2 15l4 4 6-6a6 6 0 0 0 8-8l-4 4-3-3 4-4z'],
  task: ['M4 4h16v16H4z', 'm8 12 3 3 6-7'],
  branch: ['m12 2 10 10-10 10L2 12z'],
  loop: ['M20 8a8 8 0 1 0 0 9', 'M20 3v6h-6'],
  join: ['M4 3v5l8 6 8-6V3M12 14v8'],
  gate: ['M4 3v18M4 5h16v9H4', 'M15 9h6'],
  memory: ['M3 6c0-5 18-5 18 0s-18 5-18 0', 'M3 6v12c0 5 18 5 18 0V6', 'M3 12c0 5 18 5 18 0'],
  shield: ['m12 2 9 4v6c0 6-9 10-9 10S3 18 3 12V6z', 'm8 12 3 3 5-6'],
  lock: ['M5 10h14v12H5z', 'M8 10V6a4 4 0 0 1 8 0v4M12 15v3'],
  check: ['m4 12 5 5L20 5'],
  evaluation: ['M3 3v18h18', 'M7 17v-5M12 17V8M17 17V5'],
  frame: ['M3 8V3h5M16 3h5v5M21 16v5h-5M8 21H3v-5'],
  state: ['M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18', 'M12 7a5 5 0 1 0 0 10 5 5 0 0 0 0-10'],
};
export function symbolFor(reference: string, family?: string) {
  const k = kindOf(reference);
  if (['system', 'subsystem', 'environment', 'workflow'].includes(k)) return 'system';
  if (['agent', 'human-actor', 'human-interaction'].includes(k)) return 'person';
  if (k === 'role') return 'role';
  if (['goal', 'requirement', 'acceptance-criterion'].includes(k)) return 'goal';
  if (k === 'tool') return 'tool';
  if (k.includes('skill')) return 'skill';
  if (['task', 'action'].includes(k)) return 'task';
  if (['branch', 'decision'].includes(k)) return 'branch';
  if (['loop', 'join', 'gate'].includes(k)) return k;
  if (k === 'memory-store') return 'memory';
  if (k === 'state-definition') return 'state';
  if (k === 'access-rule') return 'lock';
  if (['authority-boundary', 'trust-boundary', 'constraint'].includes(k)) return 'shield';
  if (['validation-rule', 'test-case'].includes(k)) return 'check';
  if (k === 'evaluation-plan') return 'evaluation';
  if (family === 'capability') return 'capability';
  return 'document';
}
export function SemanticIcon({
  reference = '',
  family,
  symbol,
}: {
  reference?: string;
  family?: string;
  symbol?: string;
}) {
  return (
    <svg
      className="semantic-icon"
      viewBox="0 0 24 24"
      aria-hidden="true"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      {(paths[symbol ?? symbolFor(reference, family)] ?? paths.document)!.map((d, i) => (
        <path key={i} d={d} />
      ))}
    </svg>
  );
}
