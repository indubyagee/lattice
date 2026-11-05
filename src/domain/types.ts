/** Portable records. No rendering-library state or machine-specific paths belong here. */
export type JsonValue =
  null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue };
export type JsonObject = { [key: string]: JsonValue };
export type ViewKind = 'architecture' | 'behavior' | 'information' | 'validation';
export type Family =
  'structure' | 'purpose' | 'capability' | 'behavior' | 'information' | 'boundary';
export type ValueStatus = 'declared' | 'inherited' | 'unknown' | 'proposed';
export interface Provenance {
  actor: string;
  at: string;
  source?: string;
}
export interface Port {
  id: string;
  direction: 'in' | 'out' | 'both';
  contractRef?: string;
}
export type Rule =
  | { kind: 'required'; property: string }
  | { kind: 'allowed'; property: string; values: JsonValue[] }
  | { kind: 'endpoint-port' }
  | {
      kind: 'relation-count';
      relation: string;
      direction: 'in' | 'out';
      min?: number;
      max?: number;
    }
  | { kind: 'dependency'; relation: string; targetType?: string }
  | { kind: 'access' }
  | {
      kind: 'reachability';
      relations: string[];
      targetType: string;
      maxDepth: number;
      boundProperty?: string;
    };
export interface TypeDefinition {
  id: string;
  version: string;
  name: string;
  family: Family;
  description: string;
  schema: JsonObject;
  ports: Port[];
  renderer: 'node' | 'container' | 'annotation';
  rules: Rule[];
}
export interface RelationDefinition {
  id: string;
  version: string;
  name: string;
  sourceFamilies: Family[];
  targetFamilies: Family[];
  direction: 'directed' | 'undirected';
  impact: 'source-depends-on-target' | 'target-depends-on-source' | 'possible' | 'none';
  schema: JsonObject;
  rules: Rule[];
}
export interface Entity {
  id: string;
  typeRef: string;
  name: string;
  properties: JsonObject;
  propertyStatus: Record<string, ValueStatus>;
  systemIds: string[];
  provenance: Provenance;
  implementationStatus: 'planned' | 'implemented' | 'verified';
  evidence: string[];
}
export interface Relationship {
  id: string;
  typeRef: string;
  source: string;
  target: string;
  sourcePort?: string;
  targetPort?: string;
  properties: JsonObject;
  provenance: Provenance;
}
export interface AssemblyDefinition {
  id: string;
  version: string;
  name: string;
  description: string;
  entities: Entity[];
  relationships: Relationship[];
  dependencies: string[];
  parameters: { name: string; entityId: string; property: string; default: JsonValue }[];
  ports: { name: string; entityId: string; portId: string }[];
}
export interface AssemblyInstance {
  id: string;
  definitionRef: string;
  definitionHash: string;
  mapping: Record<string, string>;
  relationshipMapping: Record<string, string>;
  parameters: JsonObject;
}
export interface ResourceRef {
  rootId: string;
  path: string;
}
export interface ArtifactMapping {
  id: string;
  entityId: string;
  pointer: string;
  format: 'markdown' | 'json' | 'text';
  locator: string;
}
export interface Baseline {
  modelRevision: number;
  resourceHash: string;
  mappingVersion: string;
  content: string;
  values: Record<string, JsonValue>;
}
export interface ArtifactBinding {
  id: string;
  resource: ResourceRef;
  entityIds: string[];
  ownership: 'independent' | 'generated' | 'managed';
  mappings: ArtifactMapping[];
  baseline?: Baseline;
  state: 'unreviewed' | 'accepted' | 'pending' | 'missing';
}
export type CheckStatus = 'pass' | 'fail' | 'unknown' | 'not-applicable';
export type Disposition = 'open' | 'acknowledged' | 'deferred' | 'resolved';
export interface Finding {
  id: string;
  rule: string;
  version: string;
  targets: string[];
  severity: 'error' | 'warning' | 'info';
  status: CheckStatus;
  disposition: Disposition;
  message: string;
  evidence: string[];
  revision: number;
  inputHash: string;
  stale: boolean;
  mandatory: boolean;
}
export interface Decision {
  id: string;
  question: string;
  alternatives: string[];
  disposition: string;
  actor: string;
  rationale: string;
  affectedIds: string[];
  revision: number;
}
export interface DesignReview {
  id: string;
  topic: 'responsibilities' | 'interfaces' | 'information' | 'failure-paths' | 'acceptance';
  actor: string;
  rationale: string;
  designHash: string;
  at: string;
}
export interface Project {
  schemaVersion: '1.0.0';
  id: string;
  name: string;
  purpose: string;
  revision: number;
  entities: Record<string, Entity>;
  relationships: Record<string, Relationship>;
  types: Record<string, TypeDefinition>;
  relationTypes: Record<string, RelationDefinition>;
  assemblies: Record<string, AssemblyDefinition>;
  instances: Record<string, AssemblyInstance>;
  bindings: Record<string, ArtifactBinding>;
  decisions: Decision[];
  reviews: DesignReview[];
  dispositions: Record<string, { disposition: Disposition; rationale: string; inputHash: string }>;
  extensions: JsonObject;
}
export interface Appearance {
  id: string;
  entityId: string;
  x: number;
  y: number;
  hidden?: boolean;
  parentAppearanceId?: string;
}
export interface ViewDefinition {
  id: ViewKind;
  appearances: Appearance[];
  containers?: ViewContainer[];
  collapsedIds: string[];
  viewport: { x: number; y: number; zoom: number };
}
/** A presentation-only frame. Its ID never identifies a semantic entity. */
export interface ViewContainer {
  id: string;
  name: string;
  description: string;
  x: number;
  y: number;
  width: number;
  height: number;
  parentAppearanceId?: string;
}
export type Views = Record<ViewKind, ViewDefinition>;
export type Operation =
  | { kind: 'create-entity'; entity: Entity }
  | {
      kind: 'update-entity';
      id: string;
      name?: string;
      properties?: JsonObject;
      propertyStatus?: Record<string, ValueStatus>;
      systemIds?: string[];
      implementationStatus?: Entity['implementationStatus'];
      evidence?: string[];
      typeRef?: string;
    }
  | { kind: 'set-value'; id: string; pointer: string; value: JsonValue }
  | { kind: 'remove-entity'; id: string }
  | { kind: 'put-relationship'; relationship: Relationship }
  | { kind: 'remove-relationship'; id: string }
  | { kind: 'register-type'; definition: TypeDefinition }
  | { kind: 'register-relation'; definition: RelationDefinition }
  | { kind: 'register-assembly'; definition: AssemblyDefinition }
  | { kind: 'instantiate'; definitionRef: string; instanceId: string; parameters: JsonObject }
  | {
      kind: 'upgrade-instance';
      instanceId: string;
      definitionRef: string;
      resolutions: Record<string, 'local' | 'definition'>;
    }
  | { kind: 'put-binding'; binding: ArtifactBinding }
  | { kind: 'remove-binding'; id: string }
  | {
      kind: 'disposition';
      findingId: string;
      disposition: Disposition;
      rationale: string;
      inputHash: string;
    }
  | { kind: 'decision'; decision: Decision }
  | { kind: 'review'; review: DesignReview }
  | { kind: 'replace-snapshot'; snapshot: Project };
export interface CommandBatch {
  baseRevision: number;
  operations: Operation[];
  reason: string;
  expectedDesignHash?: string;
}
export interface CommandResult {
  project: Project;
  changedIds: string[];
}
export interface DefinitionPackage {
  format: 'lattice-package@1';
  name: string;
  types: TypeDefinition[];
  relations: RelationDefinition[];
  assemblies: AssemblyDefinition[];
  hashes: Record<string, string>;
}
export const VIEW_KINDS: ViewKind[] = ['architecture', 'behavior', 'information', 'validation'];
export const ref = (definition: { id: string; version: string }): string =>
  `${definition.id}@${definition.version}`;
export const uid = (): string => crypto.randomUUID();
export const provenance = (): Provenance => ({ actor: 'local-user', at: new Date().toISOString() });
