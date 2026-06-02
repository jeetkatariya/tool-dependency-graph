import type { GraphData } from "./build-graph";
import { writeFile, mkdir } from "fs/promises";

export async function generateVisualization(graph: GraphData): Promise<void> {
  console.log("Step 4: Generating interactive visualization...");

  await mkdir("output", { recursive: true });

  const html = buildHTML(graph);
  await writeFile("output/dependency-graph.html", html, "utf-8");
  console.log("  Saved to output/dependency-graph.html");
}

function buildHTML(graph: GraphData): string {
  const graphJSON = JSON.stringify(graph);

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Composio Tool Dependency Graph</title>
<script src="https://d3js.org/d3.v7.min.js"></script>
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body {
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
    background: #0d1117;
    color: #c9d1d9;
    overflow: hidden;
    height: 100vh;
  }

  #controls {
    position: fixed;
    top: 0;
    left: 0;
    right: 0;
    z-index: 100;
    background: #161b22;
    border-bottom: 1px solid #30363d;
    padding: 10px 16px;
    display: flex;
    align-items: center;
    gap: 12px;
    flex-wrap: wrap;
  }

  #controls h1 {
    font-size: 16px;
    font-weight: 600;
    color: #e6edf3;
    white-space: nowrap;
  }

  #search {
    padding: 6px 12px;
    background: #0d1117;
    border: 1px solid #30363d;
    border-radius: 6px;
    color: #c9d1d9;
    font-size: 14px;
    width: 250px;
    outline: none;
  }
  #search:focus { border-color: #58a6ff; }

  select {
    padding: 6px 10px;
    background: #0d1117;
    border: 1px solid #30363d;
    border-radius: 6px;
    color: #c9d1d9;
    font-size: 13px;
    outline: none;
  }
  select:focus { border-color: #58a6ff; }

  .stats {
    font-size: 12px;
    color: #8b949e;
    margin-left: auto;
  }

  #graph-container {
    width: 100%;
    height: 100vh;
    padding-top: 50px;
  }

  svg { width: 100%; height: 100%; }

  .link {
    stroke-opacity: 0.3;
    fill: none;
  }
  .link:hover {
    stroke-opacity: 0.8;
  }

  .node circle {
    stroke: #0d1117;
    stroke-width: 1.5;
    cursor: pointer;
  }

  .node text {
    font-size: 9px;
    fill: #8b949e;
    pointer-events: none;
    text-anchor: middle;
  }

  .node.highlighted circle {
    stroke: #f0e68c;
    stroke-width: 3;
  }

  .node.dimmed circle { opacity: 0.15; }
  .node.dimmed text { opacity: 0.1; }
  .link.dimmed { stroke-opacity: 0.03; }
  .link.highlighted { stroke-opacity: 0.9; stroke-width: 2.5; }

  #tooltip {
    position: fixed;
    background: #1c2128;
    border: 1px solid #30363d;
    border-radius: 8px;
    padding: 12px;
    font-size: 13px;
    pointer-events: none;
    display: none;
    max-width: 400px;
    z-index: 200;
    box-shadow: 0 4px 12px rgba(0,0,0,0.4);
  }
  #tooltip .tt-name {
    font-weight: 600;
    color: #e6edf3;
    font-size: 14px;
    margin-bottom: 4px;
  }
  #tooltip .tt-cat {
    font-size: 11px;
    color: #8b949e;
    margin-bottom: 6px;
  }
  #tooltip .tt-desc {
    font-size: 12px;
    color: #c9d1d9;
    margin-bottom: 6px;
    line-height: 1.4;
  }
  #tooltip .tt-params {
    font-size: 11px;
    color: #8b949e;
  }
  #tooltip .tt-params strong { color: #c9d1d9; }

  #legend {
    position: fixed;
    bottom: 12px;
    left: 12px;
    background: #161b22;
    border: 1px solid #30363d;
    border-radius: 8px;
    padding: 10px;
    font-size: 11px;
    z-index: 100;
    max-height: 300px;
    overflow-y: auto;
    min-width: 160px;
  }
  #legend h3 {
    font-size: 12px;
    color: #e6edf3;
    margin-bottom: 6px;
  }
  .legend-item {
    display: flex;
    align-items: center;
    gap: 6px;
    margin: 3px 0;
    cursor: pointer;
  }
  .legend-item:hover { color: #e6edf3; }
  .legend-dot {
    width: 10px;
    height: 10px;
    border-radius: 50%;
    flex-shrink: 0;
  }

  #edge-tooltip {
    position: fixed;
    background: #1c2128;
    border: 1px solid #30363d;
    border-radius: 6px;
    padding: 8px 10px;
    font-size: 12px;
    pointer-events: none;
    display: none;
    z-index: 200;
    max-width: 350px;
    box-shadow: 0 4px 12px rgba(0,0,0,0.4);
  }

  #help-btn {
    background: none;
    border: 1px solid #30363d;
    border-radius: 6px;
    color: #8b949e;
    padding: 4px 10px;
    cursor: pointer;
    font-size: 13px;
  }
  #help-btn:hover { color: #e6edf3; border-color: #58a6ff; }

  #help-panel {
    position: fixed;
    top: 60px;
    right: 12px;
    background: #161b22;
    border: 1px solid #30363d;
    border-radius: 8px;
    padding: 14px;
    font-size: 12px;
    z-index: 150;
    display: none;
    line-height: 1.6;
    max-width: 280px;
  }
  #help-panel strong { color: #e6edf3; }
