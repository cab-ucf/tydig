set dotenv-load
# With nixos.nix the hub is the tydig account's, data in /var/lib/tydig/data:
# these recipes act on that one, never start a second hub with other accounts.
sys := `systemctl cat tydig-update >/dev/null 2>&1 && [ "$(id -un)" != tydig ] && echo y || true`
as := if sys == "y" { "sudo -u tydig /usr/bin/env PATH=$PATH XDG_RUNTIME_DIR=/run/user/$(id -u tydig) TYDIG_DATA=$TYDIG_DATA " } else { "" }
src := if sys == "y" { "/var/lib/tydig/src" } else { justfile_directory() }
export TYDIG_DATA := env("TYDIG_DATA", if sys == "y" { "/var/lib/tydig/data" } else { justfile_directory() / "data" })
export TYDIG_PORT := env("TYDIG_PORT", "8080")
export TYDIG_URL := env("TYDIG_URL", "http://localhost:" + TYDIG_PORT)
export TYDIG_PODMAN_SOCK := env("TYDIG_PODMAN_SOCK", env("XDG_RUNTIME_DIR", "") / "podman/podman.sock")
scope := if env("TYDIG_SCOPE", "") == "1" { "--profile scope" } else { "" }
compose := as + "podman compose -f " + src + "/compose.yml " + scope

# build and start the hub, then print its link
up:
    #!/usr/bin/env bash
    [ "{{sys}}" = y ] && { {{as}}git -C {{src}} pull -q --ff-only; exec {{as}}just -f {{src}}/Justfile up; }
    mkdir -p "$TYDIG_DATA" && touch .env || exit
    # gVisor: builds get a kernel of their own (server/sandbox.mjs); pinned, checked
    v=20260928 g=$HOME/.local/share/tydig/gvisor-20260928 a=$(uname -m)
    case $a in x86_64) s=c8d3a9fd4d4c4f5b8ff213caa4517356be128d18659ec4cde37828fe797f61a9725a602a846c81a8ed19c057a996515d31c081eba343ed4613a89951ba32ed59;;
      aarch64) s=926538a4f20056d44838f230297ecec9192db2562e2523a207295f706b76126725f2ff7b4e59d747147510c5714057eeec862a0f77d43bf625746592b5f51b00;; esac
    [ -x $g/runsc ] || { mkdir -p $g && curl -fsSL https://storage.googleapis.com/gvisor/releases/release/$v/$a/gvisor.tar.bz2 -o $g.tbz &&
      echo "$s  $g.tbz" | sha512sum -c --quiet && tar -xjf $g.tbz -C $g; rm -f $g.tbz; }
    [ "${TYDIG_RUNTIME:-}" = none ] || { [ -x $g/runsc ] && export TYDIG_RUNTIME=$g/runsc ||
      echo "gVisor did not install: builds run in plain containers"; }
    systemctl --user enable --now podman.socket 2>/dev/null
    {{compose}} down 2>/dev/null
    ! ss -ltnH "sport = :$TYDIG_PORT" 2>/dev/null | grep -q . ||
        { echo "port $TYDIG_PORT is taken (ss -ltnp): stop it, or set TYDIG_PORT=8090 in .env"; exit 1; }
    {{compose}} up -d --build || exit
    for i in $(seq 30); do test -s "$TYDIG_DATA/link" && exec cat "$TYDIG_DATA/link"; sleep 1; done

# make the static site (cxn.pub) open this hub, in this hub's brand (gh)
publish:
    gh variable set TYDIG_HUB -b "$({{as}}cat "$TYDIG_DATA/link" | sed 's/^[^#]*#//')"
    gh variable set TYDIG_BRAND -b "$({{as}}sed -n 's/^TYDIG_BRAND=//p' {{src}}/.env | tail -1 | grep . || echo tydig)"
    gh workflow run pages

down:
    {{compose}} down

logs:
    {{compose}} logs -f app

# a fresh password for EMAIL; without one, list the accounts
passwd email='':
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
