// File names carry the version, so the links are filled in from the latest
// release. Without an answer they keep pointing at the releases page.
const LATEST = 'https://api.github.com/repos/icabero/UltimateMD/releases/latest';

function pointAt(link, assets) {
  const pattern = new RegExp(link.dataset.asset);
  const asset = assets.find(({ name }) => pattern.test(name));
  if (asset) link.href = asset.browser_download_url;
}

async function fillLinks() {
  const response = await fetch(LATEST);
  if (!response.ok) return;
  const { assets } = await response.json();
  for (const link of document.querySelectorAll('[data-asset]')) pointAt(link, assets);
}

// Only Windows has a single right answer; the others choose below.
if (navigator.userAgent.includes('Windows')) {
  const hero = document.querySelector('.hero .button.primary');
  hero.dataset.asset = 'x64-setup\\.exe$';
  hero.textContent = 'Descargar para Windows';
}

fillLinks().catch(() => {});
