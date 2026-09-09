# tydig

**Ty**pst, **d**ecentralized collaboration with **i**roh, saved in **g**it.

Self-hosted collaborative Typst environment for lab and multi-institution
paper writing: projects with directories and many files, live preview,
real-time multi-cursor editing, anchored comments with preview pins,
institutional SSO, post-quantum signed checkpoints, and just-driven builds
that compute every number in the manuscript. No external services, no
telemetry; preview fonts embedded in the wasm.

The organising idea is the **pre-registered report**: you write the paper --
including the discussion of every possible outcome -- before the results
exist. Values come from the analysis, and the prose branches on them:

```typst
#let R = json("build/results.json")

The water was found to be
#if R.T1 > R.T2 [cooling] else if R.T1 == R.T2 [constant] else [heating]
when in contact with ambient air (#R.T_ambient degC).
```

No number, direction word, or conclusion is ever typed into the manuscript,
so results cannot drift from the data and cannot be quietly reinterpreted
after the fact. Change the data, rerun the analysis, and the report rewrites
itself -- in every collaborator's live preview.

## Run it

```sh
just
```

That is the whole thing. It checks podman, builds both images, starts the
server, waits for it to answer, and prints the URL --
`http://localhost:8080`. Create an account, create a project, open the build
panel, run `all`.

Then `just logs`, `just down`, `just restart`, `just shell`, and `just help`
for the rest.

### Signing in locally

There is nothing to provision: create an account on the login screen. No
verification email is sent and none is checked, so any address works as long
as it *looks* like an address -- `ada@example.com` is fine, `ada@localhost`
is rejected, because bare hosts fail email validation. The only password rule
is eight characters.

Sessions are cookies, so a second collaborator means a second browser profile
or a private window, not a second tab. Sign up as someone else, then share
the project to that address from Settings. Each profile generates its own
ML-DSA device key, so checkpoints from the two windows carry genuinely
different signatures.

Open the app at the address the server was configured with. The server prints
it on every boot:

```
open the app at: http://localhost:8080  or  http://127.0.0.1:8080
```

`localhost` and `127.0.0.1` are interchangeable (each trusted origin's
loopback twin is trusted too), but a different port or hostname is not, and
sign-in then fails with *Invalid origin* -- a config mismatch, not a bug. The
error names the origin your browser used and what the server trusts, and the
same appears in `just logs`. When it does fire, `just doctor` reports what the running server actually
believes -- its trusted list, whether your origin passes, and when it
started, which also tells you whether it includes your latest changes.

To use a different address (a LAN name, a
reverse proxy, a tunnel), set `TYDIG_URL` and `TYDIG_ORIGINS` to it
and restart:

```sh
echo 'TYDIG_URL=http://lab-box.local:8080'     >> .env
echo 'TYDIG_ORIGINS=http://lab-box.local:8080' >> .env
just restart
```

Wildcards work (`http://localhost:*`), and `TYDIG_ORIGINS='*'` switches
the check off entirely -- reasonable on a single-user machine, not on a shared
hub, since the origin check is what stops another site in your browser from
making authenticated requests to your server.

Two things that look like bugs but are configuration. Trailing slashes and
stray spaces are normalised away now, but the comparison is exact string
equality, so `TYDIG_ORIGINS` must be a bare origin (`http://host:port`)
with no path. And `just dev` serves the client from Vite on `:5173`, not
`:8080`, so it sets its own origins.

Accounts and projects live in `data/` and survive `just down`. To start over,
`rm -rf data`.

The only prerequisite is **rootless podman** with its socket enabled, which
is what lets the server start build sandboxes as sibling containers instead
of nesting them:

```sh
systemctl --user enable --now podman.socket
```

`just up` warns (rather than failing) if the socket is missing: editing,
preview, comments, and checkpoints all still work, but recipe builds will
not, since there is nothing to run them in.

Two images are involved and they do different jobs:

