# tydig

**Ty**pst, **d**ecentralized collaboration with **i**roh, saved in **g**it.

```sh
just
```

Needs [podman](https://podman.io). Prints a link: collaborators open it in
any browser, nothing to install. After `just publish`, plain `cxn.pub` opens
this hub; Settings › Share › new code gives three words to say ("cxn.pub, code
tidy ruby otter") that let someone make an account and join the project.
[Docs](https://cab-ucf.github.io/tydig/).

```typst
#let R = json("build/results.json")
The water was #if R.T1 > R.T2 [cooling] else [heating].
```

- Papers as pre-registered reports: the build computes every number.
- Live preview, multi-cursor editing, comments, offline edits that merge.
- Every project a git repo; post-quantum signed checkpoints.
- Grant templates, citations checked at the source, Word export.
- Agents over MCP, ghost text, a surprise overlay.

| where | what |
|---|---|
| `server/` | the hub, a module per feature; `index.mjs` wires them |
| `client/` | the editor |
| `templates/` | new projects: report, NIH, NSF, branding |
| `sandbox/` | the build image |
| `scope/` | the surprise engine (Perplexiscope) |
| `test/` | `just test` |

GPL-3.0-or-later.
