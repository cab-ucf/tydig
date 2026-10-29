set dotenv-load
# A hub from this checkout. With nixos.nix, NixOS runs this machine's hub
# (the tydig service, in /var/lib/tydig) and these recipes leave it be.
nixos := `systemctl cat tydig.service >/dev/null 2>&1 && echo y || true`
home := if nixos == "y" { "/var/lib/tydig" } else { justfile_directory() }
sudo := if nixos == "y" { "sudo " } else { "" }
export TYDIG_DATA := env("TYDIG_DATA", home / "data")
export TYDIG_PORT := env("TYDIG_PORT", "8080")
export TYDIG_URL := env("TYDIG_URL", "http://localhost:" + TYDIG_PORT)
export TYDIG_REGISTRY := env("TYDIG_REGISTRY", "ghcr.io/cab-ucf") # where CI's images are; empty: build here
export TYDIG_PODMAN_SOCK := env("TYDIG_PODMAN_SOCK", env("XDG_RUNTIME_DIR", "") / "podman/podman.sock")
scope := if env("TYDIG_SCOPE", "") == "1" { "--profile scope" } else { "" }
compose := "podman compose -f " + justfile_directory() / "compose.yml " + scope

# start the hub, then print its link
up: here
    #!/usr/bin/env bash
    mkdir -p "$TYDIG_DATA" && touch .env || exit
    systemctl --user enable --now podman.socket podman-restart.service 2>/dev/null
    # this commit's image from CI, else built here; the running hub stays up meanwhile
    old=$(podman image inspect -f '{{{{.Id}}' localhost/tydig 2>/dev/null)
    img=$TYDIG_REGISTRY/tydig:$(git rev-parse HEAD)-${TYDIG_BRAND:-tydig}-$(podman info -f '{{{{.Host.Arch}}')
    [ -n "$TYDIG_REGISTRY" ] && [ -z "$(git status --porcelain)" ] && podman pull -q "$img" >/dev/null &&
        podman tag "$img" localhost/tydig && podman untag "$img" "$img" || {{compose}} build || exit
    {{compose}} down 2>/dev/null
    ! ss -ltnH "sport = :$TYDIG_PORT" 2>/dev/null | grep -q . ||
        { echo "port $TYDIG_PORT is taken (ss -ltnp): stop it, or set TYDIG_PORT=8090 in .env"; exit 1; }
    {{compose}} up -d || exit
    [ -z "$old" ] || podman rmi "$old" >/dev/null 2>&1 # the image it replaced, unless in use
    for i in $(seq 30); do test -s "$TYDIG_DATA/link" && exec cat "$TYDIG_DATA/link"; sleep 1; done

# a checkout's hub to the commit the link page runs, once main holds it (cron)
update: here
    #!/usr/bin/env bash
    v=$(curl -fsS "${TYDIG_PAGE:-https://cxn.pub/}version") && [[ $v =~ ^[0-9a-f]{40}$ ]] ||
        { echo "update: no version at ${TYDIG_PAGE:-https://cxn.pub/}"; exit 1; }
    [ "$v" = "$(cat .git/deployed 2>/dev/null)" ] && exit
    git fetch -q origin main && git merge-base --is-ancestor "$v" origin/main ||
        { echo "update: $v is not on main"; exit 1; }
    git checkout -q --detach "$v" && just up && echo "$v" > .git/deployed

# make the static site (cxn.pub) open this hub, in this hub's brand (gh)
publish:
    gh variable set TYDIG_HUB -b "$({{sudo}}cat "$TYDIG_DATA/link" | sed 's/^[^#]*#//')"
    gh variable set TYDIG_BRAND -b "$({{sudo}}sed -n 's/^TYDIG_BRAND=//p' {{home}}/.env | tail -1 | grep . || echo tydig)"
    gh workflow run pages

down: here
    {{compose}} down

logs: here
    {{compose}} logs -f app sandbox

# a fresh password for EMAIL; without one, list the accounts
passwd email='': here
    {{compose}} exec app node server/passwd.mjs {{email}}

# an agent member: TYDIG_AGENT_TOKEN=tyd_... just agent PROJECT
agent project:
    TYDIG_PROJECT={{project}} node server/agent.mjs

# the hub on :3000 with hot reload, builds on this machine
dev:
    npm i && TYDIG_DEV=1 TYDIG_UNSAFE_BUILDS=1 TYDIG_LINK=0 node --watch-path=server server/index.mjs

# test suites, fresh hubs each (ui, link, lsp, sandbox: by name)
test *suites:
    npm i && node test/run.mjs {{suites}}

[private]
here:
    @[ "{{nixos}}" != y ] || { echo "NixOS runs this machine's hub: systemctl status tydig," \
        "journalctl -fu tydig, tydig link, tydig passwd" >&2; exit 1; }
