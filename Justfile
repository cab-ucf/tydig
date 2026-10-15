set dotenv-load
export TYDIG_DATA := env("TYDIG_DATA", justfile_directory() / "data")
export TYDIG_PODMAN_SOCK := env("TYDIG_PODMAN_SOCK", env("XDG_RUNTIME_DIR", "") / "podman/podman.sock")
scope := if env("TYDIG_SCOPE", "") == "1" { "--profile scope" } else { "" }
compose := "podman compose " + scope

# build and start the hub, then print its link
up:
    @mkdir -p "$TYDIG_DATA" && touch .env && podman build -q -t tydig-build -f sandbox/Containerfile .
    -@systemctl --user enable --now podman.socket 2>/dev/null
    {{compose}} up -d --build --force-recreate
    @for i in $(seq 30); do test -s "$TYDIG_DATA/link" && exec cat "$TYDIG_DATA/link"; sleep 1; done

# make the static site (cxn.pub) open this hub with no code after # (gh)
publish:
    gh variable set TYDIG_HUB -b "$(sed 's/^[^#]*#//' "$TYDIG_DATA/link")" && gh workflow run pages

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
