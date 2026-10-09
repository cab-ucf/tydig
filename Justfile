# tydig task runner. Run `just` on its own for the guided path.
#
# Everything below assumes rootless podman. `just up` needs nothing else
# installed -- not even Node. Settings (TYDIG_URL, ...) come from .env.
set dotenv-load

# On Linux the hub runs as its own account, `tydig` (made once, with sudo),
# with its own rootless podman: a way out of any container lands in an account
# that holds nothing but tydig -- not yours, with everything else you keep.
# TYDIG_USER= (empty) runs it as you: no sudo, macOS, or a machine of its own.
export TYDIG_USER := env_var_or_default("TYDIG_USER", if os() == "linux" { "tydig" } else { "" })
home := if TYDIG_USER == "" { justfile_directory() } else { "/var/lib/" + TYDIG_USER }
src := if TYDIG_USER == "" { justfile_directory() } else { home / "src" }
# a command, as that account, in its copy of this repository
as := if TYDIG_USER == "" { "" } else { "sudo -u " + TYDIG_USER + " env HOME=" + home + \
  " XDG_RUNTIME_DIR=/run/user/$(id -u " + TYDIG_USER + ") sh -c 'cd " + src + " && exec \"$@\"' -" }

# Projects, accounts and git history live here. Absolute, and mounted at the
# same path inside the containers so the hub and podman agree on what a
# project path means (see compose.yml).
export TYDIG_DATA := home / "data"
export TYDIG_PORT := env_var_or_default("TYDIG_PORT", "8080")
export TYDIG_URL := env_var_or_default("TYDIG_URL", "http://localhost:" + TYDIG_PORT)
export TYDIG_ORIGINS := env_var_or_default("TYDIG_ORIGINS", TYDIG_URL)

# Do everything: build both images, start the server, wait for it, open sesame.
# This is what plain `just` runs.
default: serve

# Build both images, start the server, wait for it, print the URL.
serve: preflight account sandbox image up
    #!/usr/bin/env bash
    set -uo pipefail
    printf 'waiting for the server'
    for i in $(seq 1 90); do
        if curl -sf "{{TYDIG_URL}}/api/auth-config" >/dev/null 2>&1; then
            echo
            echo "  tydig is up:  {{TYDIG_URL}}"
            echo "  collaborators, from any browser, nothing to install:"
            echo "                $({{as}} cat "{{TYDIG_DATA}}/link" 2>/dev/null || echo '(link off)')"
            echo
            echo "  Create an account, then create a project. It scaffolds a"
            echo "  pre-registered report: every number and conclusion is computed"
            echo "  from build/results.json by its own analysis, so the prose"
            echo "  follows the data. Open the build panel and run 'all'."
            echo
            echo "  logs: just logs     stop: just down     more: just help"
            exit 0
        fi
        printf '.'
        sleep 1
    done
    echo
    echo "the server did not answer in 90s. Check: just logs"
    exit 1

# Fail early and clearly rather than halfway through an image build.
[private]
preflight:
    #!/usr/bin/env bash
    set -uo pipefail
    command -v podman >/dev/null || { echo "podman is not installed. It is the only prerequisite."; exit 1; }
    if [ -z "{{TYDIG_USER}}" ] && ! podman info >/dev/null 2>&1; then
        echo "podman is installed but not working for this user (try: podman info)."
        exit 1
    fi

