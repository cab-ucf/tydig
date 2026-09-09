# Design notes: privacy, decentralisation, and where the trust sits

(tydig: Typst, decentralized collaboration with iroh, saved in git. The name
is the architecture: Typst documents, iroh for live peer-to-peer sync between
hubs, git for the durable copy.)

This document explains the choices behind tydig's architecture, and is
deliberately explicit about the tensions between the goals -- private,
self-hosted, decentralised, p2p, post-quantum, and *usable by a colleague who
has never heard of any of this*. Some of those goals genuinely conflict. The
useful thing is to say where, and choose on purpose.

## The central tension

A collaborative writing tool that is *only* a document editor can be fully
end-to-end encrypted: peers exchange CRDT updates over encrypted transport,
no server ever sees plaintext, and there is nothing to subpoena. Several good
tools do exactly that.

This is not only a document editor. The whole point of the pre-registered
report is that **something runs your analysis** -- Python, R, Julia -- and
writes the values the manuscript reads. Something also runs `tinymist` for
completions and diagnostics. Those computations need the plaintext of your
code and data. You can put that computation in exactly two places:

1. **On every collaborator's machine.** Maximum privacy: the network only
   ever carries ciphertext. But then every collaborator needs the whole
   toolchain installed and working -- Python with the right packages, R,
   LaTeX, whatever your recipes call -- and results depend on whose laptop
   ran them. This is precisely the failure mode reproducible-research tooling
   exists to prevent, and precisely the barrier that keeps a co-author from
   contributing a paragraph from a borrowed laptop.
2. **On one machine the collaboration shares.** Everyone gets identical,
   containerised results and a zero-install browser experience. The cost is
   that this machine sees plaintext.

tydig chooses (2), and then works to make that machine as *unprivileged*
as possible. Claiming e2ee while shipping server-side builds would be
marketing, not security.

## What "self-hosted" buys, precisely

The deployment unit is a **hub**: one machine run by a lab, a department, or
one person's homelab. A hub has no dependency on any external service -- no
SaaS, no telemetry, no CDN at runtime, no accounts on someone else's system.
The preview compiler and its fonts are WASM shipped with the app; builds run
in a local rootless container; identity lives in one SQLite file; history is
plain git.

That yields the properties most labs actually need, which are usually
mis-stated as "we need encryption":

- **Jurisdictional and institutional control.** Unpublished results sit on
  hardware your institution owns, under its policies.
- **No third-party access, by construction.** There is no vendor with a
  database to breach, monetise, or hand over. The only operator is you.
- **Survivability.** A project is a git repo with notes. If the hub dies,
  `git clone` is a complete backup, readable without this software.
- **Auditability of authorship even against the hub** -- see below. This is
  the part that would otherwise require trusting the server, and it is the
  gap the post-quantum signatures close.

## Decentralisation at the layer where it matters

"Decentralised" is applied per concern, not as a slogan:

| Concern | Where it lives | Rationale |
|---|---|---|
| Editing / merging | CRDT (Yjs), replicated to every browser, persisted in IndexedDB | No central authority decides merges; concurrent edits converge deterministically. Editing keeps working with the network down. |
| Document history | git, one repo per project | Every clone is a full, independent copy in a format that outlives this app. |
| Authorship | ML-DSA-65 keys held on each device | The claim "this version is mine" needs no server to make or to check. |
| Identity | Federated: each collaborator signs in at their own institution via OIDC | Cross-university work needs no shared account authority. |
| Durability | Any git remote the project's people already have | Storage is the one thing that must be online when nobody is. Delegating it to GitHub/GitLab/Codeberg/a NAS means no tydig server ever has to stay up, and the stored form is a plain git repo. |
| Computation | One hub per collaboration | The deliberate centralisation, for reproducibility (see above). |

The result is that the *durable, meaningful* artefacts -- text, history,
authorship, identity -- are decentralised, while the ephemeral, reproducible
one (a build) is recomputed wherever it is needed. With federation, even the
hub is no longer a single point: a project lives on every hub that has joined
it, and losing one loses nothing.