</style>
</head>
<body>

<div id="controls">
  <h1>Composio Tool Dependencies</h1>
  <input type="text" id="search" placeholder="Search tools..." />
  <select id="toolkit-filter">
    <option value="all">All Toolkits</option>
    <option value="googlesuper">Google Super</option>
    <option value="github">GitHub</option>
  </select>
  <select id="category-filter">
    <option value="all">All Categories</option>
  </select>
  <button id="help-btn">?</button>
  <span class="stats" id="stats"></span>
</div>

<div id="help-panel">
  <strong>Controls</strong><br>
  Scroll: Zoom in/out<br>
  Drag background: Pan<br>
  Drag node: Move it<br>
  Click node: Highlight dependencies<br>
  Click background: Clear highlight<br>
  Search: Filter by tool name<br>
  Double-click: Center on node
</div>

<div id="graph-container">
  <svg id="svg"></svg>
</div>

<div id="tooltip"></div>
<div id="edge-tooltip"></div>
<div id="legend"></div>

<script>
const graphData = ${graphJSON};

// ─── Color scheme ───
const categoryColors = {};
const colorPalettes = {
  googlesuper: [
    '#4285f4','#ea4335','#fbbc04','#34a853','#ff6d01',
    '#46bdc6','#7baaf7','#f07b72','#fdd663','#57bb8a',
    '#ff9e80','#80deea','#a1c2fa','#f4a4a0','#fff176',
    '#a5d6a7'
  ],
  github: [
    '#58a6ff','#bc8cff','#f778ba','#ff7b72','#ffa657',
    '#d2a8ff','#79c0ff','#7ee787','#ffc680','#f0883e',
    '#db61a2','#56d364','#e3b341','#a5d6ff','#ff9bce',
    '#9ecbff'
  ]
};

let gIdx = 0, ghIdx = 0;
graphData.categories.forEach(cat => {
  const key = cat.toolkit + '/' + cat.name;
  if (cat.toolkit === 'googlesuper') {
    categoryColors[key] = colorPalettes.googlesuper[gIdx % colorPalettes.googlesuper.length];
    gIdx++;
  } else {
    categoryColors[key] = colorPalettes.github[ghIdx % colorPalettes.github.length];
    ghIdx++;
  }
});

function getColor(node) {
  return categoryColors[node.toolkit + '/' + node.category] || '#666';
}

// ─── Build D3 data ───
const nodeMap = new Map(graphData.nodes.map(n => [n.id, n]));
const nodes = graphData.nodes.map(n => ({...n}));
const links = graphData.edges
  .filter(e => nodeMap.has(e.source) && nodeMap.has(e.target))
  .map(e => ({...e}));

// ─── Setup SVG ───
const svg = d3.select('#svg');
const width = window.innerWidth;
const height = window.innerHeight - 50;

const g = svg.append('g');

