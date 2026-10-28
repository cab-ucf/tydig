<h1><picture><source media="(prefers-color-scheme: dark)" srcset="client/src/logo/lockup-dark.svg">
<img alt="tydig" src="client/src/logo/lockup-light.svg" height="72"></picture></h1>

**Ty**pst, **d**ecentralized collaboration with **i**roh, saved in **g**it.

```sh
just
```

Needs [podman](https://podman.io). Prints a link: collaborators open it in
any browser, nothing to install. After `just publish`, plain `cxn.pub` opens
this hub; Settings › Share › new code gives three words to say ("cxn.pub, code
tidy ruby otter") that let someone make an account and join the project.
[Docs](https://cxn.pub/docs/).

```typst
#let R = json("build/results.json")
The water was #if R.T1 > R.T2 [cooling] else [heating].
```

- Papers as pre-registered reports: the build computes every number.
- Live preview, multi-cursor editing, comments, offline edits that merge.
- Every project a git repo; post-quantum signed checkpoints.
- Grant templates; journal and poster templates from Typst Universe.
- Citations checked at the source, Word export.
- Agents over MCP, ghost text, a surprise overlay.
- The Discussion mirrored with an [irch](https://github.com/cab-ucf/irch)
  channel, so it reaches phones: Share › irch, with the space's invite.

| where | what |
|---|---|
| `server/` | the hub, a module per feature; `index.mjs` wires them |
| `link/` | the hub's iroh end (Rust): what a link carries |
| `client/` | the editor |
| `templates/` | new projects: report, NIH, NSF, branding |
| `sandbox/` | the build image |
| `scope/` | the surprise engine (Perplexiscope) |
| `test/` | `just test` |

GPL-3.0-or-later.
