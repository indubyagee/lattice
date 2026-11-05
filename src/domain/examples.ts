import { createEntity, createProject, typeRef } from './builtins';
import { provenance, ref, uid, type Project } from './types';
import { assemblyFromSelection } from './assemblies';

/** A synthetic capability-evaluation example, independent of personal projects. */
export function exampleProject(kind: 'development' = 'development'): Project {
  const p = createProject(
    'System Development & Evaluation',
    'Specify a capability, compare it with a baseline, and review an adoption decision.',
  );
  const add = (type: string, name: string, properties: import('./types').JsonObject = {}) => {
    const e = createEntity(typeRef(type), name);
    e.properties = { description: name, ...properties };
    p.entities[e.id] = e;
    return e;
  };
  const relate = (
    type: string,
    source: string,
    target: string,
    properties: import('./types').JsonObject = {},
  ) => {
    const r = {
      id: uid(),
      typeRef: typeRef(type),
      source,
      target,
      properties,
      provenance: provenance(),
    };
    p.relationships[r.id] = r;
    return r;
  };
  const system = add('system', 'Development and Evaluation System');
  const owner = add('human-actor', 'Human owner', {
    instructions: 'Review proposed changes before authorizing implementation.',
    instructionScope: '',
  });
  const agent = add('agent', 'Coordinator');
  const lead = add('role', 'Designer / developer', {
    responsibilities: 'Specify and revise a capability with a documented interface.',
  });
  const reviewer = add('role', 'Evidence reviewer', {
    responsibilities: 'Compare evaluation results with the stated acceptance criteria.',
  });
  relate('fulfills-role', agent.id, lead.id);
  relate('fulfills-role', agent.id, reviewer.id);
  const store = add('memory-store', 'Evaluation evidence store', {
    authority: 'Retain baseline inputs and evaluation results for comparison.',
  });
  relate('reads', reviewer.id, store.id);
  const protocol = add('skill', 'Evidence review protocol', {
    slug: 'evidence-review',
    description: 'Compare capability results with the baseline.',
    body: 'Record the tested version, inputs, expected outputs and observed results. Explain discrepancies and request revision when criteria are unmet.',
  });
  relate('uses-capability', reviewer.id, protocol.id);
  const names = [
    'Frame need',
    'Inspect and select',
    'Specify capability',
    'Establish evaluation',
    'Build or revise',
    'Evaluate',
    'Review',
    'Decide adoption',
    'Monitor',
  ];
  const stages = names.map((name, index) =>
    add(index === names.length - 1 ? 'gate' : 'task', name, {
      inputs: index === 0 ? 'Capability requirements' : `Contract from ${names[index - 1]}`,
      outputs: index === names.length - 1 ? 'Recorded decision' : `Versioned ${name} result`,
      failurePath: 'Return to the preceding stage when its acceptance criteria are unmet.',
    }),
  );
  stages
    .slice(0, -1)
    .forEach((stage, index) =>
      relate(
        index === stages.length - 3 ? 'hands-off-to' : 'precedes',
        stage.id,
        stages[index + 1]!.id,
      ),
    );
  relate('branches-to', stages.at(-2)!.id, stages[2]!.id, {
    condition: 'Review requires a revised specification',
  });
  relate('governed-by', stages.at(-1)!.id, owner.id);
  relate('receives-context', stages.at(-2)!.id, store.id);
  relate('uses-capability', stages.at(-2)!.id, protocol.id);
  const script = add('capability', 'Reuse existing script', {
    implementationKind: 'script',
    invocation: 'Run in the implementation environment; Lattice only specifies the interface.',
  });
  relate('uses-capability', stages[1]!.id, script.id);
  const plan = add('evaluation-plan', 'Comparative evaluation contract', {
    baseline: 'Reference script version and representative input set',
    criteria: 'Compare output correctness and documented failure cases.',
  });
  relate('depends-on', plan.id, script.id);
  relate('depends-on', stages[5]!.id, plan.id);
  const requirement = add('requirement', 'Authorization remains explicit', {
    description: 'An adoption recommendation is separate from activation.',
  });
  const check = add('test-case', 'Inspect decision boundary', {
    description: 'Inspect the exported workflow and authorization contract.',
  });
  relate('checked-by', requirement.id, check.id);
  relate('satisfies', stages.at(-1)!.id, requirement.id);
  for (const e of Object.values(p.entities))
    if (e.id !== system.id) {
      e.systemIds = [system.id];
      relate('contains', system.id, e.id);
    }
  const assembly = assemblyFromSelection(p, [reviewer.id, protocol.id], 'Evidence review');
  assembly.id = 'demo.evidence-review';
  p.assemblies[ref(assembly)] = assembly;
  p.extensions.fixture = { kind, authored: true, synthetic: true };
  return p;
}
