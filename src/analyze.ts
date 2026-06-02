import type { RawTool } from "./fetch-tools";
import { existsSync } from "fs";
import { readFile, writeFile } from "fs/promises";

export interface DependencyEdge {
  source: string; // slug of the tool that must run first (producer)
  target: string; // slug of the tool that depends on it (consumer)
  parameter: string; // the parameter that creates the dependency
  reason: string; // why this dependency exists
  confidence: number; // 0-1 confidence score for provider ranking
  providerRank?: number; // rank among providers for the same (target, parameter) pair (1 = best)
}

// ─── Sub-service categorization ───

const GOOGLE_CATEGORIES: Record<string, string[]> = {
  Gmail: ["GMAIL", "EMAIL", "MAIL", "THREAD", "MESSAGE", "DRAFT", "LABEL"],
  Calendar: ["CALENDAR", "EVENT", "SCHEDULE", "ACL"],
  Drive: ["DRIVE", "FILE", "FOLDER"],
  Sheets: ["SHEET", "SPREADSHEET", "CELL", "ROW", "COLUMN"],
  Docs: ["DOC", "DOCUMENT"],
  Slides: ["SLIDE", "PRESENTATION"],
  Contacts: ["CONTACT", "PEOPLE", "PERSON"],
  Tasks: ["TASK"],
  Meet: ["MEET", "CONFERENCE"],
  Forms: ["FORM"],
  Chat: ["CHAT", "SPACE"],
  Groups: ["GROUP"],
  Admin: ["ADMIN", "USER", "ROLE", "ORG_UNIT"],
  YouTube: ["YOUTUBE", "VIDEO", "CHANNEL", "PLAYLIST", "SUBSCRIPTION"],
};

const GITHUB_CATEGORIES: Record<string, string[]> = {
  Issues: ["ISSUE"],
  "Pull Requests": ["PULL", "REVIEW", "MERGE"],
  Repos: ["REPO", "REPOSITORY", "BRANCH", "TAG", "COMMIT", "TREE", "REF", "GIT"],
  Actions: ["ACTION", "WORKFLOW", "RUN", "JOB", "ARTIFACT"],
  Releases: ["RELEASE", "ASSET"],
  Organizations: ["ORG", "TEAM", "MEMBER"],
  Users: ["USER", "FOLLOW"],
  Gists: ["GIST"],
  Projects: ["PROJECT", "COLUMN", "CARD"],
  Packages: ["PACKAGE"],
  Webhooks: ["WEBHOOK", "HOOK"],
  Codespaces: ["CODESPACE"],
  Discussions: ["DISCUSSION"],
  Pages: ["PAGE"],
  Security: ["SECRET", "SECURITY", "VULNERABILITY", "DEPENDABOT", "CODE_SCANNING"],
};

export function categorizeTools(
  tools: RawTool[]
): Map<string, RawTool[]> {
  const categories = new Map<string, RawTool[]>();
  const isGithub = tools[0]?.toolkit?.slug === "github";
  const catMap = isGithub ? GITHUB_CATEGORIES : GOOGLE_CATEGORIES;

  for (const tool of tools) {
    const slug = tool.slug.toUpperCase();
    let assigned = false;

    for (const [cat, keywords] of Object.entries(catMap)) {
      if (keywords.some((kw) => slug.includes(kw))) {
        if (!categories.has(cat)) categories.set(cat, []);
        categories.get(cat)!.push(tool);
        assigned = true;
        break;
      }
    }

    if (!assigned) {
      const cat = "Other";
      if (!categories.has(cat)) categories.set(cat, []);
      categories.get(cat)!.push(tool);
    }
  }

  return categories;
}

// ─── Helpers ───

function getToolkitSlug(tool: RawTool): string {
  return typeof tool.toolkit === "string" ? tool.toolkit : tool.toolkit?.slug || "";
}

function getInputParams(tool: RawTool): { name: string; description: string; required: boolean }[] {
  const props = tool.inputParameters?.properties;
  if (!props) return [];
  const required = new Set(tool.inputParameters?.required || []);
  return Object.entries(props).map(([name, schema]: [string, any]) => ({
    name,
    description: schema?.description || "",
    required: required.has(name),
  }));
}

// ─── Phase A: Heuristic — Description-based tool references + semantic param matching ───