// Arrow marker
svg.append('defs').append('marker')
  .attr('id', 'arrow')
  .attr('viewBox', '0 -5 10 10')
  .attr('refX', 20)
  .attr('refY', 0)
  .attr('markerWidth', 6)
  .attr('markerHeight', 6)
  .attr('orient', 'auto')
  .append('path')
  .attr('d', 'M0,-5L10,0L0,5')
  .attr('fill', '#8b949e');

// Zoom
const zoom = d3.zoom()
  .scaleExtent([0.05, 8])
  .on('zoom', (e) => g.attr('transform', e.transform));
svg.call(zoom);

// ─── Simulation ───
const simulation = d3.forceSimulation(nodes)
  .force('link', d3.forceLink(links).id(d => d.id).distance(120))
  .force('charge', d3.forceManyBody().strength(-200))
  .force('center', d3.forceCenter(width / 2, height / 2))
  .force('collision', d3.forceCollide().radius(20))
  .force('x', d3.forceX(width / 2).strength(0.03))
  .force('y', d3.forceY(height / 2).strength(0.03));

// ─── Draw links ───
const link = g.append('g')
  .selectAll('line')
  .data(links)
  .join('line')
  .attr('class', 'link')
  .attr('stroke', d => d.providerRank === 1 ? '#58a6ff' : '#30363d')
  .attr('stroke-width', d => d.providerRank === 1 ? 1.8 : 1.0)
  .attr('stroke-opacity', d => 0.15 + (d.confidence || 0.5) * 0.5)
  .attr('marker-end', 'url(#arrow)')
  .on('mouseover', (event, d) => {
    const tt = document.getElementById('edge-tooltip');
    const conf = d.confidence != null ? (d.confidence * 100).toFixed(0) + '%' : 'N/A';
    const rank = d.providerRank ? ' (rank #' + d.providerRank + ' provider)' : '';
    tt.innerHTML = '<strong>' + d.source.id + '</strong> → <strong>' + d.target.id + '</strong><br>' +
      'Parameter: <em>' + d.parameter + '</em><br>' +
      'Confidence: ' + conf + rank + '<br>' +
      d.reason;
    tt.style.display = 'block';
    tt.style.left = (event.clientX + 12) + 'px';
    tt.style.top = (event.clientY + 12) + 'px';
  })
  .on('mouseout', () => {
    document.getElementById('edge-tooltip').style.display = 'none';
  });

// ─── Draw nodes ───
const node = g.append('g')
  .selectAll('.node')
  .data(nodes)
  .join('g')
  .attr('class', 'node')
  .call(d3.drag()
    .on('start', dragStarted)
    .on('drag', dragged)
    .on('end', dragEnded));

node.append('circle')
  .attr('r', d => {
    // Size by connection count
    const conns = links.filter(l =>
      (l.source === d || l.source.id === d.id) ||
      (l.target === d || l.target.id === d.id)
    ).length;
    return Math.max(5, Math.min(16, 4 + conns * 0.8));
  })
  .attr('fill', d => getColor(d));

node.append('text')
  .attr('dy', d => {
    const conns = links.filter(l =>
      (l.source === d || l.source.id === d.id) ||
      (l.target === d || l.target.id === d.id)
    ).length;
    return Math.max(5, Math.min(16, 4 + conns * 0.8)) + 12;
  })
  .text(d => {
    // Shorten slug: remove toolkit prefix
    let label = d.id;
    if (label.startsWith('GOOGLESUPER_')) label = label.slice(12);
    else if (label.startsWith('GITHUB_')) label = label.slice(7);
    // Truncate long names
    if (label.length > 25) label = label.slice(0, 22) + '...';
    return label;
  });

