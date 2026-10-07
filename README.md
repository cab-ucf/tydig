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

## Production

`just` gives a working hub on localhost. Beyond it:

- **TLS.** Browsers withhold the crypto that signs checkpoints from
  plain-http pages, so use HTTPS. Caddy fetches the certificate itself:
  `caddy reverse-proxy --from paper.lab.edu --to localhost:8080`, then put
  `TYDIG_URL=https://paper.lab.edu` and `TYDIG_TRUST_PROXY=1` in `.env`, and
  keep port 8080 off the public interface.
- **Accounts.** Invite-only: the first account is free, after that sharing a
  project with an address is what lets it sign up (`TYDIG_SIGNUP=open` for a
  trusted LAN). Institutional sign-in: `just sso`. Set `just secret` in
  `.env` before the first sign-up. Forgotten password: `just passwd EMAIL`.
- **Builds** run in the rootless podman sandbox (enable the socket:
  `systemctl --user enable --now podman.socket`): 2 CPUs, 2 GB, 180 s each,
  `TYDIG_MAX_BUILDS` at once (2). `TYDIG_BUILD_NET=0` cuts their network;
  do that on cloud hosts.
- **Backups.** Everything lives in `data/`. Give each project a git remote
  (Settings > Git remote) and it is pushed when idle and on shutdown;
  accounts are `data/auth.db`, copied while the hub is down.
- **Updates.** `git pull && just serve`.