## Why signatures do the heavy lifting

Session cookies answer "who is talking to the server right now". They cannot
answer "who wrote version X of this paper", which is the question that
matters in a dispute over authorship, priority, or research integrity --
often years later, possibly with the original server long gone.

Device-held ML-DSA signatures over content hashes answer it directly, and
answer it *offline*: given a clone and a public key, anyone can verify that a
specific person's device attested to a specific manuscript state at a
specific time. A dishonest or compromised hub can censor (delete history) but
cannot forge, because it never holds a signing key and the signed hashes
cover content it did not choose. That is a much weaker trust assumption than
"the server's database is telling the truth", and it is achieved without
giving up server-side builds.

Post-quantum rather than classical: the scientific record is long-lived. A
signature asserting priority in 2026 should still be sound when elliptic
curves are not. ML-DSA (FIPS 204) is the NIST standard for exactly this, and
the cost -- ~3.3 kB per signature -- is irrelevant at checkpoint frequency.

## Where p2p fits (and where it does not)

Direct peer-to-peer transport is the right tool for two things this
architecture will want:

1. **Hub-to-hub federation** -- implemented (`server/federation.mjs`). Two
   universities each run a hub; a shared project syncs between them over an
   authenticated, encrypted, NAT-punching iroh connection. CRDT state is
   already conflict-free, so a second replica is not a correctness problem,
   and each institution keeps its data on its own hardware. Generated outputs
   are not synced: each hub recomputes them, so the reproducibility
   guarantee holds per hub rather than being trusted across hubs.
2. **Serverless bulk transfer.** Large datasets and rendered deliverables
   moved by content hash (BLAKE3), without a file server in the middle.

What p2p does *not* solve is the reproducibility problem: peers still need a
common, containerised place to run the analysis, or the numbers in the paper
become a function of whose machine was online. So: p2p between hubs, not
instead of them.

## Usability as a hard constraint

Every security decision here was checked against a specific person: a
co-author who has been sent a link and has fifteen minutes. Consequences:

- Sign-in is their existing institutional account (SSO), or an email and
  password. No key ceremony, no seed phrase, no "back up your identity".
- Signing keys generate silently on first checkpoint. The user-visible
  surface is a `signed` badge in the history panel; the failure mode of a new
  device is "this checkpoint is unsigned", never a locked-out account.
- Merges never surface conflict markers. The CRDT converges, and a "while you
  were away" panel offers one decision per changed file.
- Nothing needs installing. Preview compiles in the browser; the toolchain
  lives in the hub's container image.

The deliberate omission is client-side encryption of project content, which
would force key distribution onto that same fifteen-minute co-author *and*
break server-side analysis. The chosen substitute -- self-host the hub, sign
the record -- keeps the security properties that survive contact with real
users.

## Roadmap, in priority order

1. **DHT discovery** (mainline BitTorrent DHT, as in rustonbsd's
   distributed-topic-tracker): a signed record under the project's public key
   carrying the git remote URL and any live hubs, so a project key alone is
   enough to find a project. Needs a Rust sidecar, and cannot replace the git
   remote for durability since DHT records expire in hours -- git stays the
   permanent record, the DHT only points at it.
2. **Federation awareness**: remote cursors and presence across hubs, and a
   merge path for projects scaffolded independently on two hubs.
3. **Signed comments and review decisions**, extending provenance from "who
   wrote this" to "who approved this" -- the natural substrate for
   auditable internal review.
4. **Per-author attribution inside a checkpoint**, by signing CRDT update
   batches rather than only checkpoint snapshots.
5. **Multiple IdPs per hub** (one per partner institution) with per-provider
   sign-in buttons.
6. **Durable CRDT state** (`@hocuspocus/extension-sqlite`) so keystroke-level
   history survives a restart, not just git checkpoints.
7. **Container digest pinning in provenance**, so an attestation records the
   exact build image that produced the numbers -- closing the loop between
   signed manuscript and reproducible computation.
