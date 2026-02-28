ARG RUST_VERSION=1.84.1
ARG OS_VERSION=bookworm

FROM rust:$RUST_VERSION-$OS_VERSION AS solana_build

RUN <<-EOF
  set -e
  apt-get -y update --fix-missing
  apt-get -y install build-essential cmake libclang-dev libssl-dev libudev-dev llvm protobuf-compiler
EOF

ARG SOLANA_VERSION=2.2.20

WORKDIR /tmp/solana

RUN curl -fsSL https://github.com/anza-xyz/agave/archive/refs/tags/v$SOLANA_VERSION.tar.gz | tar xz --strip-components 1
RUN scripts/cargo-install-all.sh /opt/solana

FROM rust:$RUST_VERSION-$OS_VERSION AS anchor_build

ARG ANCHOR_VERSION=0.31.1
RUN cargo install --locked --root /opt/solana --git https://github.com/solana-foundation/anchor --tag v$ANCHOR_VERSION anchor-cli

FROM rust:$RUST_VERSION-$OS_VERSION AS cargo_expand_build

ARG CARGO_EXPAND_VERSION=1.0.100
RUN cargo install --locked --root /opt/solana cargo-expand --version $CARGO_EXPAND_VERSION

FROM rust:$RUST_VERSION-$OS_VERSION AS solana_verify_build

RUN <<-EOF
  set -e
  apt-get -y update --fix-missing
  apt-get -y install libudev-dev
EOF

ARG SOLANA_VERIFY_VERSION=0.4.11
RUN cargo install --locked --root /opt/solana solana-verify --version $SOLANA_VERIFY_VERSION

FROM rust:$RUST_VERSION-$OS_VERSION

ARG SOLANA_VERSION=2.2.20

RUN <<-EOF
  set -e

  mkdir /tmp/platform-tools
  cd /tmp/platform-tools

  curl -fsSL https://github.com/anza-xyz/agave/releases/download/v$SOLANA_VERSION/sbf-sdk.tar.bz2 | tar jx
  # Fix architecture detection bug in install.sh
  sed -i 's/arm64\*)/arm64*|aarch64*)/' sbf-sdk/scripts/install.sh
  sbf-sdk/scripts/install.sh
EOF

RUN <<-EOF
  set -e

  apt-get -y update --fix-missing
  apt-get -y install --no-install-recommends python3 python3-pip jq libudev-dev pkg-config ca-certificates curl gnupg
  apt-get -y clean
  rm -rf /var/lib/apt

  pip3 install --break-system-packages base58
EOF

# Install Docker CLI only (not the daemon) - we'll use the host's Docker via socket
RUN <<-EOF
  set -e
  install -m 0755 -d /etc/apt/keyrings
  curl -fsSL https://download.docker.com/linux/debian/gpg | gpg --dearmor -o /etc/apt/keyrings/docker.gpg
  chmod a+r /etc/apt/keyrings/docker.gpg
  echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] https://download.docker.com/linux/debian bookworm stable" > /etc/apt/sources.list.d/docker.list
  apt-get update
  apt-get -y install --no-install-recommends docker-ce-cli
  apt-get -y clean
  rm -rf /var/lib/apt/lists/*
  # Move real docker to docker-real
  mv /usr/bin/docker /usr/bin/docker-real
EOF

# Docker wrapper script that translates /workspace paths to host paths
# This is needed because anchor/solana-verify spawn Docker containers using container paths,
# but the host Docker daemon only knows about host paths
RUN cat > /usr/bin/docker << 'WRAPPER_EOF'
#!/bin/bash
# Translate /workspace paths to HOST_WORKSPACE_ROOT for volume mounts
args=()
for arg in "$@"; do
  if [[ -n "$HOST_WORKSPACE_ROOT" && "$arg" == /workspace* ]]; then
    # Replace /workspace with HOST_WORKSPACE_ROOT
    # This handles both standalone paths (/workspace/path) and volume mounts (/workspace/path:/container/path)
    # since the replacement only affects the first occurrence of /workspace
    arg="${arg/\/workspace/$HOST_WORKSPACE_ROOT}"
  fi
  args+=("$arg")
done
exec /usr/bin/docker-real "${args[@]}"
WRAPPER_EOF
RUN chmod +x /usr/bin/docker

ADD add_address_to_idl.py /usr/local/bin/add_address_to_idl.py

COPY --from=solana_build /opt/solana /usr/local
COPY --from=anchor_build /opt/solana /usr/local
COPY --from=cargo_expand_build /opt/solana /usr/local
COPY --from=solana_verify_build /opt/solana /usr/local

# Copy cargo binaries to /usr/local/bin so they're available even when
# /usr/local/cargo is mounted as a volume for caching
RUN find /usr/local/cargo/bin -maxdepth 1 -type f -exec cp {} /usr/local/bin/ \;

# Verify installation
RUN <<-EOF
  set -e
  echo "PATH=$PATH"
  cargo --version
  anchor --version
  cargo-expand --version
  rustup toolchain list -v
  solana --version
  solana-verify --version
  docker --version
  which add_address_to_idl.py
  which cargo
EOF

# No entrypoint needed - Docker socket is mounted from host