| Image | Built by | Contains | Runs |
|---|---|---|---|
| `tydig` | `Containerfile.server` | Node, git, podman-remote, the built client | the app server, one port |
| `tydig-build` | `sandbox/Containerfile` | typst, make, just, python + numpy/pandas/matplotlib/pooch | one build, then exits |

Versions are `ARG`s, so they are overridable without editing anything:

```sh
podman build -t tydig-build --build-arg TYPST_VERSION=0.14.2 sandbox/
podman build -t tydig -f Containerfile.server --build-arg PODMAN_VERSION=5.8.0 .
```

The server image carries the official statically linked `podman-remote`
client, pinned and sha256-verified at build time (Debian has no
`podman-remote` package, and the full `podman` package would pull in a
container runtime this image never uses -- it only ever talks to the host's
socket).

So the server container never compiles your paper itself; it asks the host's
podman to start a fresh `tydig-build` sandbox per build. Extend
`sandbox/Containerfile` for julia, R, LaTeX, or extra Typst `@preview`
packages (the runtime has no network by default, so the image pre-warms the
package cache). The browser preview compiles via WASM and needs neither
image.

### One port, no reverse proxy

The server serves the client, REST, auth, the sync websocket (`/sync`) and
the LSP bridge (`/lsp`) on a single port, so nothing else is needed for
localhost. Put a TLS-terminating reverse proxy in front for anything beyond
that -- which is also where you get hybrid post-quantum TLS.

### Configuration

Compose reads a `.env` beside `compose.yml`; `just` fills in sensible
defaults for the rest.

| Variable | Default | Notes |
|---|---|---|
| `TYDIG_PORT` | `8080` | host port |
| `TYDIG_URL` | `http://localhost:$PORT` | the public origin; auth cookies and CSRF checks key off it |
| `TYDIG_ORIGINS` | same as `TYDIG_URL` | comma-separated bare origins (`http://host:port`, no path) that may sign in. Each one's loopback twin is added automatically. Wildcards allowed; `*` disables the check |
| `TYDIG_SECRET` | generated into `data/.auth-secret` | set a stable one in production (`just secret`); rotating it invalidates sessions |
| `TYDIG_DATA` | `<repo>/data` | projects, git history, `auth.db`, device keys. Must be **absolute** and is mounted at the same path inside the container, because the server names project paths to the host's podman |
| `TYDIG_BUILD_NET` | `1` | `0` restores `--network=none` for builds (see Security model) |
| `TYDIG_SSO_*` | unset | institutional sign-in; `just sso` prints the set |
| `TYDIG_SYNC_PORT` | `1234` | `0` disables the legacy dedicated sync port (the container sets this) |
| `TYDIG_UNSAFE_BUILDS` | unset | `1` runs recipes on the host with no sandbox; trusted setups only |

State is one directory. `data/` holds a git repo per project plus a single
SQLite file for accounts and registered device keys, so backup is `cp -a` or
`git clone`, and there is nothing else to migrate.

### Without containers

For hacking on the app itself:

```sh
just dev        # vite :5173 with hot reload, proxying to the server on :3000
just test       # all five suites, each against a fresh server and data dir
```

Host `just dev` needs Node 22, and `git`/`podman` on PATH for builds;
`tinymist` on PATH additionally enables LSP completions, hover, diagnostics,
and go-to-definition in the editor.

You can also run a project's recipes with no app at all, which is useful in
CI:

```sh
just paper <project> all
```

## Live preview ('typst watch', everywhere)