// ─── Tooltip ───
node.on('mouseover', (event, d) => {
  const tt = document.getElementById('tooltip');
  const deps = links.filter(l => (l.target === d || l.target.id === d.id));
  const dependents = links.filter(l => (l.source === d || l.source.id === d.id));

  tt.innerHTML = \`
    <div class="tt-name">\${d.id}</div>
    <div class="tt-cat">\${d.toolkit} / \${d.category}</div>
    <div class="tt-desc">\${d.description || 'No description'}</div>
    <div class="tt-params">
      <strong>Required inputs:</strong> \${d.requiredParams.join(', ') || 'none'}<br>
      <strong>Depends on:</strong> \${deps.length} tool(s)<br>
      <strong>Depended on by:</strong> \${dependents.length} tool(s)
    </div>
  \`;
  tt.style.display = 'block';

  // Position tooltip
  const x = event.clientX;
  const y = event.clientY;
  tt.style.left = (x + 15 > window.innerWidth - 420 ? x - 420 : x + 15) + 'px';
  tt.style.top = (y + 15 > window.innerHeight - 200 ? y - 200 : y + 15) + 'px';
})
.on('mouseout', () => {
  document.getElementById('tooltip').style.display = 'none';
})
.on('click', (event, d) => {
  event.stopPropagation();
  highlightConnections(d);
})
.on('dblclick', (event, d) => {
  // Center on node
  const transform = d3.zoomTransform(svg.node());
  const newTransform = d3.zoomIdentity
    .translate(width / 2, height / 2)
    .scale(transform.k)
    .translate(-d.x, -d.y);
  svg.transition().duration(500).call(zoom.transform, newTransform);
});

// Click background to clear
svg.on('click', () => clearHighlight());

// ─── Highlight logic ───
function highlightConnections(d) {
  const connectedIds = new Set();
  connectedIds.add(d.id);

  // Find all directly connected nodes
  links.forEach(l => {
    const srcId = l.source.id || l.source;
    const tgtId = l.target.id || l.target;
    if (srcId === d.id) connectedIds.add(tgtId);
    if (tgtId === d.id) connectedIds.add(srcId);
  });

  node.classed('highlighted', n => n.id === d.id);
  node.classed('dimmed', n => !connectedIds.has(n.id));

  link.classed('highlighted', l => {
    const srcId = l.source.id || l.source;
    const tgtId = l.target.id || l.target;
    return srcId === d.id || tgtId === d.id;
  });
  link.classed('dimmed', l => {
    const srcId = l.source.id || l.source;
    const tgtId = l.target.id || l.target;
    return srcId !== d.id && tgtId !== d.id;
  });
}

function clearHighlight() {
  node.classed('highlighted', false).classed('dimmed', false);
  link.classed('highlighted', false).classed('dimmed', false);
}

// ─── Simulation tick ───
simulation.on('tick', () => {
  link
    .attr('x1', d => d.source.x)
    .attr('y1', d => d.source.y)
    .attr('x2', d => d.target.x)
    .attr('y2', d => d.target.y);

  node.attr('transform', d => \`translate(\${d.x},\${d.y})\`);
});

// ─── Drag handlers ───
function dragStarted(event, d) {
  if (!event.active) simulation.alphaTarget(0.3).restart();
  d.fx = d.x;
  d.fy = d.y;
}
function dragged(event, d) {
  d.fx = event.x;
  d.fy = event.y;
}
function dragEnded(event, d) {
  if (!event.active) simulation.alphaTarget(0);
  d.fx = null;
  d.fy = null;
}

// ─── Search ───
document.getElementById('search').addEventListener('input', (e) => {
  const query = e.target.value.toLowerCase();
  if (!query) {
    clearHighlight();
    node.style('display', null);
    link.style('display', null);
    return;
  }

  const matchIds = new Set();
  nodes.forEach(n => {
    if (n.id.toLowerCase().includes(query) || (n.name && n.name.toLowerCase().includes(query))) {
      matchIds.add(n.id);
    }
  });

  // Also show connected nodes
  const expandedIds = new Set(matchIds);
  links.forEach(l => {
    const srcId = l.source.id || l.source;
    const tgtId = l.target.id || l.target;
    if (matchIds.has(srcId)) expandedIds.add(tgtId);
    if (matchIds.has(tgtId)) expandedIds.add(srcId);
  });

  node.classed('dimmed', n => !expandedIds.has(n.id));
  node.classed('highlighted', n => matchIds.has(n.id));

  link.classed('dimmed', l => {
    const srcId = l.source.id || l.source;
    const tgtId = l.target.id || l.target;
    return !matchIds.has(srcId) && !matchIds.has(tgtId);
  });
  link.classed('highlighted', l => {
    const srcId = l.source.id || l.source;
    const tgtId = l.target.id || l.target;
    return matchIds.has(srcId) || matchIds.has(tgtId);
  });
});

// ─── Filters ───
let currentToolkit = 'all';
let currentCategory = 'all';

function applyFilters() {
  const visibleIds = new Set();

  nodes.forEach(n => {
    const toolkitOk = currentToolkit === 'all' || n.toolkit === currentToolkit;
    const catOk = currentCategory === 'all' || n.category === currentCategory;
    if (toolkitOk && catOk) visibleIds.add(n.id);
  });

  node.style('display', n => visibleIds.has(n.id) ? null : 'none');
  link.style('display', l => {
    const srcId = l.source.id || l.source;
    const tgtId = l.target.id || l.target;
    return visibleIds.has(srcId) && visibleIds.has(tgtId) ? null : 'none';
  });

  // Update stats
  const visibleLinks = links.filter(l => {
    const srcId = l.source.id || l.source;
    const tgtId = l.target.id || l.target;
    return visibleIds.has(srcId) && visibleIds.has(tgtId);
  });
  document.getElementById('stats').textContent =
    visibleIds.size + ' nodes, ' + visibleLinks.length + ' edges';
}

document.getElementById('toolkit-filter').addEventListener('change', (e) => {
  currentToolkit = e.target.value;
  // Update category dropdown
  populateCategories();
  currentCategory = 'all';
  document.getElementById('category-filter').value = 'all';
  applyFilters();
});

document.getElementById('category-filter').addEventListener('change', (e) => {
  currentCategory = e.target.value;
  applyFilters();
});

function populateCategories() {
  const catSelect = document.getElementById('category-filter');
  catSelect.innerHTML = '<option value="all">All Categories</option>';

  const cats = new Set();
  graphData.categories.forEach(c => {
    if (currentToolkit === 'all' || c.toolkit === currentToolkit) {
      cats.add(c.name);
    }
  });

  Array.from(cats).sort().forEach(cat => {
    const opt = document.createElement('option');
    opt.value = cat;
    opt.textContent = cat;
    catSelect.appendChild(opt);
  });
}
populateCategories();

// ─── Help toggle ───
document.getElementById('help-btn').addEventListener('click', () => {
  const panel = document.getElementById('help-panel');
  panel.style.display = panel.style.display === 'block' ? 'none' : 'block';
});

// ─── Legend ───
function buildLegend() {
  const legend = document.getElementById('legend');
  let html = '<h3>Categories</h3>';

  const sorted = Object.entries(categoryColors).sort((a, b) => a[0].localeCompare(b[0]));
  sorted.forEach(([key, color]) => {
    const [toolkit, cat] = key.split('/');
    const prefix = toolkit === 'googlesuper' ? 'G' : 'GH';
    html += \`<div class="legend-item" data-cat="\${cat}" data-toolkit="\${toolkit}">
      <span class="legend-dot" style="background:\${color}"></span>
      <span>[\${prefix}] \${cat}</span>
    </div>\`;
  });

  legend.innerHTML = html;

  // Click legend item to filter
  legend.querySelectorAll('.legend-item').forEach(el => {
    el.addEventListener('click', () => {
      const cat = el.dataset.cat;
      const toolkit = el.dataset.toolkit;
      document.getElementById('toolkit-filter').value = toolkit;
      currentToolkit = toolkit;
      populateCategories();
      document.getElementById('category-filter').value = cat;
      currentCategory = cat;
      applyFilters();
    });
  });
}
buildLegend();

// ─── Initial stats ───
document.getElementById('stats').textContent =
  nodes.length + ' nodes, ' + links.length + ' edges';

// ─── Initial zoom to fit ───
setTimeout(() => {
  const bounds = g.node().getBBox();
  if (bounds.width > 0 && bounds.height > 0) {
    const scale = Math.min(
      0.9 * width / bounds.width,
      0.9 * height / bounds.height,
      2
    );
    const tx = width / 2 - scale * (bounds.x + bounds.width / 2);
    const ty = height / 2 - scale * (bounds.y + bounds.height / 2);
    svg.transition().duration(750)
      .call(zoom.transform, d3.zoomIdentity.translate(tx, ty).scale(scale));
  }
}, 2000);
</script>
</body>
</html>`;
}
