import type { RawTool } from "./fetch-tools";
import type { DependencyEdge } from "./analyze";
import { categorizeTools } from "./analyze";
import { writeFile } from "fs/promises";

export interface GraphNode {
  id: string; // tool slug
  name: string;
  description: string;
  toolkit: string;
  category: string;
  inputParams: string[];
  outputParams: string[];
  requiredParams: string[];
}

export interface GraphEdge {
  source: string;
  target: string;
  parameter: string;
  reason: string;
  confidence: number;
  providerRank?: number;
}

export interface GraphData {
  nodes: GraphNode[];
  edges: GraphEdge[];
  categories: { name: string; toolkit: string; count: number }[];
}

function assignCategory(tool: RawTool, categoryMap: Map<string, string>): string {
  return categoryMap.get(tool.slug) || "Other";
}

export async function buildGraph(
  allTools: RawTool[],
  edges: DependencyEdge[]
): Promise<GraphData> {
  console.log("Step 3: Building graph data structure...");

  // Build category assignments
  const getSlug = (t: RawTool) => typeof t.toolkit === "string" ? t.toolkit : t.toolkit?.slug || "";
  const googTools = allTools.filter((t) => getSlug(t) === "googlesuper");
  const ghTools = allTools.filter((t) => getSlug(t) === "github");

  const categoryMap = new Map<string, string>();

  const googCategories = categorizeTools(googTools);
  for (const [cat, tools] of googCategories) {
    for (const tool of tools) {
      categoryMap.set(tool.slug, cat);
    }
  }

  const ghCategories = categorizeTools(ghTools);
  for (const [cat, tools] of ghCategories) {
    for (const tool of tools) {
      categoryMap.set(tool.slug, cat);
    }
  }

  // Only include tools that have at least one edge (to keep the graph manageable)
  const connectedSlugs = new Set<string>();
  for (const edge of edges) {
    connectedSlugs.add(edge.source);
    connectedSlugs.add(edge.target);
  }

  const toolMap = new Map(allTools.map((t) => [t.slug, t]));

  const nodes: GraphNode[] = [];
  for (const slug of connectedSlugs) {
    const tool = toolMap.get(slug);
    if (!tool) continue;

    const toolkitSlug = typeof tool.toolkit === "string" ? tool.toolkit : tool.toolkit?.slug || "";
    nodes.push({
      id: tool.slug,
      name: tool.name || tool.slug,
      description: (tool.description || "").slice(0, 300),
      toolkit: toolkitSlug,
      category: assignCategory(tool, categoryMap),
      inputParams: Object.keys(tool.inputParameters?.properties || {}),
      outputParams: Object.keys(tool.outputParameters?.properties || {}),
      requiredParams: tool.inputParameters?.required || [],
    });
  }

  // Collect unique categories with counts
  const catCounts = new Map<string, { toolkit: string; count: number }>();
  for (const node of nodes) {
    const key = `${node.toolkit}/${node.category}`;
    const existing = catCounts.get(key);
    if (existing) {
      existing.count++;
    } else {
      catCounts.set(key, { toolkit: node.toolkit, count: 1 });
    }
  }

  const categories = Array.from(catCounts.entries()).map(
    ([key, { toolkit, count }]) => ({
      name: key.split("/")[1],
      toolkit,
      count,
    })
  );

  // Map edges to graph edges (only include edges where both nodes exist)
  const nodeIds = new Set(nodes.map((n) => n.id));
  let graphEdges: GraphEdge[] = edges
    .filter((e) => nodeIds.has(e.source) && nodeIds.has(e.target))
    .map((e) => ({
      source: e.source,
      target: e.target,
      parameter: e.parameter,
      reason: e.reason,
      confidence: e.confidence,
      providerRank: e.providerRank,
    }));

  // Detect and remove cycles
  const { acyclicEdges, cyclesRemoved } = detectAndBreakCycles(graphEdges);
  graphEdges = acyclicEdges;

  const graphData: GraphData = {
    nodes,
    edges: graphEdges,
    categories: categories.sort((a, b) => b.count - a.count),
  };

  await writeFile("data/graph.json", JSON.stringify(graphData, null, 2), "utf-8");
  console.log(
    `  Graph: ${graphData.nodes.length} nodes, ${graphData.edges.length} edges, ${graphData.categories.length} categories`
  );
  if (cyclesRemoved > 0) {
    console.log(`  Removed ${cyclesRemoved} edges to break cycles (kept higher-confidence direction)`);
  }

  return graphData;
}

// ─── Cycle Detection ───
// Uses DFS to find cycles. When a cycle is detected, removes the lowest-confidence
// edge in the cycle to break it. This ensures the graph is a valid DAG.

function detectAndBreakCycles(
  edges: GraphEdge[]
): { acyclicEdges: GraphEdge[]; cyclesRemoved: number } {
  console.log("  Detecting cycles...");

  let currentEdges = [...edges];
  let totalRemoved = 0;

  // Iteratively find and break cycles until none remain
  while (true) {
    const cycle = findOneCycle(currentEdges);
    if (!cycle) break;

    // Find the lowest-confidence edge in the cycle to remove
    let weakest: GraphEdge | null = null;
    let weakestIdx = -1;

    for (let i = 0; i < cycle.length; i++) {
      const from = cycle[i];
      const to = cycle[(i + 1) % cycle.length];
      const edgeIdx = currentEdges.findIndex(
        (e) => e.source === from && e.target === to
      );
      if (edgeIdx !== -1) {
        const edge = currentEdges[edgeIdx];
        if (!weakest || edge.confidence < weakest.confidence) {
          weakest = edge;
          weakestIdx = edgeIdx;
        }
      }
    }

    if (weakestIdx !== -1) {
      currentEdges.splice(weakestIdx, 1);
      totalRemoved++;
    } else {
      break; // safety: shouldn't happen
    }
  }

  return { acyclicEdges: currentEdges, cyclesRemoved: totalRemoved };
}

function findOneCycle(edges: GraphEdge[]): string[] | null {
  // Build adjacency list
  const adj = new Map<string, string[]>();
  const allNodes = new Set<string>();
  for (const e of edges) {
    allNodes.add(e.source);
    allNodes.add(e.target);
    if (!adj.has(e.source)) adj.set(e.source, []);
    adj.get(e.source)!.push(e.target);
  }

  const WHITE = 0, GRAY = 1, BLACK = 2;
  const color = new Map<string, number>();
  const parent = new Map<string, string | null>();

  for (const n of allNodes) color.set(n, WHITE);

  for (const start of allNodes) {
    if (color.get(start) !== WHITE) continue;

    // DFS
    const stack: string[] = [start];
    parent.set(start, null);

    while (stack.length > 0) {
      const node = stack[stack.length - 1];

      if (color.get(node) === WHITE) {
        color.set(node, GRAY);
        const neighbors = adj.get(node) || [];
        for (const neighbor of neighbors) {
          if (color.get(neighbor) === GRAY) {
            // Found a cycle — reconstruct it
            const cycle: string[] = [neighbor];
            let curr = node;
            while (curr !== neighbor) {
              cycle.push(curr);
              curr = parent.get(curr)!;
              if (!curr) break;
            }
            cycle.reverse();
            return cycle;
          }
          if (color.get(neighbor) === WHITE) {
            parent.set(neighbor, node);
            stack.push(neighbor);
          }
        }
      } else {
        stack.pop();
        color.set(node, BLACK);
      }
    }
  }

  return null;
}
