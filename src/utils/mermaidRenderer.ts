import mermaid from 'mermaid';

const COLOR_GROUP_COUNT = 5;
let mermaidInitialized = false;

const DEFAULT_MERMAID_CONFIG = {
  startOnLoad: false,
  theme: 'default' as const,
  themeVariables: {
    primaryColor: '#3b82f6',
    primaryTextColor: '#ffffff',
    primaryBorderColor: '#3b82f6',
    secondaryColor: '#e5e7eb',
    tertiaryColor: '#06b6d4',
    lineColor: '#94a3b8',
    background: '#ffffff',
    textColor: '#1f2937',
    clusterBkg: '#f97316',
    clusterBorder: '#f97316',
    defaultLinkColor: '#94a3b8',
    fontSize: '15px',
  },
  flowchart: {
    useMaxWidth: false,
    htmlLabels: true,
    curve: 'basis' as const,
    nodeSpacing: 60,
    rankSpacing: 80,
    padding: 20,
    defaultRenderer: 'dagre-wrapper' as const,
  },
  securityLevel: 'strict' as const,
  fontFamily: 'DM Sans, Noto Sans SC, Microsoft YaHei, PingFang SC, sans-serif',
};

export function ensureMermaidInitialized(): void {
  if (!mermaidInitialized) {
    mermaid.initialize(DEFAULT_MERMAID_CONFIG);
    mermaidInitialized = true;
  }
}

function isLikelyMermaidSource(source: string): boolean {
  if (!source || source.startsWith('#mermaid-')) return false;
  const normalized = source
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith('%%'))
    .join('\n');

  return /^(flowchart|graph|sequenceDiagram|classDiagram|stateDiagram|erDiagram|journey|gantt|pie|mindmap|timeline|gitGraph|quadrantChart|requirementDiagram|C4Context|C4Container|C4Component|block-beta|architecture-beta|sankey-beta|xychart-beta)\b/.test(
    normalized
  );
}

function extractNodeLabel(raw: string): string {
  if (!raw) return '';
  const cleaned = raw.replace(/^[[({]/, '').replace(/[\])}]$/, '');
  return cleaned.replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').trim();
}

function splitByArrow(segment: string): {left: string; right: string} | null {
  const arrows = ['-->', '-.->', '==>', '--o', '--x', '---'];
  let idx = -1;
  let token = '';
  for (const arrow of arrows) {
    const found = segment.indexOf(arrow);
    if (found !== -1 && (idx === -1 || found < idx)) {
      idx = found;
      token = arrow;
    }
  }
  if (idx === -1) return null;
  return {
    left: segment.slice(0, idx).trim(),
    right: segment.slice(idx + token.length).trim(),
  };
}

function extractIdFromSegment(segment: string): string {
  let value = (segment || '').trim();
  if (value.startsWith('|')) {
    const end = value.indexOf('|', 1);
    if (end !== -1) {
      value = value.slice(end + 1).trim();
    }
  }
  const match = value.match(/^([A-Za-z0-9_]+)/);
  return match ? match[1] : '';
}

function parseNodeInSegment(segment: string, nodes: Map<string, string>): void {
  const idMatch = segment.match(/^([A-Za-z0-9_]+)/);
  if (!idMatch) return;
  const id = idMatch[1];
  const labelMatch = segment.match(/^[A-Za-z0-9_]+\s*[[({]([^\]\)}]*)/);
  if (labelMatch && labelMatch[1]) {
    const label = extractNodeLabel(labelMatch[1]);
    if (label) {
      nodes.set(id, label);
    }
  }
}

function parseMermaidGraph(source: string) {
  const nodes = new Map<string, string>();
  const edges: Array<{from: string; to: string}> = [];
  const allNodeIds = new Set<string>();
  const lines = source.split('\n');

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('%%')) continue;
    const segments = trimmed
      .split(';')
      .map((item) => item.trim())
      .filter(Boolean);

    for (const segment of segments) {
      let remaining = segment;
      let foundEdge = false;

      while (true) {
        const split = splitByArrow(remaining);
        if (!split) break;
        foundEdge = true;

        const from = extractIdFromSegment(split.left);
        const to = extractIdFromSegment(split.right);
        if (from && to) {
          edges.push({from, to});
          allNodeIds.add(from);
          allNodeIds.add(to);
        }

        parseNodeInSegment(split.left, nodes);
        parseNodeInSegment(split.right, nodes);
        remaining = split.right;
      }

      if (!foundEdge) {
        parseNodeInSegment(remaining, nodes);
      }
    }
  }

  nodes.forEach((_, id) => allNodeIds.add(id));
  return {nodes, edges, allNodeIds};
}