// Common resource type → param name patterns
const RESOURCE_PARAM_MAP: Record<string, string[]> = {
  thread: ["thread_id"],
  message: ["message_id"],
  draft: ["draft_id"],
  label: ["label_id", "label_ids"],
  calendar: ["calendar_id"],
  event: ["event_id"],
  contact: ["resource_name", "contact_id"],
  file: ["file_id"],
  folder: ["folder_id"],
  spreadsheet: ["spreadsheet_id"],
  sheet: ["sheet_id"],
  document: ["document_id"],
  presentation: ["presentation_id"],
  slide: ["presentation_id"],
  task: ["task_id", "tasklist_id"],
  tasklist: ["tasklist_id"],
  space: ["space_id", "space_name"],
  issue: ["issue_number"],
  pull_request: ["pull_number"],
  repository: ["repo", "owner"],
  branch: ["branch", "ref"],
  release: ["release_id"],
  comment: ["comment_id"],
  review: ["review_id"],
  workflow: ["workflow_id"],
  run: ["run_id"],
  gist: ["gist_id"],
  project: ["project_id"],
  milestone: ["milestone_number"],
  team: ["team_slug", "team_id"],
  hook: ["hook_id"],
};

// Tools that are natural producers for each resource type
const RESOURCE_PRODUCER_PATTERNS: Record<string, string[]> = {
  thread_id: ["LIST_THREADS", "FETCH_EMAILS", "SEND_EMAIL", "SEARCH"],
  message_id: ["LIST_MESSAGES", "FETCH_EMAILS", "SEND_EMAIL", "GET_MESSAGE"],
  draft_id: ["CREATE_DRAFT", "LIST_DRAFTS"],
  label_id: ["LIST_LABELS", "CREATE_LABEL"],
  label_ids: ["LIST_LABELS", "CREATE_LABEL"],
  calendar_id: ["LIST_CALENDARS", "CREATE_CALENDAR"],
  event_id: ["CREATE_EVENT", "LIST_EVENTS", "FIND_EVENT"],
  resource_name: ["LIST_CONTACTS", "SEARCH_PEOPLE", "SEARCH_CONTACTS", "CREATE_CONTACT"],
  contact_id: ["LIST_CONTACTS", "SEARCH_PEOPLE", "CREATE_CONTACT"],
  file_id: ["LIST_FILES", "CREATE_FILE", "UPLOAD", "SEARCH_FILES"],
  folder_id: ["LIST_FILES", "CREATE_FOLDER", "SEARCH_FILES"],
  spreadsheet_id: ["CREATE_SPREADSHEET", "LIST_FILES", "SEARCH_FILES"],
  sheet_id: ["GET_SPREADSHEET", "LIST_SHEETS", "ADD_SHEET"],
  document_id: ["CREATE_DOCUMENT", "LIST_FILES", "SEARCH_FILES"],
  presentation_id: ["CREATE_PRESENTATION", "LIST_FILES"],
  task_id: ["LIST_TASKS", "CREATE_TASK"],
  tasklist_id: ["LIST_TASK_LISTS", "CREATE_TASK_LIST"],
  space_id: ["LIST_SPACES"],
  space_name: ["LIST_SPACES"],
  issue_number: ["CREATE_AN_ISSUE", "LIST_ISSUES", "LIST_REPOSITORY_ISSUES", "SEARCH_ISSUES"],
  pull_number: ["CREATE_A_PULL_REQUEST", "LIST_PULL_REQUESTS"],
  release_id: ["CREATE_A_RELEASE", "LIST_RELEASES", "GET_LATEST_RELEASE"],
  comment_id: ["CREATE_AN_ISSUE_COMMENT", "LIST_ISSUE_COMMENTS", "CREATE_A_REVIEW_COMMENT"],
  review_id: ["CREATE_A_REVIEW", "LIST_REVIEWS"],
  workflow_id: ["LIST_REPOSITORY_WORKFLOWS"],
  run_id: ["LIST_WORKFLOW_RUNS", "CREATE_A_WORKFLOW_DISPATCH"],
  gist_id: ["CREATE_A_GIST", "LIST_GISTS"],
  project_id: ["CREATE_A_PROJECT", "LIST_PROJECTS", "LIST_ORGANIZATION_PROJECTS"],
  milestone_number: ["CREATE_A_MILESTONE", "LIST_MILESTONES"],
  team_slug: ["LIST_TEAMS"],
  team_id: ["LIST_TEAMS"],
  hook_id: ["CREATE_A_REPOSITORY_WEBHOOK", "LIST_REPOSITORY_WEBHOOKS"],
};

