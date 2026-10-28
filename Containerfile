# The hub: the built client and the server. Builds run elsewhere (sandbox/).
FROM docker.io/library/node:22-slim AS client
WORKDIR /app
COPY package.json package-lock.json ./
COPY client/package.json client/
COPY server/package.json server/
RUN npm ci -w client
COPY client/ client/
COPY fonts/ fonts/
RUN apt-get update && apt-get install -y --no-install-recommends $(cat fonts/packages) && rm -rf /var/lib/apt/lists/*
COPY server/relay.mjs server/refs.mjs server/tags.mjs server/text.mjs server/
ARG TYDIG_BRAND=tydig
RUN npm run build && node client/brotli.mjs

# the link's iroh end (link/): Rust, so no byte of a link passes through JavaScript;
# bookworm's glibc, the older, so it runs on whichever Debian node:22-slim is
FROM docker.io/library/rust:1.91-slim-bookworm AS link
WORKDIR /link
COPY link/ .
RUN cargo build --release --locked

FROM docker.io/library/node:22-slim
# podman-remote, for the sandbox service: static, pinned, checksummed
ARG PODMAN=5.8.0
ARG SHA_amd64=95f348126f708e2f18c85341a3630849055d72a3d22d3e102146331277588637
ARG SHA_arm64=ad3e00885b27034b34f508c21265d43dd62f3d11b69fa822390800bfc17fe3f7
RUN apt-get update && apt-get install -y --no-install-recommends \
      git openssh-client tini ca-certificates curl \
 && rm -rf /var/lib/apt/lists/* \
 && a=$(dpkg --print-architecture) && eval sha=\$SHA_$a \
 && curl -fsSL -o /tmp/p.tgz https://github.com/containers/podman/releases/download/v$PODMAN/podman-remote-static-linux_$a.tar.gz \
 && echo "$sha  /tmp/p.tgz" | sha256sum -c - \
 && tar -xzf /tmp/p.tgz -C /tmp \
 && install -m755 "$(find /tmp -type f -name 'podman-remote-static-linux_*' ! -name '*.gz')" /usr/local/bin/podman \
 && rm -rf /tmp/* && podman --version \
 && git config --system user.email collab@localhost && git config --system user.name tydig \
 && git config --system --add safe.directory '*'
# irch, which mirrors a Discussion with a channel (server/irch.mjs)
ARG IRCH=0.0.11
ARG IRCH_amd64=267341933465c45ab03f8cd2958bb8fb924f26112481cfba8d14af9a32937645
ARG IRCH_arm64=c73c9533ce81a0def89e19326e943308a37fb4470a137da2197022dbbc26fb06
RUN a=$(dpkg --print-architecture) && eval sha=\$IRCH_$a \
 && m=$([ "$a" = arm64 ] && echo aarch64 || echo x86_64) \
 && curl -fsSL -o /usr/local/bin/irch https://github.com/cab-ucf/irch/releases/download/v$IRCH/irch-$m-unknown-linux-musl \
 && echo "$sha  /usr/local/bin/irch" | sha256sum -c - && chmod 755 /usr/local/bin/irch && irch --version
WORKDIR /app
COPY package.json package-lock.json ./
COPY server/package.json server/
RUN npm ci --omit=dev -w server
COPY server/ server/
COPY templates/ templates/
# what the sandbox service builds the build image from (server/sandbox.mjs)
COPY sandbox/ buildctx/sandbox/
COPY fonts/ buildctx/fonts/
COPY --from=client /app/client/dist/ client/dist/
COPY --from=link /link/target/release/tydig-link /usr/local/bin/
ENV NODE_ENV=production PORT=3000 TYDIG_IRCH=/usr/local/bin/irch
EXPOSE 3000
HEALTHCHECK --interval=15s --timeout=3s --start-period=20s CMD curl -fs localhost:3000/api/auth-config >/dev/null
ENTRYPOINT ["/usr/bin/tini", "--"]
CMD ["node", "server/index.mjs"]
