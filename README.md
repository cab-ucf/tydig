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
`https://cxn.pub/app/#<code>`. Share a project with someone's address
(Settings > Share) and send them the invite link that appears under it: they
open it in any browser, create their account, and are editing. The address
alone cannot sign up, so nobody can claim an invitation by guessing it. The page is the editor itself, served statically; it reaches your hub
over [iroh](https://iroh.computer) through irp's wasm client, end-to-end
encrypted, through NAT, so the hub can be a laptop with no open port, domain or
certificate. The code is the hub's address and is unguessable; sign-in and
invitations still decide who gets in. A new code: delete `data/link-seed` and
restart. Links go through n0's US-East relay (`use1-1`), which networks that
block other countries still reach; `TYDIG_LINK_RELAY` picks another region or
your own relay, and the link then names it (`;r=...`). Firefox
is refused by n0's relays (its ECH GREASE): use another browser, or set
`security.tls.ech.grease_probability` to 0 in `about:config`.

The static site deploys from this repo (`.github/workflows/pages.yml`; Settings
> Pages > Source: GitHub Actions). Give it a custom domain of its own: the
editor keeps sign-ins and offline drafts in the browser, so it must not share
an origin with sites run by others (irp's pages at `cab-ucf.github.io`).
This repo's is `cxn.pub`; a fork sets `TYDIG_PAGE` to its own. Whoever controls
that site (its GitHub repo, its DNS) serves the page every link visitor
runs, so it can read what they type and their sign-ins: the same trust you
give any web app's host. A hub that should not rely on it sets `TYDIG_PAGE`
to a copy of `client/dist` it serves itself.

## Templates

A new project starts from one (Projects > the menu beside the name):

- `report`: a pre-registered report whose numbers come from its analysis.
- `nih-r21`, `nih-r03`: an NIH application. Names, aims and letters live
  once in `grant.yaml`; every attachment reads them. `main.typ` holds
  Specific Aims, Research Strategy and References (so citations resolve),
  each flagged in red over its page limit. From the build panel:
  - `all`: each attachment as its own PDF in `out/`, as NIH takes them;
  - `full`: the whole application as one PDF, opened by a checklist, with a
    page marking anything still missing;
  - `budget`: `out/budget.xlsx`, from `budget.yaml` (salaries, effort, rates,
    costs), computed once in Typst for the report, the justification and the
    sheet. Give `budget.yaml` your institution's Excel template and a map of
    its cells, and the numbers go into it, its formulas kept.

  `package.yaml` lists every component the application needs, built here,
  uploaded (biosketches from SciENcv, per person) or entered in NIH's forms.
  The **checklist** button in the bar shows what is here and what is not,
  live, with an upload button where each missing file belongs. Any template
  with a `package.yaml` gets it, so another funder's is a list away.

Add one as a folder in `server/templates/`; `a-b` is `a/` with `a-b/` on top.
Branding is a layer of its own, chosen beside the template: `brand-ucf/`
(black and gold, letterhead on letters from UCF) replaces `lib/brand.typ`.
Another university copies it as `brand-<name>/`. Official logos are their
owners' trademarks, so none ship here: put yours at `assets/brand/logo.svg`
and set `logo` in `lib/brand.typ`.

File > Download gives the sources as a `.tar.gz` (enough to rebuild), or
everything with the PDFs; any file downloads from its row in the tree.

A relative path in Typst starts from the file that names it, not from the
document: `image("figure/sig.svg")` in `lib/letter.typ` reads
`lib/figure/sig.svg`. Write `/figure/sig.svg` to start at the project root,
which is the root for every build.

## Agents (Claude Code and the like)

An agent can be a member, asked for work in the editor:

1. Settings > Share > Agents: add one (say `claude`). Its token is shown once;
   it opens this project only, to read and edit text and to answer.
2. Where Claude Code is installed and the hub is reachable:
   `TYDIG_AGENT_TOKEN=tyd_... just agent <project>`.
3. Write `@claude ...` in a comment on some text, or in the Discussion
   (Alt-M). It edits live, merged with whatever people type meanwhile, and
   answers in the thread. It uses only tydig's tools (`server/agent-mcp.mjs`,
   an MCP server): no shell, no other files. `TYDIG_AGENT_CMD` runs another
   agent instead; the MCP server works in any MCP client.

An agent can also work like any collaborator, on its own copy:

- **Through the git remote**: it clones the project's repo, commits, and
  pushes; the hub pulls on every save (Ctrl-S), on "push now", and every
  5 minutes (`TYDIG_GIT_PUSH_MINUTES`).
- **On the hub's own disk**: run it in `data/<project>/`; each file it writes
  is merged into the live text as it lands (files only, never git there).

Where an agent and a person change the same lines, the person's text wins.

**Ghost suggestions** (Settings): a model on your own machine, through
[Ollama](https://ollama.com), suggests how the line goes on; Tab takes it.
Nothing leaves your computer. `ollama pull qwen2.5-coder:1.5b`, then start it
with `OLLAMA_ORIGINS=<the page's address>` so the page may ask it.

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
  (Settings > Git remote) and it is pushed on every save (Ctrl-S), when
  idle and on shutdown. For a private repo, give the `git@` URL: the hub
  makes a key for that project alone and shows it, with a link to add it
  to the repo as a deploy key (tick write access). The private half stays
  in `data/gitsync/keys/`, out of every build's reach. Accounts are
  `data/auth.db`, copied while the hub is down.
- **Limits.** Each project may hold `TYDIG_QUOTA_MB` (1000) of files. Git
  remotes on the hub's own network (private, loopback, link-local) are
  refused unless `TYDIG_GIT_PRIVATE=1`, e.g. for a campus GitLab.
- **Accounts.** Settings > Delete my account: each project it owns passes to
  an admin, else to the longest-standing member; one nobody else is in is
  deleted with it. Comments keep the name they were written under.
- **Updates.** `git pull && just serve`.