function heuristicAnalysis(allTools: RawTool[]): DependencyEdge[] {
  console.log("  Phase A: Heuristic parameter matching...");

  const edges: DependencyEdge[] = [];
  const edgeSet = new Set<string>();

  // Index all tools by slug for quick lookup
  const toolMap = new Map(allTools.map((t) => [t.slug, t]));

  // Strategy 1: Parse input param descriptions for explicit tool references
  for (const consumer of allTools) {
    const inputs = getInputParams(consumer);
    const consumerToolkit = getToolkitSlug(consumer);

    for (const { name: paramName, description: desc, required } of inputs) {
      // Look for explicit tool references in descriptions like "Use GMAIL_LIST_THREADS"
      const toolRefPattern = /(?:use|from|via|using|returned by|obtained from|retrieve.*?(?:from|using|via))\s+(?:the\s+)?([A-Z][A-Z0-9_]+)/gi;
      let match;
      while ((match = toolRefPattern.exec(desc)) !== null) {
        const refSlug = match[1];
        // Try both with and without toolkit prefix
        const candidates = [
          refSlug,
          `GOOGLESUPER_${refSlug}`,
          `GITHUB_${refSlug}`,
        ];

        for (const candidate of candidates) {
          const producer = toolMap.get(candidate);
          if (producer && producer.slug !== consumer.slug && getToolkitSlug(producer) === consumerToolkit) {
            const edgeKey = `${producer.slug}→${consumer.slug}:${paramName}`;
            if (!edgeSet.has(edgeKey)) {
              edgeSet.add(edgeKey);
              edges.push({
                source: producer.slug,
                target: consumer.slug,
                parameter: paramName,
                reason: `${consumer.slug} references ${producer.slug} in its "${paramName}" description`,
                confidence: 0.9, // Explicit tool reference = very high confidence
              });
            }
          }
        }
      }
    }
  }

  console.log(`    Found ${edges.length} edges from description references`);

  // Strategy 2: Match param names to known resource producers
  for (const consumer of allTools) {
    const inputs = getInputParams(consumer);
    const consumerToolkit = getToolkitSlug(consumer);

    for (const { name: paramName, required } of inputs) {
      const lower = paramName.toLowerCase();
      const producerPatterns = RESOURCE_PRODUCER_PATTERNS[lower];
      if (!producerPatterns) continue;

      for (const pattern of producerPatterns) {
        // Find tools matching the pattern within the same toolkit
        for (const [slug, producer] of toolMap) {
          if (getToolkitSlug(producer) !== consumerToolkit) continue;
          if (slug === consumer.slug) continue;
          if (!slug.toUpperCase().includes(pattern)) continue;

          const edgeKey = `${slug}→${consumer.slug}:${paramName}`;
          if (edgeSet.has(edgeKey)) continue;
          edgeSet.add(edgeKey);

          const confidence = computeHeuristicConfidence(producer, consumer, paramName, required);
          edges.push({
            source: slug,
            target: consumer.slug,
            parameter: paramName,
            reason: `${consumer.slug} needs "${paramName}" which ${slug} can provide`,
            confidence,
          });
        }
      }
    }
  }

  console.log(`    Total: ${edges.length} heuristic edges`);
  return edges;
}

function computeHeuristicConfidence(
  producer: RawTool,
  consumer: RawTool,
  inputParam: string,
  isRequired: boolean
): number {
  let score = 0.4; // base score for pattern match

  if (isRequired) score += 0.15;

  // Boost if tools share sub-service context
  const producerParts = producer.slug.toUpperCase().split("_");
  const consumerParts = consumer.slug.toUpperCase().split("_");
  // Skip toolkit prefix (first part)
  const pParts = producerParts.slice(1);
  const cParts = consumerParts.slice(1);
  const sharedPrefix = pParts.filter((p, i) => cParts[i] === p).length;
  if (sharedPrefix >= 1) score += 0.1;

  // Boost if producer is a list/get/create action
  const pSlug = producer.slug.toUpperCase();
  if (pSlug.includes("LIST_") || pSlug.includes("GET_") || pSlug.includes("SEARCH_")) {
    score += 0.1;
  } else if (pSlug.includes("CREATE_")) {
    score += 0.1;
  }

  return Math.max(0.1, Math.min(1.0, score));
}