# The account tydig runs as, its rootless podman, and its own copy of this
# repository (images are built from that: it never reads your home).
[private]
account:
    #!/usr/bin/env bash
    set -euo pipefail
    u="{{TYDIG_USER}}" h="{{home}}"
    [ -n "$u" ] || exit 0
    # NixOS keeps its accounts (and their subuids) in its configuration
    nix="users.users.$u = { isNormalUser = true; home = \"$h\"; createHome = true; homeMode = \"700\";
      linger = true; autoSubUidGidRange = true; shell = \"/run/current-system/sw/bin/nologin\"; };
    virtualisation.podman.enable = true;"
    if ! id "$u" >/dev/null 2>&1; then
        if [ -e /etc/NIXOS ]; then
            printf 'tydig runs as its own account. Add to configuration.nix, nixos-rebuild switch, then just:\n\n%s\n' "$nix"
            exit 1
        fi
        echo "making the account $u (sudo, once): tydig runs as it, apart from you"
        sudo useradd --create-home --home-dir "$h" --shell "$(command -v nologin || echo /usr/sbin/nologin)" --comment 'tydig hub' "$u"
    fi
    sudo chmod 700 "$h"
    # rootless podman maps containers to ids of the account's own
    next() { awk -F: '{e=$2+$3} e>m{m=e} END{print (m>100000?m:100000)}' "$1"; }
    grep -q "^$u:" /etc/subuid || { s=$(next /etc/subuid); sudo usermod --add-subuids "$s-$((s+65535))" "$u"; }
    grep -q "^$u:" /etc/subgid || { s=$(next /etc/subgid); sudo usermod --add-subgids "$s-$((s+65535))" "$u"; }
    # its podman runs with nobody logged in as it, and again after a reboot
    uid=$(id -u "$u") sock=/run/user/$(id -u "$u")/podman/podman.sock
    sudo loginctl enable-linger "$u" 2>/dev/null || true
    sudo -u "$u" sh -c "rm -rf '$h/src' && mkdir '$h/src'"
    if [ -d /run/systemd/system ]; then
        # linger starts the account's own systemd: wait for its bus, then start its podman
        for i in $(seq 40); do [ -S /run/user/$uid/bus ] && break; sleep 0.5; done
        {{as}} systemctl --user enable --now podman.socket podman-restart.service ||
            echo "note: $u's systemd could not start podman.socket; podman runs by hand until a reboot"
    else
        echo "note: no systemd, so $u's podman lasts until a reboot (then: just)"
        sudo install -d -o "$u" -m 700 /run/user/$uid
        printf '[engine]\ncgroup_manager="cgroupfs"\nevents_logger="file"\n' |
            sudo -u "$u" sh -c "mkdir -p '$h/.config/containers' && cat > '$h/.config/containers/containers.conf'"
    fi
    if [ ! -S $sock ]; then
        {{as}} sh -c 'nohup podman system service --time=0 >/dev/null 2>&1 &'
        for i in $(seq 20); do [ -S $sock ] && break; sleep 0.5; done
    fi
    {{as}} podman info >/dev/null 2>&1 || { echo "podman does not work for $u (try: {{as}} podman info)"
        [ -e /etc/NIXOS ] && printf '\nOn NixOS, declare the account in configuration.nix:\n\n%s\n' "$nix"; exit 1; }
    {{as}} podman compose version >/dev/null 2>&1 ||
        { echo "podman compose needs a provider: install podman-compose system-wide"; exit 1; }
    # the tydig you ran as yourself, before: stopped, its data copied over once
    old=$(podman ps -q --filter ancestor=localhost/tydig 2>/dev/null || true)
    [ -z "$old" ] || { echo "stopping the tydig you ran as yourself"; podman rm -f $old >/dev/null; }
    if [ -f data/.auth-secret ] && ! sudo test -e "$h/data/.auth-secret"; then
        echo "copying data/ into $u's account (your data/ is left as it was)"
        sudo -u "$u" mkdir -p "$h/data"
        tar -C data --exclude=./.ssh -cf - . | sudo -u "$u" tar -xf - -C "$h/data"
    fi
    # what you have here, committed or not; settings from your environment
    git ls-files -z -co --exclude-standard | tar --null -T - --ignore-failed-read -cf - |
        sudo -u "$u" tar -xf - -C "$h/src"
    { env | grep '^TYDIG_' | grep -v '^TYDIG_USER=\|^TYDIG_PODMAN_SOCK='; echo "TYDIG_PODMAN_SOCK=$sock"; } |
        sudo -u "$u" sh -c "umask 077; cat > '$h/src/.env'"

