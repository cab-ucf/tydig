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

On Linux this makes an account of its own, `tydig` (sudo, once), and runs
everything as it with rootless podman. Your projects and its accounts live in
`/var/lib/tydig/data` (one tydig run as you before is copied there). Nothing
of yours is in reach of it: not your files, not your SSH keys.
`TYDIG_USER=` runs it as you instead (macOS, or no sudo).

## Share it: a link, nothing to install

`just` prints a link (and **Settings > Share** shows it):
`https://cxn.pub/app/#<code>`. Share a project with someone's address
(Settings > Share) and send them the invite link that appears under it: they
open it in any browser, create their account, and are editing. The address
alone cannot sign up, so nobody can claim an invitation by guessing it. The page is the editor itself, served statically; it reaches your hub
over [iroh](https://iroh.computer) through irp's wasm client, end-to-end
encrypted, through NAT, so the hub can be a laptop with no open port, domain or
certificate. The code is the hub's address and is unguessable; sign-in and
invitations still decide who gets in. A new code: delete `link-seed` in the data folder and
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
- `nih-r25-sepa`: an NIH SEPA (R25, PAR-27-077). The Research Education
  Program Plan in the NOFO's eight required parts, its program (setting,
  activities, participants, partners, website) in `grant.yaml`, objectives
  that the Evaluation Plan measures, a detailed budget at 8% F&A, warned in
  red over $250,000 a year or with the PD/PI under 2.0 months.
- `nih-r35-esi`, `nih-r35-established`: an NIGMS MIRA (R35; PAR-27-032 for
  early-stage investigators, PAR-26-121 for the rest and renewals). No
  Specific Aims: the Research Strategy in the NOFO's own headings, the
  program as `directions:` with their share of effort, and the word "aims",
  which withdraws a MIRA, shown red wherever it is written. The budget is
  the request a year (capped at $275,000 or $750,000), with equipment and
  data-sharing costs justified, and the PD/PI's MIRA effort checked (51% or
  45% of research effort).
- `nsf-cmi-goali`: an NSF GOALI to Chemical Measurement and Imaging (NSF
  26-519), in PAPPG 24-1's format: the Project Description with the
  instrument-development and university–industry sections CMI and GOALI
  ask for, Results from Prior NSF Support from `grant.yaml`, the
  GOALI-Industrial PI Confirmation Letter, NSF's one-sentence letters of
  collaboration, a budget in Research.gov's lines, warned over 2 senior
  months or a small-business subaward over a third.

Grey `[prompts]` in the grant templates say what each passage must cover,
from the funder's own instructions, until it is written. Check them against
the current solicitation: they change.

Add one as a folder in `server/templates/`; `a-b` is `a/` with `a-b/` on
top, and every `nih*` and `nsf*` stands on `grant/` (checklist, the whole
application in one PDF, the budget).

