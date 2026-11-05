// D2 evaluates code it generates, which the window's CSP rightly forbids. This
// worker is a separate context with its own (empty) CSP and no access to the
// app's commands, so D2 can run here while the window stays locked down.

// The library takes the absence of `window` to mean it is running under Node.
(globalThis as any).window = globalThis;

const engine = import('@terrastruct/d2').then(({ D2 }) => new D2());

async function render({ id, src, sketch }: { id: number; src: string; sketch: boolean }) {
  try {
    const d2 = await engine;
    const { diagram, renderOptions } = await d2.compile(src, { options: { layout: 'elk' } });
    const svg = await d2.render(diagram, { ...renderOptions, sketch: sketch || renderOptions.sketch, pad: 12, scale: 1, noXMLTag: true, salt: `s${id}`, center: true });
    self.postMessage({ id, svg });
  } catch (e) {
    self.postMessage({ id, error: e instanceof Error ? e.message : String(e) });
  }
}

// The library tracks a single pending call, so a second request would orphan
// the first. A note with several diagrams needs them to run one at a time.
let queue = Promise.resolve();

self.onmessage = ({ data }) => {
  queue = queue.then(() => render(data));
};