// ─── Phase B: LLM Semantic Analysis ───

interface LLMDependency {
  consumer: string;
  producer: string;
  parameter: string;
  reason: string;
}

async function callOpenRouter(
  prompt: string,
  apiKey: string
): Promise<string> {
  const response = await fetch(
    "https://openrouter.ai/api/v1/chat/completions",
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "google/gemini-2.5-flash",
        messages: [
          {
            role: "system",
            content: `You are an expert at analyzing API tool dependencies. You identify when one API tool must be called before another to obtain required parameters. You respond ONLY with valid JSON arrays, no markdown fences or explanations.`,
          },
          { role: "user", content: prompt },
        ],
        temperature: 0.1,
        max_tokens: 8192,
      }),
    }
  );

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`OpenRouter API error ${response.status}: ${text}`);
  }

  const data = (await response.json()) as any;
  return data.choices[0].message.content;
}

function buildToolSummary(tool: RawTool): string {
  const inputProps = tool.inputParameters?.properties || {};
  const required = tool.inputParameters?.required || [];
  const inputList = Object.entries(inputProps)
    .map(([name, schema]: [string, any]) => {
      const req = required.includes(name) ? " (REQUIRED)" : "";
      const desc = schema?.description ? `: ${schema.description.slice(0, 150)}` : "";
      return `    - ${name}${req}${desc}`;
    })
    .join("\n");

  return `  ${tool.slug}:
    Description: ${(tool.description || "").slice(0, 250)}
    Inputs:\n${inputList || "    (none)"}`;
}

async function llmAnalyzeBatch(
  tools: RawTool[],
  allToolSlugs: Set<string>,
  categoryName: string,
  apiKey: string
): Promise<LLMDependency[]> {
  const toolSummaries = tools.map(buildToolSummary).join("\n\n");

  const prompt = `Analyze these ${categoryName} API tools and identify dependency relationships.

A dependency exists when Tool B requires a parameter value that can ONLY be obtained by first calling Tool A.

Focus on:
1. ID parameters: Tool B needs an ID (thread_id, message_id, issue_number, etc.) that Tool A returns
2. Resource creation chains: creating something returns an ID needed to modify/interact with it
3. Lookup dependencies: Tool B needs data (email address, user ID, etc.) that Tool A can look up
4. Workflow sequences: operations that logically must happen in order

Do NOT include:
- Generic parameters like "owner" and "repo" that are user-supplied configuration, not from another tool
- Optional convenience dependencies where a user could reasonably supply the value themselves
- Self-dependencies (a tool depending on itself)
- Common user-supplied values like email addresses, names, or text content

Tools:
${toolSummaries}

Return a JSON array of dependency objects. Each object must have:
- "consumer": slug of the tool that needs the parameter (the dependent tool)
- "producer": slug of the tool that produces the required value
- "parameter": the specific parameter name that creates the dependency
- "reason": brief explanation of why this dependency exists

Return ONLY a valid JSON array, no other text. If no dependencies exist, return [].`;

  const responseText = await callOpenRouter(prompt, apiKey);

  try {
    let cleaned = responseText.trim();
    if (cleaned.startsWith("```")) {
      cleaned = cleaned.replace(/^```(?:json)?\n?/, "").replace(/\n?```$/, "");
    }

    const deps = JSON.parse(cleaned) as LLMDependency[];

    return deps.filter(
      (d) =>
        allToolSlugs.has(d.consumer) &&
        allToolSlugs.has(d.producer) &&
        d.consumer !== d.producer
    );
  } catch (e) {
    console.warn(
      `    Warning: Failed to parse LLM response for ${categoryName}:`,
      (e as Error).message
    );
    console.warn(`    Response was: ${responseText.slice(0, 200)}...`);
    return [];
  }
}