# Report what the *running* server actually believes, which is the fastest way
# to settle an "Invalid origin" or "cannot sign in" problem.
doctor:
    #!/usr/bin/env bash
    set -uo pipefail
    echo "expected url : {{TYDIG_URL}}"
    echo "data dir     : {{TYDIG_DATA}}"
    echo "runs as     : ${TYDIG_USER:-you}"
    sock=/run/user/$(id -u {{TYDIG_USER}})/podman/podman.sock
    echo "podman sock  : $sock $({{as}} test -S $sock && echo '(present)' || echo '(MISSING: builds will fail)')"
    echo
    echo "--- containers"
    {{as}} podman compose ps 2>/dev/null || echo "compose not running"
    echo
    echo "--- what the running server reports"
    cfg=$(curl -s -m 5 -H "origin: {{TYDIG_URL}}" "{{TYDIG_URL}}/api/auth-config" || true)
    if [ -z "$cfg" ]; then
        echo "no answer from {{TYDIG_URL}} -- is it up? try: just logs"
        exit 1
    fi
    echo "$cfg" | python3 -m json.tool 2>/dev/null || echo "$cfg"
    echo
    if echo "$cfg" | grep -q '"originOk": *true'; then
        echo "origin check: OK for {{TYDIG_URL}}"
    else
        echo "origin check: FAILED. Open the app at one of the trustedOrigins above,"
        echo "or set TYDIG_URL and TYDIG_ORIGINS in .env to the address you"
        echo "actually use, then 'just serve'. To stop checking entirely on a"
        echo "trusted machine: TYDIG_ORIGINS='*'"
    fi
    echo
    echo "startedAt above tells you whether the running server includes your"
    echo "latest changes; 'just serve' rebuilds the image and recreates it."

# What else is here.
help:
    @echo "tydig -- collaborative Typst for reproducible papers"
    @echo
    @echo "  just                everything: build images, start server, print URL"
    @echo "  just logs           follow the server log"
    @echo "  just down           stop it"
    @echo "  just restart        restart after changing .env or code"
    @echo "  just shell          shell inside the running server"
    @echo "  just doctor         diagnose sign-in / origin / socket problems"
    @echo "  just passwd EMAIL   give an account a fresh password (printed)"
    @echo "  just link           the link collaborators open in a browser"
    @echo
    @echo "Pieces, one at a time:"
    @echo "  just sandbox        build the recipe sandbox image (typst/just/make/python)"
    @echo "  just image          build the app server image"
    @echo "  just up             start the server (assumes images exist)"
    @echo "  just paper P [T]    run a project's make targets with no app:"
    @echo "                        just paper my-project all"
    @echo "  just sso            print the SSO env vars to set"
    @echo "  just secret         generate a stable TYDIG_SECRET"
    @echo "  just clean          remove containers and images (keeps your data)"
    @echo
    @echo "Working on the app itself (needs Node 22):"
    @echo "  just dev            vite :5173 + server :3000, hot reload"
    @echo "  just test           all API suites, two-hub federation, git remotes"
    @echo "  just test-ui        drive the real UI in headless Chrome"
    @echo "  just test-link      open a hub by its link, via a local iroh-relay"
    @echo "  just test-sandbox   the build sandbox, with real podman"
    @echo
    @echo "runs as  : ${TYDIG_USER:-you}"
    @echo "data dir : {{TYDIG_DATA}}"
    @echo "url      : {{TYDIG_URL}}"

# The sandbox image that recipe builds run inside (typst, just, python stack).
sandbox:
    {{as}} podman build -t tydig-build -f sandbox/Containerfile .

# The app server image (client build + Node runtime).
image:
    {{as}} podman build --format docker -t tydig -f Containerfile.server .