function buildColorGroupsFromSource(source: string) {
  const {nodes, edges, allNodeIds} = parseMermaidGraph(source);
  const targetToSources = new Map<string, Set<string>>();
  const sourceToTargets = new Map<string, Set<string>>();

  edges.forEach(({from, to}) => {
    if (!targetToSources.has(to)) targetToSources.set(to, new Set());
    targetToSources.get(to)!.add(from);

    if (!sourceToTargets.has(from)) sourceToTargets.set(from, new Set());
    sourceToTargets.get(from)!.add(to);
  });

  const parentMap = new Map<string, string>();
  const rankMap = new Map<string, number>();
  allNodeIds.forEach((id) => {
    parentMap.set(id, id);
    rankMap.set(id, 0);
  });

  const find = (id: string): string => {
    const p = parentMap.get(id) || id;
    if (p === id) return id;
    const root = find(p);
    parentMap.set(id, root);
    return root;
  };

  const union = (a: string, b: string) => {
    const rootA = find(a);
    const rootB = find(b);
    if (rootA === rootB) return;
    const rankA = rankMap.get(rootA) || 0;
    const rankB = rankMap.get(rootB) || 0;
    if (rankA < rankB) parentMap.set(rootA, rootB);
    else if (rankA > rankB) parentMap.set(rootB, rootA);
    else {
      parentMap.set(rootB, rootA);
      rankMap.set(rootA, rankA + 1);
    }
  };

  const unionAll = (members?: Set<string>) => {
    if (!members || members.size < 2) return;
    const ids = Array.from(members);
    for (let i = 1; i < ids.length; i++) {
      union(ids[0], ids[i]);
    }
  };

  targetToSources.forEach(unionAll);
  sourceToTargets.forEach(unionAll);

  const compMembers = new Map<string, Set<string>>();
  allNodeIds.forEach((id) => {
    const root = find(id);
    if (!compMembers.has(root)) compMembers.set(root, new Set());
    compMembers.get(root)!.add(id);
  });

  const compParents = new Map<string, Set<string>>();
  const compChildren = new Map<string, Set<string>>();
  edges.forEach(({from, to}) => {
    const p = find(from);
    const c = find(to);
    if (p === c) return;
    if (!compParents.has(c)) compParents.set(c, new Set());
    compParents.get(c)!.add(p);
    if (!compChildren.has(p)) compChildren.set(p, new Set());
    compChildren.get(p)!.add(c);
  });

  const compIds = Array.from(compMembers.keys());
  const indegree = new Map(compIds.map((id) => [id, compParents.get(id)?.size || 0]));
  const queue = compIds.filter((id) => (indegree.get(id) || 0) === 0);
  const order: string[] = [];

  while (queue.length) {
    const current = queue.shift()!;
    order.push(current);
    const children = compChildren.get(current);
    children?.forEach((child) => {
      indegree.set(child, (indegree.get(child) || 0) - 1);
      if (indegree.get(child) === 0) queue.push(child);
    });
  }

  compIds.forEach((id) => {
    if (!order.includes(id)) order.push(id);
  });

  const compGroup = new Map<string, number>();
  let groupIndex = 0;

  const pickGroup = (forbidden: Set<number>) => {
    for (let i = 0; i < COLOR_GROUP_COUNT; i++) {
      const candidate = (groupIndex + i) % COLOR_GROUP_COUNT;
      if (!forbidden.has(candidate)) return candidate;
    }
    return groupIndex % COLOR_GROUP_COUNT;
  };

  order.forEach((comp) => {
    const forbidden = new Set<number>();
    compParents.get(comp)?.forEach((parent) => {
      const g = compGroup.get(parent);
      if (g !== undefined) forbidden.add(g);
    });
    const group = pickGroup(forbidden);
    compGroup.set(comp, group);
    groupIndex = (group + 1) % COLOR_GROUP_COUNT;
  });

  const idToGroup = new Map<string, number>();
  const labelToGroup = new Map<string, number>();
  allNodeIds.forEach((id) => {
    const group = compGroup.get(find(id));
    if (group !== undefined) {
      idToGroup.set(id, group);
      const label = nodes.get(id);
      if (label && !labelToGroup.has(label)) {
        labelToGroup.set(label, group);
      }
    }
  });

  return {idToGroup, labelToGroup};
}

function addDepthClasses(
  diagram: HTMLElement,
  groupInfo: {idToGroup: Map<string, number>; labelToGroup: Map<string, number>}
) {
  const {idToGroup, labelToGroup} = groupInfo;
  if (!idToGroup.size && !labelToGroup.size) return;

  const nodes = diagram.querySelectorAll<HTMLElement>('.node');
  nodes.forEach((node) => {
    const rawId = node.id || '';
    const match = rawId.match(/flowchart-(.+?)-\d+$/);
    const extractedId = match ? match[1] : rawId;
    let group = idToGroup.get(extractedId);

    if (group === undefined) {
      const text = (node.textContent || '').replace(/\s+/g, ' ').trim();
      if (text && labelToGroup.has(text)) {
        group = labelToGroup.get(text);
      }
    }

    if (group !== undefined) {
      for (let i = 0; i < COLOR_GROUP_COUNT; i++) {
        node.classList.remove(`color-group-${i}`);
      }
      node.classList.add(`color-group-${group}`);
    }
  });
}

export async function renderMermaidDiagrams(
  container: HTMLElement,
  isCancelled: () => boolean
): Promise<void> {
  const diagrams = Array.from(container.querySelectorAll<HTMLElement>('.mermaid'));
  if (!diagrams.length) return;
  ensureMermaidInitialized();

  for (const diagram of diagrams) {
    if (isCancelled()) return;
    if (diagram.querySelector('svg')) continue;

    const diagramSource = (diagram.textContent || '').trim();
    if (!isLikelyMermaidSource(diagramSource)) continue;

    try {
      const groupInfo = buildColorGroupsFromSource(diagramSource);
      const id = `mermaid-${Math.random().toString(36).slice(2, 11)}`;
      const {svg} = await mermaid.render(id, diagramSource);
      if (isCancelled()) return;
      diagram.innerHTML = svg;
      addDepthClasses(diagram, groupInfo);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (isCancelled()) return;
      diagram.classList.add('mermaid-error');
      diagram.textContent = '流程图渲染失败: ' + message;
    }
  }
}