async function llmAnalysis(
  allTools: RawTool[],
  apiKey: string
): Promise<DependencyEdge[]> {
  console.log("  Phase B: LLM semantic analysis...");

  const allToolSlugs = new Set(allTools.map((t) => t.slug));
  const edges: DependencyEdge[] = [];

  const googTools = allTools.filter((t) => getToolkitSlug(t) === "googlesuper");
  const ghTools = allTools.filter((t) => getToolkitSlug(t) === "github");

  const googCategories = categorizeTools(googTools);
  const ghCategories = categorizeTools(ghTools);

  const allCategories: [string, RawTool[]][] = [
    ...Array.from(googCategories.entries()).map(
      ([cat, tools]) => [`Google/${cat}`, tools] as [string, RawTool[]]
    ),
    ...Array.from(ghCategories.entries()).map(
      ([cat, tools]) => [`GitHub/${cat}`, tools] as [string, RawTool[]]
    ),
  ];

  // Process categories in batches
  const batches: { name: string; tools: RawTool[] }[] = [];
  const MAX_BATCH_SIZE = 25;

  for (const [catName, catTools] of allCategories) {
    if (catTools.length <= MAX_BATCH_SIZE) {
      batches.push({ name: catName, tools: catTools });
    } else {
      for (let i = 0; i < catTools.length; i += MAX_BATCH_SIZE) {
        const chunk = catTools.slice(i, i + MAX_BATCH_SIZE);
        batches.push({
          name: `${catName} (${Math.floor(i / MAX_BATCH_SIZE) + 1}/${Math.ceil(catTools.length / MAX_BATCH_SIZE)})`,
          tools: chunk,
        });
      }
    }
  }

  console.log(`    Processing ${batches.length} within-category batches...`);

  const CONCURRENCY = 3;
  for (let i = 0; i < batches.length; i += CONCURRENCY) {
    const batchGroup = batches.slice(i, i + CONCURRENCY);
    const results = await Promise.all(
      batchGroup.map(async (batch) => {
        try {
          console.log(
            `    Analyzing ${batch.name} (${batch.tools.length} tools)...`
          );
          return await llmAnalyzeBatch(
            batch.tools,
            allToolSlugs,
            batch.name,
            apiKey
          );
        } catch (e) {
          console.warn(
            `    Warning: Failed to analyze ${batch.name}:`,
            (e as Error).message
          );
          return [];
        }
      })
    );

    for (const deps of results) {
      for (const dep of deps) {
        edges.push({
          source: dep.producer,
          target: dep.consumer,
          parameter: dep.parameter,
          reason: dep.reason,
          confidence: 0.75,
        });
      }
    }
  }

  // Cross-category analysis
  const crossCategoryPairs = [
    {
      name: "Google/Contacts→Gmail",
      tools: [
        ...(googCategories.get("Contacts") || []).slice(0, 10),
        ...(googCategories.get("Gmail") || []).slice(0, 15),
      ],
    },
    {
      name: "Google/Drive→Sheets",
      tools: [
        ...(googCategories.get("Drive") || []).slice(0, 10),
        ...(googCategories.get("Sheets") || []).slice(0, 15),
      ],
    },
    {
      name: "Google/Drive→Docs",
      tools: [
        ...(googCategories.get("Drive") || []).slice(0, 10),
        ...(googCategories.get("Docs") || []).slice(0, 15),
      ],
    },
    {
      name: "Google/Calendar→Meet",
      tools: [
        ...(googCategories.get("Calendar") || []).slice(0, 10),
        ...(googCategories.get("Meet") || []).slice(0, 10),
      ],
    },
    {
      name: "Google/Gmail→Calendar",
      tools: [
        ...(googCategories.get("Gmail") || []).slice(0, 10),
        ...(googCategories.get("Calendar") || []).slice(0, 10),
      ],
    },
    {
      name: "GitHub/Issues→PRs",
      tools: [
        ...(ghCategories.get("Issues") || []).slice(0, 15),
        ...(ghCategories.get("Pull Requests") || []).slice(0, 15),
      ],
    },
    {
      name: "GitHub/Repos→Actions",
      tools: [
        ...(ghCategories.get("Repos") || []).slice(0, 15),
        ...(ghCategories.get("Actions") || []).slice(0, 15),
      ],
    },
    {
      name: "GitHub/Repos→Releases",
      tools: [
        ...(ghCategories.get("Repos") || []).slice(0, 10),
        ...(ghCategories.get("Releases") || []).slice(0, 10),
      ],
    },
    {
      name: "GitHub/Repos→Security",
      tools: [
        ...(ghCategories.get("Repos") || []).slice(0, 10),
        ...(ghCategories.get("Security") || []).slice(0, 10),
      ],
    },
  ];

  console.log(`    Processing ${crossCategoryPairs.length} cross-category batches...`);

  for (let i = 0; i < crossCategoryPairs.length; i += CONCURRENCY) {
    const batchGroup = crossCategoryPairs.slice(i, i + CONCURRENCY);
    const results = await Promise.all(
      batchGroup.map(async (batch) => {
        if (batch.tools.length === 0) return [];
        try {
          console.log(
            `    Cross-analyzing ${batch.name} (${batch.tools.length} tools)...`
          );
          return await llmAnalyzeBatch(
            batch.tools,
            allToolSlugs,
            batch.name,
            apiKey
          );
        } catch (e) {
          console.warn(
            `    Warning: Failed cross-analysis ${batch.name}:`,
            (e as Error).message
          );
          return [];
        }
      })
    );

    for (const deps of results) {
      for (const dep of deps) {
        edges.push({
          source: dep.producer,
          target: dep.consumer,
          parameter: dep.parameter,
          reason: dep.reason,
          confidence: 0.8,
        });
      }
    }
  }

  console.log(`    LLM found ${edges.length} edges`);
  return edges;
}

