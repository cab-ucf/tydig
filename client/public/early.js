// Before the app loads, while it downloads: who is signed in, and the
// preview a member here last saw, from the hub, as an image (nothing in one
// runs) until this browser compiles its own. Its key says what it shows.
// (A link visitor's page waits for the app's own fetches.) Only the hub's
// JSON counts: a static site's 404 or page is no answer, not a sign-out.
const early = new URLSearchParams(location.search).get('proj')
if (!location.hash) self.tydigSession = fetch('/api/auth/get-session')
  .then(r => r.ok ? r.json() : undefined).catch(() => {})
if (early && !location.hash) self.tydigPreview = fetch(`/api/p/${encodeURIComponent(early)}/preview`)
  .then(r => r.status === 200 ? r.text() : null).catch(() => null).then(svg => {
    if (!svg) return null
    const img = new Image(), page = document.getElementById('page')
    img.src = URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml' }))
    if (!page.querySelector('svg')) page.replaceChildren(img)
    return { key: /^<!--(\w+)-->/.exec(svg)?.[1] }
  })
