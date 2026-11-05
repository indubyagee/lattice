import ELK from 'elkjs/lib/elk.bundled.js';
import type { LayoutRequest } from '../shared/contracts';
const elk = new ELK();
self.onmessage = async (event: MessageEvent<LayoutRequest>) => {
  try {
    const graph = await elk.layout({
      id: 'root',
      layoutOptions: {
        'elk.algorithm': 'layered',
        'elk.direction': event.data.view === 'behavior' ? 'RIGHT' : 'DOWN',
        'elk.spacing.nodeNode': '65',
        'elk.layered.spacing.nodeNodeBetweenLayers': '90',
      },
      children: event.data.nodes,
      edges: event.data.edges.map((e) => ({ id: e.id, sources: [e.source], targets: [e.target] })),
    });
    self.postMessage({ nodes: graph.children });
  } catch (error) {
    self.postMessage({ error: String(error) });
  }
};
