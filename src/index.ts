import { fetchAllTools } from "./fetch-tools";
import { analyzeDependencies } from "./analyze";
import { buildGraph } from "./build-graph";
import { generateVisualization } from "./visualize";

// Load .env
const envFile = Bun.file(".env");
if (await envFile.exists()) {
  const envContent = await envFile.text();
  for (const line of envContent.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eqIdx = trimmed.indexOf("=");
    if (eqIdx === -1) continue;
    const key = trimmed.slice(0, eqIdx);
    const value = trimmed.slice(eqIdx + 1);
    process.env[key] = value;
  }
}

// Validate keys
const composioKey = process.env.COMPOSIO_API_KEY;
const openRouterKey = process.env.OPENROUTER_API_KEY;

if (!composioKey) {
  console.error("Missing COMPOSIO_API_KEY. Run scaffold.sh first.");
  process.exit(1);
}
if (!openRouterKey) {
  console.error("Missing OPENROUTER_API_KEY. Run scaffold.sh first.");
  process.exit(1);
}

console.log("=== Composio Tool Dependency Graph Builder ===\n");

// Step 1: Fetch tools
const { googlesuper, github } = await fetchAllTools();
const allTools = [...googlesuper, ...github];

// Step 2: Analyze dependencies
const edges = await analyzeDependencies(allTools, openRouterKey);

// Step 3: Build graph
const graph = await buildGraph(allTools, edges);

// Step 4: Generate visualization
await generateVisualization(graph);

console.log("\n=== Done! ===");
console.log("Open output/dependency-graph.html in your browser to view the graph.");
