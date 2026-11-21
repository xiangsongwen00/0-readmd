export declare function injectMermaidExportStyles(svg: SVGSVGElement): void;
/**
 * Render any Mermaid container cleanly at full unclipped scale into a crisp HTMLCanvasElement.
 * Avoids live wrapper clipping, CSS transform cropping, and hidden-frame zero-rect bugs.
 */
export declare function exportMermaidContainerToCanvas(mermaidContainer: HTMLElement, maxSidePx?: number): Promise<HTMLCanvasElement | null>;
export declare function fitAllMermaidToDiagram(root?: ParentNode): void;
export declare function fillAllMermaidToCanvas(root?: ParentNode): void;
export declare function refreshAllMermaidOverlays(root?: ParentNode): void;
export declare function cleanupMermaidZoom(root?: ParentNode): void;
export declare function initMermaidZoom(root?: ParentNode): void;
