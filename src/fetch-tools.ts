import { Composio } from "@composio/core";
import { existsSync } from "fs";
import { mkdir, readFile, writeFile } from "fs/promises";

export interface RawTool {
  slug: string;
  name: string;
  description: string;
  toolkit: { slug: string; name: string; logo: string };
  tags: string[];
  inputParameters: {
    type?: string;
    properties: Record<string, any>;
    required?: string[];
  };
  outputParameters: {
    type?: string;
    properties: Record<string, any>;
  };
}

const DATA_DIR = "data";

async function fetchToolkit(
  composio: Composio,
  toolkit: string
): Promise<RawTool[]> {
  const cachePath = `${DATA_DIR}/${toolkit}_tools.json`;

  if (existsSync(cachePath)) {
    console.log(`  Loading cached ${toolkit} tools from ${cachePath}`);
    const data = await readFile(cachePath, "utf-8");
    return JSON.parse(data);
  }

  console.log(`  Fetching ${toolkit} tools from Composio API...`);
  const tools = await composio.tools.getRawComposioTools({
    toolkits: [toolkit],
    limit: 1000,
  });

  await mkdir(DATA_DIR, { recursive: true });
  await writeFile(cachePath, JSON.stringify(tools, null, 2), "utf-8");
  console.log(`  Cached ${(tools as any[]).length} ${toolkit} tools to ${cachePath}`);

  return tools as RawTool[];
}

export async function fetchAllTools(): Promise<{
  googlesuper: RawTool[];
  github: RawTool[];
}> {
  console.log("Step 1: Fetching tool data...");
  const composio = new Composio();

  const googlesuper = await fetchToolkit(composio, "googlesuper");
  const github = await fetchToolkit(composio, "github");

  console.log(
    `  Total: ${googlesuper.length} googlesuper + ${github.length} github = ${googlesuper.length + github.length} tools`
  );

  return { googlesuper, github };
}
