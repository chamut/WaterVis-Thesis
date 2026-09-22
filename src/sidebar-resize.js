// One resizing interaction and width limit for all three views.
export function createSidebarResize(workspace, onResize) {
  const handle = document.createElement('button');
  handle.type = 'button';
  handle.className = 'grid-sidebar-resizer';
  handle.setAttribute('aria-label', 'Resize right panel. Arrow keys adjust width; End expands to one third.');
  handle.title = 'Drag to resize · Double-click for one third';
  workspace.append(handle);
  let width = 340;
  let frame;
  const maximum = () => workspace.clientWidth / 3;
  function setWidth(value) {
    const max = maximum();
    width = Math.max(Math.min(280, max), Math.min(max, value));
    workspace.style.setProperty('--sidebar-width', `${width}px`);
    handle.setAttribute('aria-valuetext', `${Math.round(width)} pixels; maximum one third of the workspace`);
    cancelAnimationFrame(frame);
    frame = requestAnimationFrame(onResize);
  }
  handle.addEventListener('pointerdown', event => {
    if (event.button !== 0) return;
    event.preventDefault();
    handle.setPointerCapture(event.pointerId);
  });
  handle.addEventListener('pointermove', event => {
    if (handle.hasPointerCapture(event.pointerId)) setWidth(workspace.getBoundingClientRect().right - event.clientX);
  });
  for (const name of ['pointerup', 'pointercancel']) handle.addEventListener(name, event => {
    if (handle.hasPointerCapture(event.pointerId)) handle.releasePointerCapture(event.pointerId);
  });
  handle.addEventListener('dblclick', () => setWidth(maximum()));
  handle.addEventListener('keydown', event => {
    if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
    event.preventDefault();
    setWidth(event.key === 'End' ? maximum() : event.key === 'Home' ? 280 : width + (event.key === 'ArrowLeft' ? 20 : -20));
  });
  new ResizeObserver(() => setWidth(width)).observe(workspace);
  setWidth(width);
  return { setWidth, expand: () => setWidth(maximum()) };
}