# Start the hub, its sandbox service and the build network's egress.
# --force-recreate matters: with the same image tag, compose will happily
# leave the old container running, so a rebuilt image never takes effect and
# you debug code that isn't deployed.
up: account
    {{as}} mkdir -p "{{TYDIG_DATA}}"
    TYDIG_PODMAN_SOCK=${TYDIG_PODMAN_SOCK:-/run/user/$(id -u)/podman/podman.sock} {{as}} podman compose up -d --force-recreate

down:
    {{as}} podman compose down

restart: down up

logs:
    {{as}} podman compose logs -f app

# The link collaborators open in any browser (also in Settings > Share).
link:
    @{{as}} cat "{{TYDIG_DATA}}/link"

# Run an agent member of PROJECT (Share > Agents gives its token):
#   TYDIG_AGENT_TOKEN=tyd_... just agent paper
# Each @mention is handed to Claude Code (TYDIG_AGENT_CMD for another agent).
agent project:
    TYDIG_HUB=http://localhost:{{TYDIG_PORT}} TYDIG_PROJECT={{project}} node server/agent.mjs

# Give an account a fresh password and print it (no mail to reset by);
# with no address, list the accounts.
passwd email='':
    {{as}} podman compose exec app node server/passwd.mjs {{email}}

# Shell inside the running server (inspect data/, git history, run git notes).
shell:
    {{as}} podman compose exec app bash

# Host dev loop: client on :5173 with hot reload, server on :3000.
# The origins above describe the *containerised* server on :8080; in dev the
# browser is at Vite's :5173, so they must be overridden or every sign-in
# fails with "Invalid origin".
dev:
    #!/usr/bin/env bash
    npm install
    trap 'kill 0' EXIT
    mkdir -p data
    export TYDIG_URL=http://localhost:5173 \
        TYDIG_ORIGINS=http://localhost:5173,http://localhost:3000 \
        TYDIG_DATA=$PWD/data TYDIG_SANDBOX=$PWD/data/sandbox.sock TYDIG_BUILD_NET=0
    node server/sandbox.mjs & npm -w server start & npm -w client run dev

# Full test suite. Each suite gets a fresh server and a fresh data dir.
test:
    #!/usr/bin/env bash
    set -euo pipefail
    npm install >/dev/null
    npm run build >/dev/null
    repo=$PWD
    for suite in test authtest offlinetest provtest singleporttest signuptest agenttest templatetest egresstest importtest; do
        # each suite in a scratch dir of its own: never the real data/
        t=$(mktemp -d); cd "$t"
        echo "--- $suite"
        # The suites talk to :3000 directly, so the trusted origin must match
        # that, not the containerised port exported above. Legacy :1234 stays
        # on: the older suites connect to it (singleporttest uses /sync).
        # signuptest checks the invite-only default; the rest sign up freely
        env TYDIG_DATA="$t/data" TYDIG_LINK=0 \
            TYDIG_SIGNUP=$([ $suite = signuptest ] || echo open) \
            TYDIG_URL=http://localhost:3000 \
            TYDIG_ORIGINS=http://localhost:3000 \
            TYDIG_UNSAFE_BUILDS=1 \
            node "$repo/server/index.mjs" >/tmp/tc-$suite.log 2>&1 &
        srv=$!
        sleep 5
        node "$repo/server/$suite.mjs" || { echo "FAILED: $suite (log: /tmp/tc-$suite.log)"; kill $srv; exit 1; }
        kill $srv 2>/dev/null || true
        sleep 1; cd "$repo"; rm -rf "$t"
    done
    echo
    echo "all suites passed"
    just test-fed

# The sandbox service with real rootless podman, as the account tydig runs
# as: what a build can touch, and what the hub can ask for.
test-sandbox: account
    {{as}} node server/sandboxtest.mjs

