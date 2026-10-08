# tydig

**Ty**pst, **d**ecentralized collaboration with **i**roh, saved in **g**it.

Self-hosted collaborative Typst environment for lab and multi-institution
paper writing: projects with directories and many files, live preview,
real-time multi-cursor editing, anchored comments with preview pins,
institutional SSO, post-quantum signed checkpoints, and just-driven builds
that compute every number in the manuscript. No external services, no
telemetry; the preview compiles in the browser with Typst's own fonts bundled.

The organising idea is the **pre-registered report**: you write the paper --
including the discussion of every possible outcome -- before the results
exist. Values come from the analysis, and the prose branches on them.

The 'gist' of the idea:

```typst
#let R = json("build/results.json")

The water was found to be
#if R.T1 > R.T2 [cooling] else if R.T1 == R.T2 [constant] else [heating]
when in contact with ambient air (#R.T_ambient degC).
```

## Run it

```sh
just
```

## Share it: a link, nothing to install

`just` prints a link (and **Settings > Share** shows it):
`https://cxn.pub/app/#<code>`. A collaborator opens it in any
browser, creates an account with the address you shared a project to, and is
editing. The page is the editor itself, served statically; it reaches your hub
over [iroh](https://iroh.computer) through irp's wasm client, end-to-end
encrypted, through NAT, so the hub can be a laptop with no open port, domain or
certificate. The code is the hub's address and is unguessable; sign-in and
invitations still decide who gets in. A new code: delete `data/link-seed` and
restart. Firefox is refused by n0's relays (its ECH GREASE): use another
browser, or set `security.tls.ech.grease_probability` to 0 in `about:config`.

The static site deploys from this repo (`.github/workflows/pages.yml`; Settings
> Pages > Source: GitHub Actions). Give it a custom domain of its own: the
editor keeps sign-ins and offline drafts in the browser, so it must not share
an origin with sites run by others (irp's pages at `cab-ucf.github.io`).
This repo's is `cxn.pub`; a fork sets `TYDIG_PAGE` to its own.

## Templates

A new project starts from one (Projects > the menu beside the name):

- `report`: a pre-registered report whose numbers come from its analysis.
- `nih-r21`, `nih-r03`: an NIH application. Names, aims, effort, budget and
  letters live once in `grant.yaml`; every attachment reads them. `main.typ`
  holds Specific Aims, Research Strategy and References (so citations
  resolve), each flagged in red over its page limit; `make` cuts it into
  NIH's separate PDFs, beside the summary, narrative, budget, resources and
  letters, in `out/`.

Add one as a folder in `server/templates/`; `a-b` is `a/` with `a-b/` on top.

A relative path in Typst starts from the file that names it, not from the
document: `image("figure/sig.svg")` in `lib/letter.typ` reads
`lib/figure/sig.svg`. Write `/figure/sig.svg` to start at the project root,
which is the root for every build.

## Production

`just` gives a working hub on localhost. Beyond it:

- **TLS** (only for opening the hub directly; links need none). Browsers withhold the crypto that signs checkpoints from
  plain-http pages, so use HTTPS. Caddy fetches the certificate itself:
  `caddy reverse-proxy --from paper.lab.edu --to localhost:8080`, then put
  `TYDIG_URL=https://paper.lab.edu` and `TYDIG_TRUST_PROXY=1` in `.env`, and
  keep port 8080 off the public interface.
- **Accounts.** Invite-only: the first account is free, after that sharing a
  project with an address is what lets it sign up (`TYDIG_SIGNUP=open` for a
  trusted LAN). Institutional sign-in: `just sso`. Set `just secret` in
  `.env` before the first sign-up. Forgotten password: `just passwd EMAIL`; `just passwd` lists the accounts.
- **Builds** run in the rootless podman sandbox (enable the socket:
  `systemctl --user enable --now podman.socket`): 2 CPUs, 2 GB, 180 s each,
  `TYDIG_MAX_BUILDS` at once (2). `TYDIG_BUILD_NET=0` cuts their network;
  do that on cloud hosts.
- **Backups.** Everything lives in `data/`. Give each project a git remote
  (Settings > Git remote) and it is pushed when idle and on shutdown. An
  `https://` URL can carry a token; a `git@` URL uses the SSH keys in your
  `~/.ssh` (mounted read-only into the hub; `TYDIG_SSH` picks another
  directory), which need no passphrase, so a deploy key is ideal;
  accounts are `data/auth.db`, copied while the hub is down.
- **Updates.** `git pull && just serve`.

