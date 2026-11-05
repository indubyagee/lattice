import type { ViewKind } from '../domain/types';
export const VIEW_HELP: Record<ViewKind, string> = {
  architecture:
    'Structure, responsibilities and boundaries: who owns what, which capabilities they use, and where authority ends. Use systems, roles, agents, humans and resources.',
  behavior:
    'Sequence, decisions and completion: how tasks exchange work, branch, loop, hand off and fail. Use workflows, tasks, gates and explicit flow relationships.',
  information:
    'Information and contracts: what is read, written, produced, retained and passed as context. Use state, memory, artifact and context contracts.',
  validation:
    'Intent and assurance: what must be true, which constraints apply, how requirements are checked and what evidence is still missing. Planned checks remain distinct from results.',
};
export const PANEL_HELP = {
  findings:
    'Computed specification checks and attributed design reviews. Inspect failures, unknowns, evidence paths and dispositions; acknowledgement never turns a check into a pass.',
  files:
    'Browse attached folders, edit UTF-8 files and preview Markdown. Associate files with model records; changed disk hashes stop stale saves.',
  ai: 'Review explicitly simulated AI command groups and optional file patches. Nothing changes until you accept it. A live provider is not configured.',
  review:
    'Reconcile model/file changes against accepted baselines, review impact paths, confirm renames and recover interrupted edits or file batches.',
  library:
    'Define component and relationship types, import/export pinned packages, save reusable assemblies and review selective upgrades.',
};
export const COMPONENT_HELP: Record<string, string> = {
  system:
    'A complete system or subsystem boundary. Start here to describe purpose and membership; use Contains for semantic membership, or a visual container for layout only.',
  subsystem:
    'A meaningful part of a larger system. Define its responsibility and connect its dependencies; enter it to inspect its semantic members.',
  agent:
    'A software actor that can perform work. Link it to roles and capabilities; an agent is not required for every responsibility.',
  role: 'A responsibility rather than a required process. Describe its responsibilities and use Fulfills role to identify the actor that performs them.',
  'human-actor':
    'A person or human authority in the design. Use for review, decisions, authorization and work that stays under human control.',
  environment:
    'The receiving or operating context. Record assumptions and limits; use Runs in to connect actors or capabilities to it.',
  annotation:
    'An explanatory note on the model. Use for rationale or questions; it does not implement behavior or grant authority.',
  goal: 'An intended outcome. Describe success and connect the actors or work that pursue it.',
  constraint:
    'A limit the design must respect. Record the rule, scope and rationale, then use Constrained by to identify affected parts.',
  requirement:
    'A required behavior or property. State it precisely and link it to acceptance criteria or checks.',
  decision:
    'A design choice or decision point. Describe alternatives and authority; a planned decision is not an approval.',
  'acceptance-criterion':
    'A condition for accepting the design or implementation. Make it observable and connect it to a check or evaluation.',
  'model-configuration':
    'The intended model/provider configuration. Specify its contract and limits; this record does not configure a live provider in Lattice.',
  capability:
    'An ability that may be provided by a script, tool, skill, prompt, human or system. Specify its input/output contract before choosing an implementation.',
  action:
    'A bounded operation. Describe its trigger, input, output and failure behavior, then connect the responsible actor.',
  prompt:
    'A reusable instruction or prompt specification. Describe its purpose, expected context and output; storing it does not execute it.',
  skill:
    'A reusable instruction procedure. Supply a description and body; a complete skill can be exported as a SKILL.md resource.',
  'skill-collection':
    'A related set of skills. Use it to organize reusable procedures and their dependencies.',
  tool: 'An external operation or resource. Describe its contract and access requirements. Intended Uses tool links do not grant permission.',
  'framework-reference':
    'An explicit reference to an implementation framework or existing library. Record the version and why the design depends on it.',
  workflow:
    'A coordinated sequence of work. Connect tasks and decision points with explicit flow; visual nesting alone does not define execution order.',
  task: 'A unit of work with inputs, outputs and a failure path. Connect tasks with Precedes or Hands off to to make the intended sequence visible.',
  handoff:
    'A transfer of work or responsibility. Specify the receiving party, required context and acceptance or return conditions.',
  branch:
    'A conditional choice. Record the conditions and connect the alternative paths with Branches to.',
  loop: 'Repeated work. Declare an iteration bound or completion path; a drawn cycle alone does not establish termination.',
  join: 'A convergence of paths. Specify what must arrive and when work may continue.',
  gate: 'A checkpoint that controls progress. State its criteria and authority; a planned gate is not an executed approval.',
  'human-interaction':
    'A point where a person supplies information, reviews or decides. Specify the request and allowed outcomes.',
  'context-contract':
    'The context a task or actor needs. Describe required information, provenance, freshness and what must be excluded.',
  'state-definition':
    'A named state and its allowed data. Use Transitions to to describe permitted state changes.',
  'memory-store':
    'Information retained across work. Specify authority, access, lifetime and update rules; use Reads, Writes or Retains in.',
  'artifact-contract':
    'The expected structure and ownership of an artifact. Specify fields, version, producer, consumer and validation.',
  'authority-boundary':
    'Where decision or authorization power begins and ends. Name the authority, scope and conditions.',
  'access-rule':
    'An intended grant or denial. Specify actorId, resourceId, action and effect. Explicit denial wins; unspecified access stays unknown.',
  'trust-boundary':
    'A boundary between sources or components with different trust. Describe what must be validated before crossing it.',
  'validation-rule':
    'A design-check requirement. Define an observable condition; executable custom rules use the bounded Library rule vocabulary.',
  'test-case':
    'A planned verification case. Specify setup, action, expected outcome and evidence; planning a test does not mean it passed.',
  'evaluation-plan':
    'A comparative evaluation contract. Provide a baseline and criteria, then identify cases, evidence and decision thresholds.',
};
export const INSPECTOR_HELP: Record<string, string> = {
  'Component name':
    'Rename the shared entity in every appearance. Commit with Enter or by leaving the field; this does not move its appearances.',
  Description:
    'Explain the purpose and behavior of this component. This shared design value also appears in its hover tooltip.',
  'Implementation claim':
    'Record a declared planned, implemented or verified state. Verified requires evidence references; a label alone does not establish runtime correctness.',
  'Evidence references':
    'One evidence reference per line. Identify actual supporting results or artifacts; a planned test is not completed evidence.',
  'New pinned type':
    'Choose an exact type version and preview its effects before accepting a migration. Existing properties are retained.',
  'Relationship type':
    'Choose the meaning of the selected connection. Endpoint or property incompatibilities remain editable and produce Findings.',
  'Source entity':
    'The originating record of this relationship. The arrow points from source to target when the definition is directed.',
  'Target entity':
    'The receiving or referenced record of this relationship. Direction has the meaning declared by its relationship type.',
  'Source port':
    'Choose an outgoing contract port. Compatibility uses explicit contract references; unresolved contracts remain unknown.',
  'Target port':
    'Choose an incoming contract port. Missing or incompatible contracts appear in Findings.',
  'Relationship properties':
    'Edit strict JSON properties such as action, inheritance, conditions or importance. These are shared semantic data.',
  'Parent container':
    'Move this view item into a frame, or back to the canvas. World position is preserved and no model relationship is added.',
  'Container name':
    'Name this visual frame in the current view. Containers are presentation only and never become semantic model records.',
};
export const CONTROL_HELP: Record<string, string> = {
  Settings:
    'Choose local fonts, per-mode colors, tooltip style and timing, and grid/object snapping. Ctrl+, opens settings; Apply saves the draft.',
  'User guide': 'Open the searchable built-in guide. Press F1 from anywhere in the workspace.',
  'Save file':
    'Save this editor buffer only if its loaded disk hash still matches. This does not accept artifact reconciliation.',
  Save: 'Flush the canonical project and view files. Ctrl+S saves the project outside Monaco; inside Monaco it saves the file buffer.',
  'Open…':
    'Open an existing project folder. Valid external changes require review and another writer forces a read-only session.',
  New: 'Create a project in an empty folder. Existing source files and associated resources are preserved.',
  'Export package':
    'Preview a frozen specification package, review destination differences, then explicitly write it.',
  'Fit view':
    'Fit the visible diagram into the canvas. This changes the camera, not the semantic model.',
  Arrange:
    'Lay out the visible graph in a worker. Existing container membership and other views are preserved.',
  'Undo layout':
    'Undo a presentation change in this view. Semantic and text-buffer histories are separate.',
  'Focus selection': 'Center the current selection without changing model data.',
  'Connect…':
    'Create a typed semantic relationship using keyboard-accessible source and target selectors.',
  'Add container':
    'Add an empty presentation-only frame. Nest nodes or other containers through their Parent container field.',
  'Group selection':
    'Put the selected appearances into a new frame without creating links or changing the model.',
  'Compare / reconcile':
    'Compare the accepted baseline, current model values and current file. Review each disposition before accepting.',
  'Associate…':
    'Declare which records and fields are associated with this file, its ownership and mapping locations.',
};
