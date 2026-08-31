import type { Effect, ProgramNode, Query, Wait } from "./contracts";

export type ExecutableLeaf = Query | Effect | Wait;

export interface ProgramGraphNode {
  semanticId: string;
  kind: ExecutableLeaf["kind"];
  node: ExecutableLeaf;
  conditional: boolean;
  compensationForEffectId?: string;
  ordinal: number;
}

export interface ProgramDependencyEdge {
  from: string;
  to: string;
  source: "explicit" | "sequence" | "compensation";
}

export interface ProgramGraph {
  nodes: Map<string, ProgramGraphNode>;
  edges: ProgramDependencyEdge[];
  entryIds: string[];
  terminalIds: string[];
  allProgramNodes: ProgramNode[];
}

interface VisitResult { entryIds: string[]; terminalIds: string[] }

function unique(values: string[]): string[] {
  return [...new Set(values)];
}

/** Pure structural graph derivation. It does not search, schedule, authorize, or
 * execute a program. FIRST_MATCH cases retain their declared order in the AST; the
 * dependency graph records only possible leaf reachability. */
export function analyzeProgramGraph(root: ProgramNode): ProgramGraph {
  const nodes = new Map<string, ProgramGraphNode>();
  const allProgramNodes: ProgramNode[] = [];
  const edgeMap = new Map<string, ProgramDependencyEdge>();
  let ordinal = 0;

  const addEdge = (from: string, to: string, source: ProgramDependencyEdge["source"]) => {
    const key = `${from}\u0000${to}`;
    const existing = edgeMap.get(key);
    if (!existing || (existing.source !== "explicit" && source === "explicit")) edgeMap.set(key, { from, to, source });
  };

  const addLeaf = (node: ExecutableLeaf, conditional: boolean, compensationForEffectId?: string): VisitResult => {
    nodes.set(node.semanticId, { semanticId: node.semanticId, kind: node.kind, node, conditional, compensationForEffectId, ordinal: ordinal++ });
    for (const dependency of node.dependsOn) addEdge(dependency, node.semanticId, "explicit");
    return { entryIds: [node.semanticId], terminalIds: [node.semanticId] };
  };

  const visit = (node: ProgramNode, conditional = false): VisitResult => {
    allProgramNodes.push(node);
    if (node.kind === "query" || node.kind === "effect" || node.kind === "wait") return addLeaf(node, conditional);
    if (node.kind === "sequence") {
      let entries: string[] = [];
      let terminals: string[] = [];
      node.steps.forEach((step, index) => {
        const current = visit(step, conditional);
        if (index === 0) entries = current.entryIds;
        else for (const from of terminals) for (const to of current.entryIds) addEdge(from, to, "sequence");
        terminals = current.terminalIds;
      });
      return { entryIds: entries, terminalIds: terminals };
    }
    if (node.kind === "parallel") {
      const branches = node.branches.map((branch) => visit(branch, conditional));
      return {
        entryIds: unique(branches.flatMap((branch) => branch.entryIds)),
        terminalIds: unique(branches.flatMap((branch) => branch.terminalIds)),
      };
    }
    if (node.kind === "branch") {
      const alternatives = [
        ...node.cases.map((branchCase) => visit(branchCase.then, true)),
        ...(node.otherwise ? [visit(node.otherwise, true)] : []),
      ];
      return {
        entryIds: unique(alternatives.flatMap((alternative) => alternative.entryIds)),
        terminalIds: unique(alternatives.flatMap((alternative) => alternative.terminalIds)),
      };
    }
    // Compensation is a conditional effect linked to, but never eagerly substituted
    // for, the original effect. Its structural wrapper is not an execution identity.
    allProgramNodes.push(node.effect);
    const result = addLeaf(node.effect, true, node.forEffectId);
    addEdge(node.forEffectId, node.effect.semanticId, "compensation");
    for (const dependency of node.dependsOn) addEdge(dependency, node.effect.semanticId, "explicit");
    return result;
  };

  const boundaries = visit(root);
  return {
    nodes,
    edges: [...edgeMap.values()].sort((left, right) => `${left.from}\u0000${left.to}`.localeCompare(`${right.from}\u0000${right.to}`)),
    entryIds: unique(boundaries.entryIds),
    terminalIds: unique(boundaries.terminalIds),
    allProgramNodes,
  };
}

export function graphCycles(graph: ProgramGraph): string[][] {
  const adjacency = new Map<string, string[]>();
  for (const id of graph.nodes.keys()) adjacency.set(id, []);
  for (const edge of graph.edges) {
    const current = adjacency.get(edge.from);
    if (current && graph.nodes.has(edge.to)) current.push(edge.to);
  }
  for (const values of adjacency.values()) values.sort();

  const visiting = new Set<string>();
  const visited = new Set<string>();
  const stack: string[] = [];
  const cycles: string[][] = [];
  const seenCycles = new Set<string>();

  const walk = (id: string) => {
    if (visited.has(id)) return;
    if (visiting.has(id)) {
      const start = stack.indexOf(id);
      const cycle = [...stack.slice(start), id];
      const key = cycle.join("->");
      if (!seenCycles.has(key)) {
        seenCycles.add(key);
        cycles.push(cycle);
      }
      return;
    }
    visiting.add(id);
    stack.push(id);
    for (const next of adjacency.get(id) ?? []) walk(next);
    stack.pop();
    visiting.delete(id);
    visited.add(id);
  };

  for (const id of [...graph.nodes.keys()].sort()) walk(id);
  return cycles;
}