# Two independent hubs (own ports, data dirs, iroh identities) federating one
# project over iroh on the loopback: join by invite, edits both ways, refusal
# of a bad invite.
test-fed:
    #!/usr/bin/env bash
    set -uo pipefail
    rm -rf /tmp/tydig-hubA /tmp/tydig-hubB
    common="TYDIG_SIGNUP=open TYDIG_LINK=0 TYDIG_UNSAFE_BUILDS=1 TYDIG_SYNC_PORT=0 TYDIG_IROH_RELAY=local TYDIG_IROH_BIND=127.0.0.1:0"
    env -u TYDIG_DATA $common PORT=3100 TYDIG_DATA=/tmp/tydig-hubA \
        TYDIG_URL=http://localhost:3100 TYDIG_ORIGINS=http://localhost:3100 \
        node server/index.mjs >/tmp/tc-hubA.log 2>&1 &
    a=$!
    env -u TYDIG_DATA $common PORT=3200 TYDIG_DATA=/tmp/tydig-hubB \
        TYDIG_URL=http://localhost:3200 TYDIG_ORIGINS=http://localhost:3200 \
        node server/index.mjs >/tmp/tc-hubB.log 2>&1 &
    b=$!
    sleep 7
    echo "--- fedtest (two hubs)"
    node server/fedtest.mjs; rc=$?
    kill $a $b 2>/dev/null; wait $a $b 2>/dev/null
    [ $rc -eq 0 ] || { echo "FAILED: fedtest (logs: /tmp/tc-hubA.log /tmp/tc-hubB.log)"; exit 1; }
    just test-git

# Two hubs sharing one git remote (a bare repo standing in for GitHub /
# GitLab / Codeberg): push, adopt from the remote alone, concurrent edits
# converging through git, and a plain clone yielding the working project.
test-git:
    #!/usr/bin/env bash
    set -uo pipefail
    rm -rf /tmp/tydig-hubA /tmp/tydig-hubB /tmp/tydig-remote.git /tmp/plainclone
    git init -q --bare /tmp/tydig-remote.git
    git -C /tmp/tydig-remote.git symbolic-ref HEAD refs/heads/main
    common="TYDIG_SIGNUP=open TYDIG_LINK=0 TYDIG_UNSAFE_BUILDS=1 TYDIG_SYNC_PORT=0 TYDIG_IROH=0 TYDIG_GIT_LOCAL=1"
    env -u TYDIG_DATA $common PORT=3100 TYDIG_DATA=/tmp/tydig-hubA \
        TYDIG_URL=http://localhost:3100 TYDIG_ORIGINS=http://localhost:3100 \
        node server/index.mjs >/tmp/tc-gitA.log 2>&1 &
    a=$!
    env -u TYDIG_DATA $common PORT=3200 TYDIG_DATA=/tmp/tydig-hubB \
        TYDIG_URL=http://localhost:3200 TYDIG_ORIGINS=http://localhost:3200 \
        node server/index.mjs >/tmp/tc-gitB.log 2>&1 &
    b=$!
    sleep 6
    echo "--- gitsynctest (two hubs, one git remote)"
    node server/gitsynctest.mjs; rc=$?
    kill $a $b 2>/dev/null; wait $a $b 2>/dev/null
    [ $rc -eq 0 ] || { echo "FAILED: gitsynctest (logs: /tmp/tc-gitA.log /tmp/tc-gitB.log)"; exit 1; }