// ─── Phase C: Merge, Deduplicate & Rank Providers ───

function mergeEdges(
  heuristicEdges: DependencyEdge[],
  llmEdges: DependencyEdge[]
): DependencyEdge[] {
  console.log("  Phase C: Merging and deduplicating edges...");

  const edgeMap = new Map<string, DependencyEdge>();

  for (const edge of llmEdges) {
    const key = `${edge.source}→${edge.target}:${edge.parameter}`;
    if (edgeMap.has(key)) {
      const existing = edgeMap.get(key)!;
      if (edge.confidence > existing.confidence) {
        edgeMap.set(key, edge);
      }
    } else {
      edgeMap.set(key, edge);
    }
  }

  for (const edge of heuristicEdges) {
    const key = `${edge.source}→${edge.target}:${edge.parameter}`;
    if (edgeMap.has(key)) {
      // Boost confidence if both heuristic and LLM agree
      const existing = edgeMap.get(key)!;
      existing.confidence = Math.min(1.0, existing.confidence + 0.1);
    } else {
      edgeMap.set(key, edge);
    }
  }

  const result = Array.from(edgeMap.values());

  rankProviders(result);

  console.log(`    Final: ${result.length} unique edges`);
  return result;
}

function rankProviders(edges: DependencyEdge[]): void {
  console.log("  Phase D: Ranking providers...");

  const groups = new Map<string, DependencyEdge[]>();
  for (const edge of edges) {
    const key = `${edge.target}:${edge.parameter}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(edge);
  }

  let multiProviderCount = 0;
  for (const [, group] of groups) {
    group.sort((a, b) => b.confidence - a.confidence);
    for (let i = 0; i < group.length; i++) {
      group[i].providerRank = i + 1;
    }
    if (group.length > 1) multiProviderCount++;
  }

  console.log(
    `    ${multiProviderCount} parameters have multiple providers (ranked by confidence)`
  );
}

// ─── Main export ───

const EDGES_CACHE = "data/dependency_edges.json";

export async function analyzeDependencies(
  allTools: RawTool[],
  openRouterApiKey: string
): Promise<DependencyEdge[]> {
  console.log("Step 2: Analyzing dependencies...");

  if (existsSync(EDGES_CACHE)) {
    console.log(`  Loading cached edges from ${EDGES_CACHE}`);
    const data = await readFile(EDGES_CACHE, "utf-8");
    return JSON.parse(data);
  }

  const heuristicEdges = heuristicAnalysis(allTools);
  const llmEdges = await llmAnalysis(allTools, openRouterApiKey);
  const merged = mergeEdges(heuristicEdges, llmEdges);

  await writeFile(EDGES_CACHE, JSON.stringify(merged, null, 2), "utf-8");
  console.log(`  Saved ${merged.length} edges to ${EDGES_CACHE}`);

  return merged;
}
