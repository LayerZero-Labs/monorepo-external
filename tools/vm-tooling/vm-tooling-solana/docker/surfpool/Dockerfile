# Standalone surfpool runtime image (solana-test-validator replacement): the surfpool binary only,
# no anchor/solana/cargo toolchain.
#
# Supply-chain hardening (mirrors the offchain-monorepo pattern): base images pulled through
# public.ecr.aws and pinned by sha256 digest, apt pulled from a pinned snapshot.debian.org date, apt
# packages pinned to exact versions, runtime runs as a non-root user. Bump DEBIAN_SNAPSHOT together
# with the package versions below to pick up security fixes.
#
# Build args from the lz-tool build matrix (config.ts):
#   SURFPOOL_VERSION      <- versions.surfpool          (release line the binary reports, e.g. 1.3.1)
#   SURFPOOL_REV_VERSION  <- dependencies.surfpool-rev  (exact git rev to build)
#   RUST_VERSION          <- dependencies.rust

ARG RUST_VERSION=1.89.0
ARG OS_VERSION=bookworm
ARG DEBIAN_SNAPSHOT=20260531T000000Z

# rust:${RUST_VERSION}-${OS_VERSION}, via public.ecr.aws (dodges Docker Hub rate limits) + digest.
FROM public.ecr.aws/docker/library/rust:${RUST_VERSION}-${OS_VERSION}@sha256:948f9b08a66e7fe01b03a98ef1c7568292e07ec2e4fe90d88c07bb14563c84ff AS surfpool_build

ARG OS_VERSION
ARG DEBIAN_SNAPSHOT
ARG SURFPOOL_REV_VERSION=c83f9b7104bb205ce0cb6ab1a1eed96183589433

RUN rm -f /etc/apt/sources.list /etc/apt/sources.list.d/debian.sources /etc/apt/sources.list.d/debian.list
RUN cat > /etc/apt/sources.list.d/debian.sources <<EOF
Types: deb
URIs: http://snapshot.debian.org/archive/debian/${DEBIAN_SNAPSHOT}
Suites: ${OS_VERSION} ${OS_VERSION}-updates
Components: main
Check-Valid-Until: no
Signed-By: /usr/share/keyrings/debian-archive-keyring.gpg

Types: deb
URIs: http://snapshot.debian.org/archive/debian-security/${DEBIAN_SNAPSHOT}
Suites: ${OS_VERSION}-security
Components: main
Check-Valid-Until: no
Signed-By: /usr/share/keyrings/debian-archive-keyring.gpg
EOF
RUN <<-SH
  set -e
  apt-get -y update
  apt-get -y install --no-install-recommends \
    build-essential=12.9 \
    cmake=3.25.1-1 \
    libclang-dev=1:14.0-55.7~deb12u1 \
    libssl-dev=3.0.20-1~deb12u1 \
    libudev-dev=252.39-1~deb12u2 \
    llvm=1:14.0-55.7~deb12u1 \
    protobuf-compiler=3.21.12-3 \
    pkg-config=1.8.1-1
  rustup component add llvm-tools rustc-dev
  cargo install --locked --root /opt/surfpool \
    --git https://github.com/solana-foundation/surfpool --rev "$SURFPOOL_REV_VERSION" surfpool-cli
SH

# debian:${OS_VERSION}-slim, via public.ecr.aws + digest.
FROM public.ecr.aws/docker/library/debian:${OS_VERSION}-slim@sha256:0104b334637a5f19aa9c983a91b54c89887c0984081f2068983107a6f6c21eeb

ARG OS_VERSION
ARG DEBIAN_SNAPSHOT
ARG CA_CERTIFICATES_VERSION=20230311+deb12u1
ARG LIBSSL3_VERSION=3.0.20-1~deb12u1

RUN rm -f /etc/apt/sources.list /etc/apt/sources.list.d/debian.sources /etc/apt/sources.list.d/debian.list
RUN cat > /etc/apt/sources.list.d/debian.sources <<EOF
Types: deb
URIs: http://snapshot.debian.org/archive/debian/${DEBIAN_SNAPSHOT}
Suites: ${OS_VERSION} ${OS_VERSION}-updates
Components: main
Check-Valid-Until: no
Signed-By: /usr/share/keyrings/debian-archive-keyring.gpg

Types: deb
URIs: http://snapshot.debian.org/archive/debian-security/${DEBIAN_SNAPSHOT}
Suites: ${OS_VERSION}-security
Components: main
Check-Valid-Until: no
Signed-By: /usr/share/keyrings/debian-archive-keyring.gpg
EOF
RUN <<-SH
  set -e
  apt-get -y update
  # surfpool dynamically links openssl; ca-certificates kept for any TLS the binary performs.
  apt-get -y install --no-install-recommends \
    ca-certificates=${CA_CERTIFICATES_VERSION} \
    libssl3=${LIBSSL3_VERSION}
  apt-get -y clean
  rm -rf /var/lib/apt/lists/*
SH

COPY --from=surfpool_build /opt/surfpool/bin/surfpool /usr/local/bin/surfpool

# Verify the binary runs and self-reports the version key from config.ts (versions.surfpool), so a
# rev that drifts from the declared release line fails the build instead of a later Tool-versions test.
ARG SURFPOOL_VERSION
RUN surfpool --version | grep -F "$SURFPOOL_VERSION"

# Run as non-root: surfpool only needs to read the /workspace mount and bind its RPC/WS ports.
RUN useradd --system --create-home --home-dir /home/surfpool surfpool
USER surfpool