# Browser-level test in headless Chrome: preview compiles, panes open, a
# build runs from the pane, a checkpoint shows as signed. Installs puppeteer
# (and Chrome, ~170 MB, once) into .uitest/ on first run.
test-ui:
    #!/usr/bin/env bash
    set -euo pipefail
    npm install >/dev/null
    npm run build >/dev/null
    mkdir -p .uitest && cd .uitest && { test -f package.json || echo '{"private":true}' > package.json; } \
        && { test -d node_modules/puppeteer || npm i puppeteer --no-audit --no-fund >/dev/null; } && cd ..
    env TYDIG_DATA="$(mktemp -d)" TYDIG_LINK=0 TYDIG_URL=http://localhost:3000 TYDIG_ORIGINS=http://localhost:3000 \
        TYDIG_UNSAFE_BUILDS=1 node server/index.mjs >/tmp/tc-ui.log 2>&1 &
    srv=$!
    sleep 6
    node server/uitest.mjs || { echo "FAILED: uitest (log: /tmp/tc-ui.log)"; kill $srv; exit 1; }
    kill $srv 2>/dev/null || true

# The link path in headless Chrome: a static server on another origin, a hub,
# and a local relay between them (`iroh-relay` on PATH, from n0-computer/iroh
# releases). The page reaches the hub only over iroh.
test-link:
    #!/usr/bin/env bash
    set -uo pipefail
    npm run build >/dev/null
    d=$(mktemp -d); mkdir -p $d/site; ln -s "$PWD/client/dist" $d/site/app
    printf 'enable_metrics = false\nhttp_bind_addr = "127.0.0.1:3340"\n' > $d/relay.toml
    iroh-relay --dev --config-path $d/relay.toml >$d/relay.log 2>&1 & r=$!
    python3 -m http.server 8099 --directory $d/site >/dev/null 2>&1 & w=$!
    env -u TYDIG_DATA TYDIG_DATA=$d/data TYDIG_URL=http://localhost:3000 TYDIG_ORIGINS=http://localhost:3000 \
        TYDIG_UNSAFE_BUILDS=1 TYDIG_IROH=0 TYDIG_PAGE=http://localhost:8099/app/ \
        TYDIG_LINK_RELAY=http://localhost:3340 node server/index.mjs >/tmp/tc-link.log 2>&1 & h=$!
    sleep 6
    LINKFILE=$d/data/link DATA=$d/data node server/linktest.mjs; rc=$?
    kill $r $w $h 2>/dev/null
    exit $rc

# Run a project's build graph in the sandbox, without the app.
#   just paper my-project all
paper project target="all":
    {{as}} podman run --rm --network=none --userns=keep-id:uid=1000,gid=1000 \
        --memory=2g --pids-limit=512 --cpus=2 \
        --cap-drop=ALL --security-opt no-new-privileges \
        --read-only --tmpfs /tmp:rw,size=512m --tmpfs /work/.git:ro,size=4k,notmpcopyup \
        -e HOME=/tmp -e MPLCONFIGDIR=/tmp/mpl -e TYPST_ROOT=/work \
        -v "{{TYDIG_DATA}}/{{project}}:/work:rw,z" -w /work \
        localhost/tydig-build make {{target}}

# Generate a stable session secret (put it in .env before first sign-up).
secret:
    @echo "TYDIG_SECRET=$(openssl rand -base64 32 | tr -d '\n')"

# Print the env vars for institutional sign-in.
sso:
    @echo "Put these in .env next to compose.yml, then 'just restart':"
    @echo
    @echo "TYDIG_SSO_DISCOVERY=https://idp.example.edu/.well-known/openid-configuration"
    @echo "TYDIG_SSO_CLIENT_ID=tydig"
    @echo "TYDIG_SSO_CLIENT_SECRET=..."
    @echo 'TYDIG_SSO_LABEL=Example University'
    @echo "TYDIG_SSO_ONLY=1   # optional: turn off local passwords"
    @echo
    @echo "Register a confidential client at the IdP with redirect URI:"
    @echo "  {{TYDIG_URL}}/api/auth/oauth2/callback/sso"
    @echo "scopes: openid profile email (authorization code + PKCE)"

# Remove containers and images. Project data is left alone.
clean:
    -{{as}} podman compose down
    -{{as}} podman rmi localhost/tydig localhost/tydig-build
    rm -rf client/dist