The preview is always live and needs no build: every keystroke from any
collaborator recompiles in-browser (WASM), including CSV/data files read by
the document. Builds exist only for things the browser cannot do: running
scripts that generate figures, and producing final PDFs. A server-side
watcher pushes any disk change (a finished build, a shell edit, another
collaborator's build) through the CRDT, so previews refresh for everyone
automatically. The build panel's watch toggle reruns a chosen recipe whenever
data/ or scripts/ change.

## Editor

Vim mode (Settings menu), syntax highlighting via the tree-sitter Typst
grammar compiled to WASM (codemirror-lang-typst; CodeMirror 6 itself is
Lezer-based, this wraps the actual tree-sitter parse), and LSP when tinymist
is on the server PATH: completion dropdowns while typing, hover docs,
diagnostics, go-to-definition. The LSP bridge is ~30 lines: ws JSON messages
reframed to LSP stdio Content-Length framing, one tinymist per connection,
token-gated.

## UI

Menubar (File/Edit/View/Settings/Help) plus always-visible comment/build
buttons and sidebar toggles in the top bar. Left sidebar has two collapsible
sections: projects (switch/create) and files (real directory hierarchy with
expand/collapse, per-folder new-file and upload buttons, drag-and-drop
upload onto folders, rename that preserves comment anchors, delete). Side
panel hosts comments/history/build. Focus mode hides all chrome (floating
exit button for the forgetful). Dark preview (default on; inverts the
rendered page only) with zoom controls (-, fit, +). Dark editor syntax
theme. Fuzzy quick-open, word count, last-opened file remembered per
project, Tab indents, QR invites, client-side PDF export of the preview
(always pin-free).

Shortcuts are registered in the capture phase, so they work while typing in
the editor: Ctrl-P open file, Ctrl-S checkpoint, Alt-N new file, Alt-E
export PDF, Ctrl-Alt-M comment, Alt-1 tree, Alt-2 panel, Alt-0 focus,
Alt-C/H/B comments/history/build. Help > Shortcuts lists them in-app.

## Architecture

| Concern | Tool |
|---|---|
| CRDT, cursors, per-user undo | Yjs + y-codemirror.next (`Y.UndoManager` undoes only your edits) |
| Sync server | Hocuspocus (`onLoad`/`onStore` hooks bridge to disk) |
| Files | Y.Map `files`: path -> Y.Text, mirrored to a real directory tree |
| Binaries and build outputs | disk-only (uploads, `build/`, `figures/`, `out/`), shadow-mapped into the WASM compiler for preview |
| Preview | typst.ts in-browser, multi-file via `addSource`/`mapShadow` |
| Analysis -> prose | `build/results.json` written by a recipe, read by `json()` in Typst; disk watcher bumps `meta.diskRev` so every preview refreshes |
| Serving | one Express port: static client, REST, `/sync` (hocuspocus `handleConnection`), `/lsp` |
| Deployment | `Justfile` + `compose.yml` + `Containerfile.server`; builds delegated to the host's podman via its socket |
| Accounts | better-auth: email+password and/or OIDC SSO (`genericOAuth`), SQLite |
| Durability | any git remote; per-hub CRDT state file so several hubs share one repo conflict-free |
| Federation | `@number0/iroh` endpoint per hub; Yjs state-vector/update exchange over one bidirectional QUIC stream per (project, peer); invite = project token + iroh ticket |
| Provenance | ML-DSA-65 device keys (`@noble/post-quantum`); attestations in `git notes --ref=provenance` |
| Versioning | one git repo per project; autosaves = debounced commits, checkpoints = named `--allow-empty` commits; `out/` gitignored so deliverables stay out of history |
| Builds | `make <target>` in the project dir (or `just <recipe>`); targets listed by parsing the build file, not running it |
| Comments | `Y.RelativePosition` anchors (start assoc 0, end assoc -1 so ranges never creep over newly typed text) |

Restore replays a commit's text files through the CRDT in one transaction:
propagates live to every client, resurrects deleted files, stays undoable.

### Comment pins in the preview

Numbered pins are injected as zero-size `#box(place(...))` markers into a
shadow copy of the source at each anchor, so Typst's own layout engine
positions them: exact across pages and zoom, no coordinate math. They exist
only in the preview compile, never in saved files or exported PDFs.
Injection is parser-verified per comment: the tree-sitter Typst grammar
(already in the browser for highlighting) resolves each anchor's syntax
node, and pins are only injected in markup context. Anchors inside raw
spans, code blocks, math, strings, or comments keep their sidebar entry and
editor highlight but get no pin (dashed number in the sidebar), instead of
leaking literal `#box(...)` text into raw spans or breaking the compile. A
whole-compile pin-less fallback remains as a last resort. Numbers match the
comments sidebar.

### Build pipeline and the analysis contract

New projects scaffold from `server/template/`: a complete pre-registered
report on the thermal relaxation of a water sample, driven by a `Makefile`.

```
data/experiment.csv ──▶ build/data.ok        pinned sha256 per input
        │                    │
        └────────────────────┴──▶ build/results.json  ──┐   one analysis run,
                                  figures/cooling.svg ──┤   grouped target (&:)
                                                        │
main.typ, summary.typ ──────────────────────────────────┴──▶ out/*.pdf
```

`make` is doing real work here, not just sequencing commands: it rebuilds
only what a change actually invalidated. Edit prose and only Typst reruns
(milliseconds). Edit `scripts/analysis.py` or the data and the results,
figures, and both PDFs regenerate. Run `make` twice and the second is a
no-op. The PDFs *depend* on `build/results.json`, so a stale number is
structurally impossible: you cannot produce the report without first
producing the values it reads.

Targets are `all`, `report`, `summary`, `analysis`, `data`, `clean`. The app
discovers them by **reading** the Makefile, never by running it -- `make -p`
expands `$(shell ...)` and `just --summary` evaluates backtick assignments,
so both are code execution just to populate a dropdown. File targets
(`out/report.pdf`) and `.PHONY` lines are filtered out, leaving the verbs a
person would type. Projects with a `justfile` instead of a `Makefile` still
work; `just --summary` then runs in the sandbox.

The contract between analysis and manuscript is exactly one line: *write
`build/results.json`*. Anything can satisfy it -- the template is stdlib-only
Python (upgrading itself to matplotlib when present); swap in
pandas/scipy/julia/R freely. Documents read it with Typst's own `json()`, so
values, conditionals, and whole discussion branches are ordinary Typst code.
`summary.typ` reads the same file as `main.typ`: two documents, one source of
truth, no copy-paste drift.

Provenance runs the other way too: `scripts/fetch_data.py` fails the build on
a hash mismatch, so results can never be computed from silently changed
inputs (swap in `pooch` -- preinstalled in the sandbox image -- for remote
datasets).

`build/`, `figures/`, and `out/` are **build-owned**: they live on disk only
and never enter the CRDT, so a freshly computed `results.json` is never
clobbered by a stale editor replica. They still reach every collaborator's
preview: the compiler's shadow VFS is fed from disk, and the disk watcher
bumps a CRDT revision counter when a build finishes, so previews refresh for
everyone with no clicking. Build outputs appear in the file tree in italic.

Because the analysis is versioned alongside the prose and the checkpoint
signature covers both, a signed checkpoint attests to a specific manuscript
*and* the specific code that produced its numbers.

## Accounts and sharing

Authentication is handled by better-auth (email + password, scrypt-hashed,
secure session cookies, CSRF origin checks). On first visit you sign in or
create an account; identity is consistent across sessions and devices.

Each project is an organization (better-auth's organization plugin). The
creator is the owner; sharing is adding members by email (Settings > Share
project). Every access path is authorized against membership: REST routes,
the sync websocket, the LSP bridge, and raw file reads all reject
non-members (401 without a session, 403 without membership). A user only
sees and can open projects they belong to.

### Institutional SSO (OpenID Connect)

For cross-university and cross-lab use, point the app at an identity
provider your institution already runs -- Keycloak, Authentik, Microsoft
Entra ID, Okta, Google Workspace, or Shibboleth's OIDC plugin -- and people
sign in with their existing institutional account. No config file: four env
vars.

```sh
TYDIG_SSO_DISCOVERY=https://idp.example.edu/.well-known/openid-configuration
TYDIG_SSO_CLIENT_ID=tydig
TYDIG_SSO_CLIENT_SECRET=...
TYDIG_SSO_LABEL="Example University"   # button text
TYDIG_SSO_ONLY=1                       # optional: disable local passwords
```

Register a confidential client at the IdP with redirect URI
`<your-origin>/api/auth/oauth2/callback/sso` (authorization code + PKCE,
scopes `openid profile email`). The login screen shows the SSO button
automatically when discovery is configured, and hides the email form
entirely under `TYDIG_SSO_ONLY=1`; the public `/api/auth-config`
endpoint is what tells it which. Accounts are matched by the email the IdP
asserts, so an existing local account and its projects survive the switch to
SSO. Local email+password remains the zero-config path for a single lab or a
homelab, and both can run side by side.

Multiple IdPs (one per partner institution) is a small change: add more
entries to the `genericOAuth` config array in `server/auth.mjs` and a button
per provider. Cross-institution sharing needs no federation of accounts --
each collaborator signs in wherever they belong and is added to the project
by email.

## Checkpoint provenance (post-quantum signatures)

Sessions prove who is *talking to the server*. They cannot prove, later and
to a third party, who *wrote a given version* of a paper. Checkpoints are
therefore signed on the device, with post-quantum keys.

On first checkpoint the browser generates an **ML-DSA-65** keypair (FIPS 204,
via `@noble/post-quantum`) and registers the public key against your account;
the secret key never leaves the device. Each checkpoint signs a canonical
payload covering the project, the message, the timestamp, and the sha256 of
every text file in the project. The server then verifies three things
independently, and records the attestation in
`git notes --ref=provenance`:

1. the ML-DSA signature is valid for the payload;
2. the signing key is registered to the account making the request;
3. the signed file hashes equal the server's own view of the project.

Only all three passing shows as `signed` in the history panel. The design
consequence is worth stating plainly: because the signature covers file
content the server did not choose, a compromised or dishonest server can
delete history, but it cannot *fabricate* an attributed version of your
manuscript. And because the attestation lives in git notes, anyone can audit
authorship offline from a clone plus the public keys -- no server, no
database.

ML-DSA rather than ed25519 because a scientific record outlives its
cryptography: a signature made today should still mean something after
quantum computers can break elliptic curves. Signatures are ~3.3 kB, kept
off the hot path (checkpoints, not keystrokes). Multiple devices per person
are expected -- each registers its own key, listed via `GET /api/keys`.

For transport, use a reverse proxy with hybrid post-quantum TLS
(X25519MLKEM768, negotiated by default in current Chrome and Firefox); recent
nginx/Caddy/OpenSSL 3.5 builds support it server-side, which gets you PQ
confidentiality on the wire today without touching the app.

## Git remotes: the durable copy, on a host you already have

Federation keeps hubs in sync while they are running. A git remote is what
keeps the project safe when none of them is. Point a project at a repository
on GitHub, GitLab, Codeberg, your institution's GitLab, or a bare repo on a
NAS, and the always-on half of the system becomes an account you already
have -- no tydig server needs to stay up at all.

*Settings > Git remote (durable copy)...* sets the URL. From then on the hub
pushes when the project goes idle (`TYDIG_GIT_PUSH_MINUTES`, default 5)
and again on shutdown, so quitting saves your progress off-machine. To pick
a project up somewhere else -- a new laptop, a rebuilt hub, a collaborator
who has never met your hub -- open the project picker and paste the git URL
instead of a name.

What is pushed:

```
main.typ, scripts/, data/, ...     the working tree, readable and clonable
                                   by anyone on the git host
.collab/crdt/<hub-id>.bin          this hub's CRDT state -- one file per hub
out/, build/, figures/             never pushed; every hub rebuilds these
```

Several hubs can share one remote because no two of them ever write the same
path: each owns exactly one CRDT file, so git merges the union without
asking. The CRDT is authoritative -- after a merge the hub applies every
hub's state to the document (Yjs merges commutatively, so all hubs land on
the same result) and regenerates the working tree from it. A conflict in the
working tree is therefore never fatal; it is resolved by re-deriving the
files. `just test-git` runs two hubs against one bare repo and checks that
concurrent edits on both converge, that a hub can adopt the project from the
remote with no peer online, and that `git clone` alone yields a working
paper.

Credentials stay on the hub. For a private HTTPS repo, put a token in the
URL (`https://user:TOKEN@host/lab/paper.git`); it is stored in
`data/gitsync/<project>.json` with mode 0600, never committed, and shown
redacted in the UI and API. An SSH URL uses the hub's own key instead. The
token is write access to that repository, so use a fine-grained or
project-scoped one.

Pointing an *existing* project at a remote that holds an unrelated history
fails loudly rather than merging two different projects together: create the
project from the git URL instead, which takes the remote's history on
purpose.

### Why this and iroh, rather than one or the other

They solve different halves. iroh gives live, serverless collaboration
between hubs that happen to be up, with no fixed address anywhere. Git gives
durability and revival without needing anyone to be up, on infrastructure
that already exists and is free. Together: work together in real time while
you are both online, and lose nothing when neither of you is.

The remaining gap is discovery. Today a federation invite carries the peer's
iroh ticket, and a git URL is a link you send -- both need one out-of-band
message. The natural fix is a signed record on the BitTorrent mainline DHT,
keyed by the project's public key, carrying both the git URL and whichever
hubs are currently up: then a project key alone would be enough to find the
project, whether or not a peer is online. rustonbsd's
[distributed-topic-tracker](https://github.com/rustonbsd/distributed-topic-tracker)
does exactly this for iroh-gossip (mainline DHT, rotating per-minute
discovery keys, no servers). Two caveats keep it on the roadmap rather than
in the build: it is a Rust crate with no Node bindings, so it needs a small
sidecar process; and DHT records expire in hours without a republisher, so a
DHT entry cannot be the *durable* record -- the git remote has to be, with
the DHT pointing at it. That ordering is the design: git for permanence, DHT
for finding, iroh for talking.

## Federation: hubs syncing peer to peer over iroh

A project does not have to live on one hub. Two or more self-hosted hubs that
each have a project of the same name keep it in sync directly, over
[iroh](https://iroh.computer): QUIC connections dialed by public key, hole
punched through NAT, with n0's public relays as a fallback that only ever
carries ciphertext. No domain, no certificate, no open port, no account with
any service -- a hub on a laptop at home federates with a lab's hub as an
equal, for free. Every connection is end-to-end encrypted and mutually
authenticated by construction, because the endpoint key *is* the TLS
identity.

```
Settings > Federate with another hub...      on the hub that has the project
  -> generate -> copy the invite              tydig-fed:<project>:<token>:<ticket>

Projects > paste a federation invite > join   on the other hub
```

The joining hub starts the project empty and lets sync fill it, so nothing
conflicts. What travels is the project's CRDT document -- every text file and
every comment -- so any number of hubs converge, offline edits included. Each
hub then mirrors to its own disk, commits to its own git, signs its own
checkpoints, and runs its own builds. Generated outputs (`build/`, `figures/`,
`out/`) are deliberately *not* synced: each hub reproduces them from the same
code and data, which is the reproducibility guarantee doing its job. A
freshly joined project therefore previews with "files do not exist yet"
until you run `all` once.

Membership is a capability. The invite carries a per-project random token;
presenting it on connect is what authorises a hub to sync. Anyone holding an
invite can join, so treat it like commit access. Rotating the token (button in
the same dialog) refuses every linked hub until re-invited. Hubs that fall
offline redial with backoff; a project keeps working on whichever hubs are
up, and there is no primary.

Configuration: `TYDIG_IROH=0` turns it off; `TYDIG_IROH_RELAY` is
`n0` (default: free public relays and discovery), `off` (direct connections
only), or `local` (no external services; LAN and tests). The hub's iroh key
lives in `data/iroh.secret`, its current ticket in
`data/federation/hub.json`, and each project's token and linked peers in
`data/federation/<project>.json`.

What federation does *not* do yet: sync awareness (remote cursors across
hubs), or merge two projects that were both scaffolded independently -- files
are keyed by path, so two pre-existing copies of a file conflict rather than
merge, which is why joining starts empty. `server/fedtest.mjs` runs two hubs
on the loopback and checks join-by-invite, edits in both directions landing
on the other hub's disk, replica convergence, and refusal of a bad invite.

## Offline and change review

The whole CRDT is persisted locally via y-indexeddb, so you can keep editing
with no network: changes are saved locally and replay automatically on
reconnect. Because the document is a CRDT, concurrent edits never produce a
git-style conflict; they always merge deterministically with no data loss
(verified: offline-edit + remote-edit + reconnect converges, keeping both).

What a merge cannot tell you is whether you *like* the merged result, so on
reconnect, if files changed remotely while you were away, a "while you were
away" review panel (View > Review changes) shows a per-file line diff with
two one-click choices per file: keep theirs, or revert to your offline
version. No three-way-merge UI, no conflict markers, nothing a first-time
collaborator has to learn.

## Security model

(For the reasoning behind these choices -- and an honest account of where
privacy, reproducibility, and usability pull against each other -- see
`DESIGN.md`.)

Builds execute project Makefiles and justfiles (arbitrary code, by design: it is your
build system) inside rootless podman: 2 GB memory, 512 pids, 2 cpus, all
capabilities dropped, no-new-privileges, read-only rootfs, only the project
directory writable, 3-minute timeout. Network is ON by default: Typst itself
is turing-complete and collaborators already hold full project access, so the
sandbox's job is protecting the host, and network unlocks `pip install`,
package fetches, and data pulls inside recipes. To be precise about the
residual risk: the host's disk is unreachable from the sandbox (read-only
image rootfs, only the project dir mounted), so keys-on-disk are not at
stake. What network adds is reachability of whatever private network the
host sits on. On EC2 that means (a) the instance metadata service at
169.254.169.254, which serves the IAM role credentials attached to the
instance (cloud API access, not disk contents; rootless podman's usermode
networking originates from the host stack, so IMDSv2 hop limits do not
block it), and (b) the VPC: other instances and internal services that
security groups expose to this host but not to the internet. On a homelab
box, substitute your actual LAN. If the instance has no IAM role and the
VPC holds nothing sensitive, network-on costs little. Otherwise set
`TYDIG_BUILD_NET=0` or firewall the metadata range.

Listing targets never executes anything: the build file is parsed as text,
because `make -p` expands `$(shell ...)` and `just --summary` evaluates
backtick assignments -- code execution merely to fill a dropdown. When a
project uses a justfile, that listing runs in the sandbox for the same
reason. `TYDIG_UNSAFE_BUILDS=1` runs builds on the host: fully trusted
setups only.

Access is per-user (see Accounts and sharing above): sessions gate REST, the
sync websocket, and the LSP bridge; project membership gates every
project-scoped route. Set `TYDIG_SECRET` to a stable random value in
production (otherwise one is generated into `data/.auth-secret`), and
`TYDIG_ORIGINS` / `TYDIG_URL` to your real origin so the auth
cookies and CSRF checks line up. Transport is plain http/ws in dev; put one
TLS-terminating reverse proxy in front for anything beyond localhost so
session cookies travel encrypted.

Path handling: charset-validated relative paths, no `..` segments,
hex-validated hashes, `execFile` (no shell).

## API

```
GET  /api/auth-config  (public: is SSO configured?)
GET  /api/me                       GET/POST /api/keys  (device signing keys)
GET  /api/projects                 POST /api/projects/:name (scaffold template)
GET  /api/p/:proj/files            GET/PUT /api/p/:proj/raw/<path>
GET  /api/p/:proj/recipes          POST /api/p/:proj/build/:recipe
POST /api/p/:proj/checkpoint       GET  /api/p/:proj/history
     (optionally signed:                (includes provenance verdicts)
      {payload, publicKey, signature})
POST /api/p/:proj/restore/:hash
```

## Tests

`just test` runs everything below, each suite against a fresh server and a
fresh data directory.

`server/test.mjs`: template load, multi-file
sync, comment-creep regression, disk mirroring, deletion, checkpoint,
multi-file restore, gitignore of outputs, token auth on REST and websocket,
Makefile target discovery (file targets and `.PHONY` correctly excluded),
sandboxed builds, build lock, path traversal guard, disk
watcher CRDT propagation, and an end-to-end LSP bridge test
(`server/lsptest.mjs`: initialize handshake + real tinymist completions).
Last run: ALL PASS. Additional suites: authtest.mjs (sign-up, session
gating, project ownership, non-member 403, invite endpoint), offlinetest.mjs
(offline edit + remote edit + reconnect convergence, diff logic),
fedtest.mjs (two hubs federating one project over iroh), gitsynctest.mjs
(two hubs sharing one git remote), and
provtest.mjs (device-key registration, signed-checkpoint verification,
tampered-payload rejection, cross-account signature replay, file-state
drift, provenance surfaced in history), and singleporttest.mjs (sync over
`/sync` on the main port, static client, SPA fallback not swallowing `/api`,
unauthenticated `/sync` still rejected) all pass. `just test` runs the lot,
each suite against a fresh server and a fresh data directory. The template pipeline is
verified end-to-end against the typst CLI: pinned-hash check, analysis,
figure, and both PDFs compile, with the synthetic experiment's known time
constant recovered by the fit.
The podman invocation itself is exercised in default mode (graceful,
actionable error when the image is absent); end-to-end sandboxed builds were
verified on a host with working rootless podman semantics, as nested podman
cannot run in the CI used here. Pin markup verified against typst CLI (compiles, zero layout
impact).

## Known limits

- Per-keystroke Yjs history lives for server uptime; git is the durable
  store (add `@hocuspocus/extension-sqlite` for durable CRDT state).
- Disk-only files (uploads, outputs) are deleted via shell or a `clean`
  recipe, not the UI.
- Deleting a text file while the server is down resurrects it on next load.
- The browser preview compiles with typst.ts (WASM) while builds use the
  `typst` CLI pinned in `sandbox/Containerfile`; these are different Typst
  versions, so a document relying on very new syntax can preview and build
  differently. The template stays well inside the common subset (verified
  compiling on 0.14.2 and 0.15.1), and the final PDF always comes from the
  build, not the preview.
- Provenance signs checkpoints, not individual keystrokes: per-author
  attribution *within* a checkpoint comes from CRDT authorship metadata,
  which is not signed.
- A single IdP is wired from env; multiple institutional providers means
  adding entries to the `genericOAuth` config array.
- The containerised server delegates builds to the host's podman socket,
  which is a privileged handle: anything that can reach it can start
  containers on the host. It is mounted read-write because starting a build
  requires it. Treat the hub as a single trust domain, and prefer a dedicated
  user (or a rootless socket with a restricted policy) over the socket of an
  account that has anything else to lose.
- `TYDIG_DATA` must be an absolute path that means the same thing inside
  and outside the container, since the server names project paths to the
  host's podman when starting a sandbox. `just` handles this; a hand-written
  `podman run` must too.
- Server-side builds and LSP require the server to see plaintext, so
  "end-to-end encrypted" is not on offer for a hub that computes for you.
  `DESIGN.md` explains this tradeoff, what self-hosting buys instead, and
  why signed checkpoints are what make the server untrusted for authorship.
