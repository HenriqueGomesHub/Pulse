import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { GripVertical, RotateCcw } from 'lucide-react';
import { bounds, edgePath, layoutGraph } from './graph.js';
import { applyLayout, breakpointKey, clearLayout, readLayout, saveNode } from './layout.js';
import { useDesktop } from '../useMedia.js';

const MIN_ZOOM = 0.45;
const MAX_ZOOM = 1.8;
const PADDING = 48;
// Below this the pointer was held still enough to mean "open", not "move".
const DRAG_THRESHOLD = 4;

const clampZoom = (value) => Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, value));
const distance = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);

export default function Canvas({ strategies, activeId }) {
  const desktop = useDesktop();
  const navigate = useNavigate();
  const frameRef = useRef(null);
  const pointers = useRef(new Map());
  const gesture = useRef(null);
  const drag = useRef(null);
  const [view, setView] = useState({ x: 0, y: 0, k: 1 });
  const [panned, setPanned] = useState(false);
  const [layout, setLayout] = useState(readLayout);
  const [dragId, setDragId] = useState(null);

  const graph = useMemo(() => layoutGraph(strategies, desktop), [strategies, desktop]);
  const nodes = useMemo(() => applyLayout(graph.nodes, layout, desktop), [graph, layout, desktop]);
  const byId = useMemo(() => new Map(nodes.map((node) => [node.id, node])), [nodes]);
  const box = useMemo(() => bounds(nodes), [nodes]);
  const rearranged = Object.keys(layout[breakpointKey(desktop)] ?? {}).length > 0;

  const fit = useCallback(() => {
    const frame = frameRef.current;
    if (!frame) return;
    const { width, height } = frame.getBoundingClientRect();
    const graphWidth = box.maxX - box.minX;
    const graphHeight = box.maxY - box.minY;
    // Mobile is a tall spine: fitting its full height would shrink the boxes below
    // a thumb-sized target, so only the width is fitted and the spine is panned.
    const k = desktop
      ? clampZoom(Math.min((width - PADDING * 2) / graphWidth, (height - PADDING * 2) / graphHeight, 1))
      : clampZoom(Math.min((width - 32) / graphWidth, 1));
    setView({
      x: (width - graphWidth * k) / 2 - box.minX * k,
      // Mobile starts below the top bar so the root box never sits under the brand.
      y: desktop ? (height - graphHeight * k) / 2 - box.minY * k : 76 - box.minY * k,
      k,
    });
    setPanned(false);
  }, [box, desktop]);

  // Only refit when the layout genuinely changes shape — never while dragging a
  // box, which would yank the canvas out from under the reader's finger.
  useLayoutEffect(() => {
    fit();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [desktop, graph.nodes.length]);

  useEffect(() => {
    const onResize = () => fit();
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, [fit]);

  const pan = (dx, dy) => {
    setView((prev) => ({ ...prev, x: prev.x + dx, y: prev.y + dy }));
    setPanned(true);
  };

  const zoomAt = (factor, clientX, clientY) => {
    const frame = frameRef.current;
    if (!frame) return;
    const rect = frame.getBoundingClientRect();
    const px = clientX - rect.left;
    const py = clientY - rect.top;
    setView((prev) => {
      const k = clampZoom(prev.k * factor);
      const scale = k / prev.k;
      return { k, x: px - (px - prev.x) * scale, y: py - (py - prev.y) * scale };
    });
    setPanned(true);
  };

  const onPointerDown = (event) => {
    if (event.target.closest('.node')) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    pointers.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
    if (pointers.current.size === 2) {
      const [a, b] = [...pointers.current.values()];
      gesture.current = { span: distance(a, b) };
    }
  };

  const onPointerMove = (event) => {
    const previous = pointers.current.get(event.pointerId);
    if (!previous) return;
    const next = { x: event.clientX, y: event.clientY };
    pointers.current.set(event.pointerId, next);

    if (pointers.current.size === 2 && gesture.current) {
      const [a, b] = [...pointers.current.values()];
      const span = distance(a, b);
      if (gesture.current.span > 0) {
        zoomAt(span / gesture.current.span, (a.x + b.x) / 2, (a.y + b.y) / 2);
      }
      gesture.current.span = span;
      return;
    }

    pan(next.x - previous.x, next.y - previous.y);
  };

  const endPointer = (event) => {
    pointers.current.delete(event.pointerId);
    if (pointers.current.size < 2) gesture.current = null;
  };

  const onWheel = (event) => {
    if (event.ctrlKey) {
      zoomAt(Math.exp(-event.deltaY / 220), event.clientX, event.clientY);
      return;
    }
    pan(-event.deltaX, -event.deltaY);
  };

  // --- dragging a box ---

  const onNodePointerDown = (event, node) => {
    event.currentTarget.setPointerCapture(event.pointerId);
    drag.current = {
      id: node.id,
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      originX: node.x,
      originY: node.y,
      exceeded: false,
    };
  };

  const onNodePointerMove = (event) => {
    const state = drag.current;
    if (!state || state.pointerId !== event.pointerId) return;

    const dx = event.clientX - state.startX;
    const dy = event.clientY - state.startY;
    if (!state.exceeded && Math.hypot(dx, dy) < DRAG_THRESHOLD) return;

    state.exceeded = true;
    setDragId(state.id);
    // Screen pixels to canvas units: the layer is scaled, the pointer is not.
    const x = state.originX + dx / view.k;
    const y = state.originY + dy / view.k;
    setLayout((prev) => ({
      ...prev,
      [breakpointKey(desktop)]: { ...prev[breakpointKey(desktop)], [state.id]: [x, y] },
    }));
  };

  const onNodePointerUp = (event, node) => {
    const state = drag.current;
    drag.current = null;
    setDragId(null);
    if (!state || state.pointerId !== event.pointerId) return;

    if (state.exceeded) {
      const moved = byId.get(node.id);
      setLayout(saveNode(desktop, node.id, moved.x, moved.y));
      return;
    }
    // Held still: this was a tap, so open the box.
    navigate(node.route);
  };

  const resetLayout = () => {
    setLayout(clearLayout(desktop));
    // fit() runs against the restored default positions on the next frame.
    requestAnimationFrame(fit);
  };

  const onNodeFocus = (node) => {
    const frame = frameRef.current;
    if (!frame) return;
    const { width, height } = frame.getBoundingClientRect();
    setView((prev) => {
      const left = node.x * prev.k + prev.x;
      const top = node.y * prev.k + prev.y;
      const right = left + node.w * prev.k;
      const bottom = top + node.h * prev.k;
      const margin = 24;
      let { x, y } = prev;
      if (left < margin) x += margin - left;
      if (right > width - margin) x -= right - (width - margin);
      if (top < margin) y += margin - top;
      if (bottom > height - margin) y -= bottom - (height - margin);
      return { ...prev, x, y };
    });
  };

  return (
    <div className="canvas-frame" ref={frameRef}>
      <div
        className="canvas-surface"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={endPointer}
        onPointerCancel={endPointer}
        onWheel={onWheel}
        style={{
          backgroundSize: `${24 * view.k}px ${24 * view.k}px`,
          backgroundPosition: `${view.x}px ${view.y}px`,
        }}
      >
        <div
          className="canvas-layer"
          style={{ transform: `translate(${view.x}px, ${view.y}px) scale(${view.k})` }}
        >
          <svg className="canvas-edges" aria-hidden="true" overflow="visible">
            {graph.edges.map((edge) => {
              const from = byId.get(edge.from);
              const to = byId.get(edge.to);
              if (!from || !to) return null;
              return (
                <path
                  key={`${edge.from}-${edge.to}`}
                  d={edgePath(from, to, graph.axis)}
                  className={activeId === edge.to ? 'edge edge--active' : 'edge'}
                />
              );
            })}
          </svg>

          {nodes.map((node) => {
            const Icon = node.icon;
            return (
              <button
                key={node.id}
                type="button"
                className={[
                  'node',
                  node.root ? 'node--root' : '',
                  node.sub ? 'node--sub' : '',
                  activeId === node.id ? 'node--active' : '',
                  dragId === node.id ? 'node--dragging' : '',
                ]
                  .filter(Boolean)
                  .join(' ')}
                style={{ left: node.x, top: node.y, width: node.w, height: node.h }}
                onFocus={() => onNodeFocus(node)}
                onPointerDown={(event) => onNodePointerDown(event, node)}
                onPointerMove={onNodePointerMove}
                onPointerUp={(event) => onNodePointerUp(event, node)}
                onPointerCancel={() => {
                  drag.current = null;
                  setDragId(null);
                }}
                onKeyDown={(event) => {
                  if (event.key === 'Enter' || event.key === ' ') {
                    event.preventDefault();
                    navigate(node.route);
                  }
                }}
              >
                {Icon ? (
                  <Icon size={16} strokeWidth={1.5} aria-hidden="true" />
                ) : (
                  <span className="node-dot" aria-hidden="true" />
                )}
                <span className="node-label">{node.label}</span>
                {node.status && node.status !== 'active' ? (
                  <span className="node-flag">{node.status}</span>
                ) : null}
                <GripVertical className="node-grip" size={14} strokeWidth={1.5} aria-hidden="true" />
              </button>
            );
          })}
        </div>
      </div>

      {panned || rearranged ? (
        <button type="button" className="canvas-reset" onClick={rearranged ? resetLayout : fit}>
          <RotateCcw size={14} strokeWidth={1.5} aria-hidden="true" />
          {rearranged ? 'Reset layout' : 'Reset view'}
        </button>
      ) : null}
    </div>
  );
}
