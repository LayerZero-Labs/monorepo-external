# node:22.22.3-bookworm-slim, via public.ecr.aws (dodges Docker Hub rate limits) + digest.
# NOTE: do not bump this to match TON's node:24.9.0.
# @matterlabs/hardhat-zksync-solc@1.3.2 passes `maxRedirections` to Undici,
# but Node 24's bundled Undici 7 rejects that request option, causing
# `hardhat download:all` to fail.
ARG NODE_IMAGE=public.ecr.aws/docker/library/node:22.22.3-bookworm-slim@sha256:e21fc383b50d5347dc7a9f1cae45b8f4e2f0d39f7ade28e4eef7d2934522b752

FROM ${NODE_IMAGE} AS npm_build

ARG HARDHAT_VERSION=2.26.3

WORKDIR /opt/npm
COPY lockfiles/${HARDHAT_VERSION}/package.docker.json ./package.json
COPY lockfiles/${HARDHAT_VERSION}/package-lock.docker.json ./package-lock.json
RUN npm ci
RUN test "$(node -p 'require("./node_modules/hardhat/package.json").version')" = "$HARDHAT_VERSION"

FROM ${NODE_IMAGE}

# Pin apt to a fixed Debian snapshot and exact package versions, mirroring
# tools/vm-tooling/vm-tooling-solana/docker/surfpool/Dockerfile.
# curl + ca-certificates are build-only (Foundry tarball download / HTTPS); removed after.
ARG TARGETARCH
ARG DEBIAN_SNAPSHOT=20260531T000000Z
ARG CA_CERTIFICATES_VERSION=20230311+deb12u1
ARG CURL_VERSION=7.88.1-10+deb12u14
ARG BASE_APT_HASH_AMD64=f9b5da4731c2fe2c4ea85dbc5c7f8f7219359e9e1a42699392313dab0c71ea93
ARG BASE_APT_HASH_ARM64=e2be419ac7f0c14e948489971181795e31d598895a490b0775deaa5ad88d7328

RUN cat > /etc/apt/sources.list.d/debian.sources <<-SRC
	Types: deb
	URIs: http://snapshot.debian.org/archive/debian/${DEBIAN_SNAPSHOT}
	Suites: bookworm bookworm-updates
	Components: main
	Signed-By: /usr/share/keyrings/debian-archive-keyring.gpg
	Check-Valid-Until: no

	Types: deb
	URIs: http://snapshot.debian.org/archive/debian-security/${DEBIAN_SNAPSHOT}
	Suites: bookworm-security
	Components: main
	Signed-By: /usr/share/keyrings/debian-archive-keyring.gpg
	Check-Valid-Until: no
	SRC

RUN <<-EOF
  set -e
  apt-get update
  apt-get install -y --no-install-recommends \
    ca-certificates=${CA_CERTIFICATES_VERSION} \
    curl=${CURL_VERSION}
  apt-get clean
  rm -rf /var/lib/apt/lists/*
  case "${TARGETARCH}" in
    amd64) expected_hash="${BASE_APT_HASH_AMD64}" ;;
    arm64) expected_hash="${BASE_APT_HASH_ARM64}" ;;
    *) echo "unsupported TARGETARCH: ${TARGETARCH}" >&2; exit 1 ;;
  esac
  find $(dpkg-query --showformat='${Package}\n' --show | xargs dpkg -L 2>/dev/null | sort -u) \
    -maxdepth 0 -type f 2>/dev/null | sort | xargs sha256sum | sha256sum | \
    grep -q "${expected_hash}" || \
    (echo "ERROR: apt package binary hash mismatch in base stage" && exit 1)
EOF

# Keep the existing global layout: Hardhat v2 resolves plugins through NODE_PATH.
COPY --from=npm_build /opt/npm/node_modules /usr/local/lib/node_modules
RUN <<-EOF
  set -e
  for executable in /usr/local/lib/node_modules/.bin/*; do
    ln -s "../lib/node_modules/.bin/$(basename "$executable")" "/usr/local/bin/$(basename "$executable")"
  done
EOF

COPY ./hardhat.config.cjs ./tasks.cjs ./compiler-versions.json /hardhat/
RUN ln -s /hardhat/hardhat.config.cjs /hardhat/hardhat.default.config.js

COPY ./flatten.sh ./flatten_dir.sh ./sol_merger.sh /usr/local/bin/
RUN chmod +x /usr/local/bin/flatten.sh /usr/local/bin/flatten_dir.sh /usr/local/bin/sol_merger.sh

ENV HARDHAT_DISABLE_TELEMETRY_PROMPT=true
ENV HARDHAT_EXPERIMENTAL_ALLOW_NON_LOCAL_INSTALLATION=true
ENV NODE_PATH=/usr/local/lib/node_modules
ENV ZKSYNC_DISABLE_TELEMETRY=1

RUN <<-EOF
  set -e
  unset HARDHAT_VERSION
  cd /hardhat
  hardhat download:all
  hardhat download:all --network tron-mainnet
EOF

ENV PATH=/root/.foundry/bin:$PATH

# Skip `curl https://foundry.paradigm.xyz | bash` / foundryup: download the
# release tarball for the build arch and verify its sha256 instead. Digests are
# the GitHub release-asset content hashes for foundry_v${FORGE_VERSION}_linux_*.tar.gz.
ARG FORGE_VERSION=1.3.6
ARG FOUNDRY_LINUX_AMD64_SHA256=01248d7ce267f5b7958bc9b331d068c6c2d8eeb182e58f0b556d7295f398e2ce
ARG FOUNDRY_LINUX_ARM64_SHA256=f87fedd5e66f73d2485a68b4a339fe46625426e4878e7da75a39e359065d176c

RUN <<-EOF
  set -e
  case "${TARGETARCH}" in
    amd64) sha="${FOUNDRY_LINUX_AMD64_SHA256}" ;;
    arm64) sha="${FOUNDRY_LINUX_ARM64_SHA256}" ;;
    *) echo "unsupported TARGETARCH: ${TARGETARCH}" >&2; exit 1 ;;
  esac
  mkdir -p /root/.foundry/bin
  curl -fsSL \
    "https://github.com/foundry-rs/foundry/releases/download/v${FORGE_VERSION}/foundry_v${FORGE_VERSION}_linux_${TARGETARCH}.tar.gz" \
    -o /tmp/foundry.tar.gz
  echo "${sha}  /tmp/foundry.tar.gz" | sha256sum -c -
  tar -xzf /tmp/foundry.tar.gz -C /root/.foundry/bin
  rm -f /tmp/foundry.tar.gz
  chmod +x /root/.foundry/bin/*
EOF

RUN apt-get -y remove ca-certificates curl
