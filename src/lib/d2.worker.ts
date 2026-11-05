// D2 evaluates code it generates, which the window's CSP rightly forbids. This
// worker is a separate context with its own (empty) CSP and no access to the
// app's commands, so D2 can run here while the window stays locked down.

// The library takes the absence of `window` to mean it is running under Node.
(globalThis as any).window = globalThis;

const engine = import('@terrastruct/d2').then(({ D2 }) => new D2());

self.onmessage = async ({ data: { id, src, themeID } }) => {
  try {
    const d2 = await engine;
    const { diagram, renderOptions } = await d2.compile(src, { options: { layout: 'elk' } });
    const svg = await d2.render(diagram, { ...renderOptions, themeID, pad: 12, noXMLTag: true, salt: `s${id}`, center: true });
    self.postMessage({ id, svg });
  } catch (e) {
    self.postMessage({ id, error: e instanceof Error ? e.message : String(e) });
  }
};