**Switching template** (Settings > Project template): an R21 becomes an R03,
a report becomes a grant, a project gains UCF's branding. Each file is
merged three ways, from the old template's version to the new one's into
yours: what the template changes lands, what you wrote stays (yours wins
where both changed the same lines, and you are told where). A file the new
template rewrites stays yours, with the template's beside it
(`main.nih-r21.typ`) for you, or an @agent member, to move your writing
into. Old template files you never changed go. It is one checkpoint, so
History undoes it.
Branding is a layer of its own, chosen beside the template: `brand-ucf/`
(black and gold, letterhead on letters from UCF) replaces `lib/brand.typ`,
and carries UCF's budget workbook: put it at `brand-ucf/docs/budget-template.xlsx`
and map its input cells in `brand-ucf/budget-excel.yaml`. Then `make budget`
fills a copy from `budget.yaml` (the workbook's formulas do the totals), and
`make budget-import` reads a filled-in one (`docs/budget-filled.xlsx`) back
into `budget.yaml`, saying where its totals and tydig's disagree.
Another university copies it as `brand-<name>/`. Official logos are their
owners' trademarks, so none ship here: put yours at `assets/brand/logo.svg`
and set `logo` in `lib/brand.typ`.

**Citations** (the cite button, or Ctrl-Alt-C on selected text): search
PubMed or Crossref, see each paper's authors, venue, year and abstract, and
cite it: its BibTeX comes from Crossref by DOI, the registrar's own record,
into the `.bib`, and `@key` goes into the text. "Suggest for this file"
offers papers for each paragraph that cites nothing. "Check references"
holds every entry in the `.bib` to its published record: a DOI that does not
exist, a title nothing matches (a made-up reference), wrong authors, year or
journal are each named, with the published record one click away.

File > Download gives the sources as a `.tar.gz` (enough to rebuild), or
everything with the PDFs; any file downloads from its row in the tree.

The other way, a `.zip` or `.tar.gz` (made anywhere: a folder you worked on
offline, a colleague's draft): upload or drop it on the tree and tydig
offers to unpack it. Each file in it that differs lands, live, as an edit
everyone sees; nothing it lacks is deleted; the whole is one checkpoint, so
History undoes it. Projects > **from archive** starts a new project from
one. The archive is read in memory: a folder it all sits in is dropped, and
its `.git`, symlinks and paths out of the project are skipped.

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

**A second opinion on the references.** Agents have the Cite panel's tools:
search PubMed and Crossref (and OpenAlex, given a free `OPENALEX_API_KEY`
where the agent runs), cite a paper only from its registrar's record (so it
cannot invent one), and check every reference against its record, with the
sentences that cite it. Ask `@claude check the references`: it searches
each claim several ways (its words, technical or MeSH terms, the opposite
finding, reviews), reads the abstracts, and comments on the sentences where
the collaborators should weigh something: evidence against, a stronger or
newer source, a reference that does not match or does not say what the
sentence claims, a claim with nothing behind it. It comments; it does not
rewrite your text unless asked.

An agent can also work like any collaborator, on its own copy:

- **Through the git remote**: it clones the project's repo, commits, and
  pushes; the hub pulls on every save (Ctrl-S), on "push now", and every
  5 minutes (`TYDIG_GIT_PUSH_MINUTES`).
- **On the hub's own disk**: run it in `<data folder>/<project>/`, as the
  account the hub runs as (`sudo -u tydig`); each file it writes
  is merged into the live text as it lands (files only, never git there).

Where an agent and a person change the same lines, the person's text wins.

**Surprise overlay** (View): every word tinted by how much it surprised a
language model, every sentence underlined by its own surprise, and one click
on the bar's `ppl` readout recolours each sentence by how AI-like it reads
(Fast-DetectGPT's criterion: teal reads human, violet reads AI). Hover a word
for its bits, rank and the model's uncertainty. The model is a
Perplexiscope engine on your own machine
(`just` in its folder serves GPT-2 at `http://localhost:8000`; a GPU box:
`ssh -L 8000:localhost:8000 gpu-box`), so nothing leaves it. Typst files are
scored as the prose they typeset: code, math, citations and markup are left
out. The AI reading is a z-score until the engine is calibrated (`just
calib` there), then a percentage; it is evidence, not a verdict: short,
edited or translated text, and non-native writers, fool such detectors.

**Ghost suggestions** (Settings): a model on your own machine, through
[Ollama](https://ollama.com), suggests how the line goes on; Tab takes it.
Nothing leaves your computer. `ollama pull qwen2.5-coder:1.5b`. Base models
(`…-base`, or coder models, which fill in the middle) continue text best;
chat models like qwen3 are asked raw, not to think, and their repetitions
are dropped. A faint `…` means the model is thinking: keep typing, and if
you type how its answer begins, the rest still appears. It suggests the
rest of the sentence. Ollama answers only
pages it is told to: put `OLLAMA_ORIGINS=<the page's address>` (the page says
which) in Ollama's own environment -- `systemctl edit ollama` and
`Environment="OLLAMA_ORIGINS=..."` for the Linux service, `launchctl setenv`
on a Mac -- and restart it. Typed before `ollama serve` in a shell, it misses
the Ollama already running as a service.

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
- **Builds** run in the build sandbox: 2 CPUs, 2 GB, 180 s each,
  `TYDIG_MAX_BUILDS` at once (2), no capabilities, a read-only system, the
  project folder and nothing else (not even its `.git`). Their network is
  public HTTPS only, through a proxy that refuses the host, the LAN, the
  campus network and cloud metadata; `TYDIG_BUILD_NET=0` cuts it entirely.
- **Isolation.** Three containers, as the `tydig` account: the hub (your
  data; read-only system, no capabilities, SELinux on), the sandbox service
  (the only holder of podman's socket; it starts the build sandbox on one
  project with fixed flags, so a hub broken into still cannot start anything
  else) and the egress proxy. A way out of any container lands in `tydig`,
  which holds nothing else. Git over SSH uses the project's deploy key and
  never yours. `just test-sandbox` checks the sandbox with real podman.
- **Backups.** Everything lives in the data folder (`just doctor` says where). Give each project a git remote
  (Settings > Git remote) and it is pushed on every save (Ctrl-S), when
  idle and on shutdown. For a private repo, give the `git@` URL: the hub
  makes a key for that project alone and shows it, with a link to add it
  to the repo as a deploy key (tick write access). The private half stays
  in `gitsync/keys/` there, out of every build's reach. Accounts are
  `auth.db`, copied while the hub is down.
- **Limits.** Each project may hold `TYDIG_QUOTA_MB` (1000) of files. Git
  remotes on the hub's own network (private, loopback, link-local) are
  refused unless `TYDIG_GIT_PRIVATE=1`, e.g. for a campus GitLab.
- **Accounts.** Settings > Delete my account: each project it owns passes to
  an admin, else to the longest-standing member; one nobody else is in is
  deleted with it. Comments keep the name they were written under.
- **Updates.** `git pull && just serve`.

