import { VIEW_HELP } from './help-content';
export interface GuideSection {
  id: string;
  title: string;
  intro: string;
  steps: string[];
  notes?: string[];
}
export const GUIDE_SECTIONS: GuideSection[] = [
  {
    id: 'start',
    title: 'Start a project',
    intro:
      'Lattice is a local specification studio. It describes systems and their intended behavior; it does not execute the system you draw.',
    steps: [
      'Choose New and an empty project folder, or explore the synthetic development example at the bottom of the toolbox. An example is an editable demonstration, not an operational system.',
      'Insert a System and name it in Inspector. Use the toolbox search or Ctrl+K, then Tab and Enter, instead of dragging.',
      'Add roles, capabilities, tasks and contracts. Select an appearance to edit its shared entity; other appearances stay coordinated.',
      'Save with Ctrl+S. Open… reads a project folder containing project.json. Associated files stay in the attached workspace roots.',
    ],
    notes: [
      'Start with responsibilities and contracts. A role need not be a separate agent; a capability may be an existing script, tool, skill or human action.',
      'This application has no hosted backend, accounts, updater or telemetry. Live AI is deferred; the current provider is explicitly simulated.',
    ],
  },
  {
    id: 'views',
    title: 'How the four views work',
    intro:
      'The four views project the same entities and relationships. They provide different starting perspectives, with independent appearance positions, frames, collapse state and camera.',
    steps: [
      'Architecture asks who owns what and where authority or dependencies lie.',
      'Behavior asks what happens next, under which conditions, and how work completes or fails.',
      'Information asks what context, state, memory and artifacts are required and exchanged.',
      'Validation asks what must be true, how it will be checked and which evidence or reviews remain missing.',
    ],
    notes: [
      'An entity may appear more than once, and in several views. Changing its name/properties changes every appearance. Moving, hiding or grouping an appearance changes only that view.',
      'Default family filters determine initial appearances. Inspector → Appearances can add another appearance or hide/show it. A missing appearance does not delete the entity.',
    ],
  },
  ...(['architecture', 'behavior', 'information', 'validation'] as const).map((id) => ({
    id,
    title: `${id[0]!.toUpperCase() + id.slice(1)} view`,
    intro: VIEW_HELP[id],
    steps:
      id === 'architecture'
        ? [
            'Start with a System, human/agent actors and Roles. Write the responsibilities in Inspector.',
            'Use Fulfills role, Uses capability, Depends on or Governed by for explicit meanings.',
            'Use visual containers for layout. Use Contains only when you intend semantic membership.',
            'Enter a system from Inspector or double-click its node. Whole system returns to the overall project.',
          ]
        : id === 'behavior'
          ? [
              'Give each Task its inputs, outputs and failurePath.',
              'Use Precedes or Hands off to for sequence, Branches to for choices, and Joins for convergence.',
              'State branch conditions, gate criteria and explicit loop bounds or completion paths.',
              'A drawn flow is a specification; it does not run work or authorize a release.',
            ]
          : id === 'information'
            ? [
                'Describe Context contracts, State definitions, Memory stores and Artifact contracts.',
                'Use Reads, Writes, Receives context, Produces or Consumes to make dependencies visible.',
                'Record provenance, ownership, freshness, fields and failure behavior in the contracts.',
                'Associate actual files in Files, then establish a reviewed baseline in Review.',
              ]
            : [
                'State Goals, Requirements, Constraints and Acceptance criteria precisely.',
                'Connect requirements to planned Test cases or Evaluation plans with Checked by / Satisfies.',
                'Inspect deterministic results and unknowns in Findings; keep check status separate from human disposition.',
                'Record actual design reviews for the current design. Runtime correctness still needs implementation evidence.',
              ],
  })),
  {
    id: 'diagram',
    title: 'Read the diagram and legend',
    intro:
      'Icons, line patterns, endpoints and labels carry meaning together. Color is an additional cue. Open Legend on the canvas for the full edge key.',
    steps: [
      'A target icon indicates intent; a person indicates an actor; a badge indicates a role; a bolt/wrench/book indicates a capability, tool or skill.',
      'Branch diamonds, loop arrows, gate flags, state rings and memory cylinders distinguish control and information concepts. Shields/locks identify boundaries or access. Unknown/custom types use a generic symbol.',
      'Solid structural lines, blue flow lines, dashed information lines, dash-dot authority lines and dotted validation lines have different purposes. The label remains the exact relationship type.',
      'Arrowheads follow the definition’s source-to-target direction. A Reads arrow goes from the reader to the data source; do not treat every arrow as the physical movement of data. Undirected definitions have no arrow.',
      'Contains has a diamond at its owning endpoint. Denies has a stop bar. High/critical importance makes a link wider and adds a text label. A finding is labelled separately.',
      'Select a node to emphasize its immediate links and outline its direct neighbors. This is local adjacency; use Review → Impact for declared dependency traversal.',
    ],
  },
  {
    id: 'authoring',
    title: 'Author and inspect',
    intro:
      'Toolbox components are typed records. Inspector edits shared semantics; canvas layout controls edit appearances.',
    steps: [
      'Hover or focus toolbox buttons for concise definitions and usage. Click to insert, or drag a component to a specific location.',
      'Click a node to inspect it; Shift-click adds/removes entities from selection. Hover/focus a node for its description, type and implementation claim.',
      'Edit the name and properties in Inspector. Text fields commit on leaving them; Enter commits the name. Advanced JSON supports structured properties.',
      'Value states distinguish declared, inherited, unknown and proposed values. An invalid or incomplete design remains editable and gets Findings.',
      'Connect… provides source, relationship type, target and optional port selectors. Dragging handles opens the same reviewable connection form.',
      'Select a relationship to edit its endpoints, ports, importance and strict JSON properties. Undefined contract compatibility remains unknown.',
      'Duplicate selection creates fresh identities. Delete selection previews affected relations/bindings; associated disk files are retained.',
      'Choose a new pinned type in Inspector, Preview migration, then accept its recomputed findings. Newer revisions make that preview stale.',
    ],
  },
  {
    id: 'containers',
    title: 'Containers, grouping and nesting',
    intro:
      'A container is a named frame in one view. It creates no entity, Contains relationship, access grant or execution order.',
    steps: [
      'Choose Add container for an empty frame, or select nodes and choose Group selection to frame their appearances. No links are required.',
      'Click the frame header to select it. Inspector changes its name, description, dimensions and parent. Drag its header to move the whole group.',
      'Use Parent container in Inspector to put an appearance or another frame inside a container. Choosing Canvas removes that parent while preserving world position.',
      'Nested containers cannot contain themselves or their descendants. Collapse/expand hides or reveals visual descendants and their visible links.',
      'Resize a selected frame with its handles, or set width/height in Inspector. Children are not automatically forced inside a smaller frame.',
      'Remove container keeps every member and its world position. Undo layout restores prior grouping. Container changes never advance the semantic revision or alter other view layouts.',
    ],
    notes: [
      'Legacy entity-based grouping remains readable. Containers are stored in the view files, separately from the canonical model and semantic exports.',
    ],
  },
  {
    id: 'navigation',
    title: 'Navigate, search and arrange',
    intro:
      'The workspace combines a toolbox, canvas, Inspector and switchable panels. Width and panel-height controls are in the status bar.',
    steps: [
      'Search all components includes hidden entities. Choose a result, follow Inspector appearance buttons, then Focus selection.',
      'Fit view frames the visible graph. Zoom controls and the minimap change the camera; dragging a node changes its appearance position.',
      'System connections toggles edges with a System at either endpoint. They start hidden. Nodes and semantic relationships remain available in the model and exports; this preference stays on this computer.',
      'Arrange runs layout in a worker. Container membership and relative child positions are retained while root items are arranged.',
      'Double-click a semantic System/SubSystem, or use Enter nested system in Inspector. The breadcrumb returns to Whole system.',
      'Use Undo layout for presentation changes. Semantic Undo/Redo are separate, and Monaco maintains its own text history.',
    ],
  },
  {
    id: 'appearance',
    title: 'Themes, colors, fonts and tooltips',
    intro:
      'Appearance settings are personal to this machine. They do not change the project model, readiness or exports.',
    steps: [
      'Use the theme button in the header for an immediate light/dark switch.',
      'Open Settings (Ctrl+,) to choose the theme and installed interface/editor font families and sizes.',
      'Colors edits the selected light or dark palette independently. Choose accent, application background, borders, graph, grid, node background and font colors. The preview shows your draft; custom choices are retained exactly. Link text and button foregrounds derive readable shades from the accent.',
      'Graph tooltips start off. Enable them in the canvas toolbar or Settings → Tooltips for hover and keyboard-focus explanations on the graph. Help for controls, toolbox items and inspector fields remains available. Tooltips settings also control the delay in milliseconds, font size in pixels, and mode-specific colors. Escape dismisses a tooltip.',
      'Family presets color toolbox items and node accents. Their text is chosen for contrast; semantic node icons and edge patterns remain available alongside color.',
      'Reset light/dark palette restores colors for that mode, including its tooltip colors. Restore defaults resets the entire draft, including fonts, tooltip settings and snapping. Apply appearance saves; Cancel discards the draft.',
      'Use the preview samples before Apply appearance. Cancel retains your current preferences; Restore defaults changes the draft until you apply it.',
      'Interface fonts affect controls, nodes and help; editor fonts affect Monaco and code-style text. No web fonts are downloaded.',
      'Monaco follows the global background and default font color while retaining syntax highlighting. Applying a style does not replace editor buffers or their undo history.',
      'Choices survive closing and reopening Lattice. If Windows cannot enumerate fonts, current families can still be used.',
    ],
  },
  {
    id: 'snapping',
    title: 'Snap to grid and objects',
    intro:
      'Snapping changes presentation positions while dragging or using the keyboard. It creates no relationships or semantic membership.',
    steps: [
      'Open Settings → Snapping. Enable Snap to grid and choose an 8–100 unit grid. Existing nodes remain in place until moved; dropped nodes also snap.',
      'Enable Snap to objects to align edges or centers with other visible nodes and containers while dragging. Choose a 2–24 screen-pixel tolerance; zoom does not change the physical attraction distance.',
      'Matching axes display dashed guides. Object alignment takes priority near a match; grid snapping handles axes without a match when both options are enabled.',
      'Multi-selection keeps its relative spacing. A moving group, its ancestors and descendants are excluded as alignment targets. Nested positions remain relative to their parents.',
      'Arrow keys use grid-sized steps when enabled, or precise five-unit steps otherwise. Shift multiplies the keyboard step by four; object attraction is limited to pointer dragging so it cannot trap keyboard movement.',
      'Changing settings leaves semantic revisions and saved positions unchanged. Moving an item uses layout history and persists through Save/reopen. Resize handles and Arrange retain their existing behavior.',
    ],
  },
  {
    id: 'findings',
    title: 'Findings, reviews and readiness',
    intro:
      'Checks describe the specification. They do not execute or enforce the receiving system.',
    steps: [
      'Findings lists failures and unknowns. Include passes shows successful and not-applicable checks. Recheck runs the current deterministic analysis.',
      'Status, severity, disposition and freshness are separate. Acknowledge/defer records a rationale; it cannot hide a mandatory failure from readiness.',
      'Select a finding to inspect its message, targets and explanatory path. A stale result/review covers older inputs.',
      'Rules cover required/allowed values, endpoint/port contracts, relation counts, dependencies, scoped grants/denials and bounded reachability. Denial wins; absent permission stays unspecified.',
      'Review coverage requires actual attributed reviews of responsibilities, interfaces, information, failure paths and acceptance for the current design hash.',
      'Implementation-ready requires every mandatory deterministic check and review to be current and passing. Draft export is always available.',
    ],
  },
  {
    id: 'files',
    title: 'Files, editor and ownership',
    intro:
      'Files are identified by an attached workspace-root ID and a relative path. Machine-specific root locations stay outside canonical project data.',
    steps: [
      'Files → Attach root selects a local folder. Browse directories and open resources; Git information is read-only.',
      'UTF-8 text, Markdown and strict JSON are editable. BOM and newline conventions are preserved. Binary, invalid/mixed encodings and files over 5 MiB use metadata and Show in Explorer.',
      'Monaco Ctrl+S saves the loaded file buffer with a disk-hash precondition. If disk changed, compare it with your buffer and decide how to proceed.',
      'Markdown preview omits raw HTML, images and automatic remote resource loading. Unsaved buffers are kept locally when switching panels.',
      'Associate… declares the entities, ownership and mappings. Independent means file owns content; generated means declared model-owned content; managed means only bounded sections are replaced.',
      'Markdown mappings use matching lattice:begin / lattice:end marker IDs. JSON mappings use JSON Pointers; text mappings explicitly map the whole file.',
      'Saving raw text does not accept a baseline. Use Review for initial association and subsequent reconciliation.',
    ],
  },
  {
    id: 'review',
    title: 'Reconcile and analyze impact',
    intro:
      'Review compares the accepted baseline, current model projection and current file. No conflict is silently resolved.',
    steps: [
      'Compare / reconcile labels a missing baseline as Initial association review. Inspect text and semantic values before choosing a disposition.',
      'For each mapping choose model, file, revised value or defer. Independent ownership prevents automatic model replacement of independent prose.',
      'Accept reviewed dispositions recomputes the comparison against current hashes/revision. Newer work invalidates a stale preview.',
      'Missing, duplicate, overlapping or broken Markdown markers stop replacement. Bytes outside selected Markdown sections are preserved.',
      'Renames are suggestions based on exact accepted hashes and require confirmation. Detaching/deleting a binding or model entity keeps disk files.',
      'Impact follows each declared relationship interpretation, returns explanatory paths and stops cycles. Default depth is three edges; full expansion shows the affected set.',
      'Workspace notices and pending recovery operations are shown here. Preserve conflicting files before choosing resume or reversal.',
    ],
  },
  {
    id: 'library',
    title: 'Definitions and packages',
    intro:
      'Library registers declarative, versioned component and relationship definitions. It does not execute imported scripts or arbitrary rule code.',
    steps: [
      'Choose a component or relationship definition, then edit its name, description, supported JSON Schema, ports, renderer and rules in JSON.',
      'Use the rule templates for the bounded vocabulary. Unsupported keywords/placements are rejected with an explanation.',
      'Register version pins an exact immutable definition. Change the version to publish a local revision, then preview type migration or selective assembly upgrades.',
      'Export/import a self-contained definition package. Exact hashes and bundled assembly dependencies are verified.',
      'An unresolved type is rendered generically and keeps its original data. Use Findings to locate the missing definition.',
    ],
  },
  {
    id: 'assemblies',
    title: 'Reusable assemblies',
    intro:
      'Assemblies save a reusable semantic subgraph. They are different from presentation-only containers.',
    steps: [
      'Select semantic nodes, name the assembly in Library, then Save selection as assembly.',
      'The assembly JSON can declare exposed parameters, ports and exact dependencies. Register a new version after editing a definition.',
      'Choose a pinned definition and parameter JSON, then Insert new instance. Each instance receives fresh entity and relationship IDs.',
      'Select one instance and a new definition in Selective upgrade. Compare the old definition, new definition and local values.',
      'Resolve conflicts by retaining local values or accepting definition values, then apply the reviewed upgrade to that selected instance. Other instances remain pinned.',
    ],
  },
  {
    id: 'ai',
    title: 'Simulated AI proposals',
    intro:
      'The current provider is deterministic simulation. Live-provider selection, credentials and live integration remain deferred.',
    steps: [
      'Select the explicit entity scope. Include only the excerpts or associated Markdown file you want the provider to receive.',
      'Describe the request and choose Preview simulated proposal. Explanations, assumptions, command groups and dependency requirements appear for review.',
      'Inspect predicted Findings and choose groups. Partial acceptance creates a fresh checked batch; dependent groups require their prerequisites.',
      'Accept selected commands uses the shared command service. Any newer semantic revision makes the proposal stale and requires recomputation.',
      'File patches have their own before/after diff and Save reviewed file patch action. Their loaded disk hash must match, and affected mappings still need reconciliation.',
      'Cancel stops the request; failure or malformed output does not mutate the project. Simulation cannot record human approval or implemented/verified results.',
    ],
  },
  {
    id: 'exports',
    title: 'Preview and export',
    intro:
      'Exports freeze a semantic revision and include traceability, definitions, validation and a file-hash manifest.',
    steps: [
      'Export package → choose Portable specification or Codex workspace and the Draft or Implementation-ready status.',
      'Prepare preview and inspect the specification, implementation brief, semantic model, traceability and validation report. Planned work is labelled separately from execution results.',
      'Portable includes the model and required definitions/documents. Codex workspace additionally generates declared directory-scoped AGENTS.md instructions and complete .agents/skills/<name>/SKILL.md resources.',
      'Instructions apply according to their actual directory scope. Skill generation needs its description and body; supporting text files must be explicitly supplied.',
      'Choose destination and compare existing files. Write reviewed package uses fresh hashes and the frozen revision; newer work requires a new preview.',
      'The manifest hashes every other generated file and records its own self-hash exclusion. Local root paths, baseline prose and detected credentials are excluded. Associated resources are referenced by default.',
    ],
  },
  {
    id: 'recovery',
    title: 'Save, reopen and recover',
    intro:
      'Canonical project data, presentation files, semantic history and text buffers have separate responsibilities.',
    steps: [
      'Semantic changes are journaled before acknowledgement and snapshots save after a one-second debounce. Save or orderly close flushes immediately.',
      'Only one project writer holds the lease. Another writable opener becomes read-only; detected lease loss stops writes.',
      'Interrupted semantic edits and unsaved workspaces are offered for review. Invalid external canonical data does not replace the last valid session.',
      'External project.json edits are imports: choose import, keep the current model while preserving the external copy, or defer. Deletion requires explicit restoration.',
      'Multi-file writes keep original hashes, recovery copies and per-file outcomes. Resume or reverse stops if newer disk content would be overwritten.',
      'A failed replacement keeps its flushed staging file. Preserve it and the original for manual recovery; orphan staging files are not automatically adopted.',
      'After moving a project, reopen it and rebind named roots. Entity/root IDs remain stable; local folder locations do not travel in the model.',
    ],
  },
  {
    id: 'keyboard',
    title: 'Keyboard reference',
    intro:
      'Native controls, visible focus and text labels provide alternatives to pointer dragging. Tooltips also open on focus.',
    steps: [
      'F1: open the user guide. Escape: dismiss a tooltip or close the active dialog.',
      'Ctrl+, : appearance settings. Ctrl+K: focus toolbox search. Tab / Shift+Tab: move between controls; Enter / Space: activate buttons.',
      'Ctrl+S outside Monaco: save the project. In Monaco: save that associated file.',
      'Ctrl+Z / Ctrl+Shift+Z outside text fields: semantic undo / redo. Inside Monaco: text undo / redo. Undo layout is a separate canvas control.',
      'Connect…: choose source, relationship, target and ports with native selects, then activate Create relationship.',
      'Group selection, Parent container and frame dimensions are keyboard-accessible alternatives to dragging and resizing.',
      'React Flow node focus and arrow keys support keyboard navigation/movement. Inspector appearance buttons and Focus selection locate a record across views.',
    ],
  },
];
