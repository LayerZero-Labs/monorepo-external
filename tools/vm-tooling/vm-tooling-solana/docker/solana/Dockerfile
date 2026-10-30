ARG RUST_VERSION=1.84.1
ARG OS_VERSION=bookworm
ARG SOLANA_VERSION=2.2.20
ARG PLATFORM_TOOLS_RUST_VERSION=1.88.0

FROM rust:$RUST_VERSION-$OS_VERSION AS solana_build

RUN <<-EOF
  set -e
  apt-get -y update --fix-missing
  apt-get -y install build-essential cmake jq libclang-dev libssl-dev libudev-dev llvm protobuf-compiler
EOF

ARG SOLANA_VERSION

WORKDIR /tmp/solana

# Solana v1.x releases live under solana-labs/solana, v2.x+ under anza-xyz/agave
RUN <<-EOF
  set -e
  MAJOR_VERSION=$(echo "$SOLANA_VERSION" | cut -d. -f1)
  if [ "$MAJOR_VERSION" -ge 2 ]; then
    REPO="anza-xyz/agave"
  else
    REPO="solana-labs/solana"
  fi
  curl -fsSL https://github.com/$REPO/archive/refs/tags/v$SOLANA_VERSION.tar.gz | tar xz --strip-components 1
EOF
# Agave 4.x leaves `cargoBuildSbfVersion` empty, so the install script would take crates.io's latest
# cargo-build-sbf. CARGO_BUILD_SBF_VERSION (config.ts dependencies) pins it.
ARG CARGO_BUILD_SBF_VERSION
ARG SPL_TOKEN_CLI_VERSION
RUN <<-EOF
  set -e
  if [ -n "$CARGO_BUILD_SBF_VERSION" ]; then
    sed -i "s/^cargoBuildSbfVersion=.*/cargoBuildSbfVersion=$CARGO_BUILD_SBF_VERSION/" scripts/cargo-build-sbf-version.sh
    grep -qx "cargoBuildSbfVersion=$CARGO_BUILD_SBF_VERSION" scripts/cargo-build-sbf-version.sh
  fi
  if [ -n "$SPL_TOKEN_CLI_VERSION" ]; then
    sed -i "s/^splTokenCliVersion=.*/splTokenCliVersion=$SPL_TOKEN_CLI_VERSION/" scripts/spl-token-cli-version.sh
    grep -qx "splTokenCliVersion=$SPL_TOKEN_CLI_VERSION" scripts/spl-token-cli-version.sh
  fi
  scripts/cargo-install-all.sh /opt/solana
EOF

FROM rust:$RUST_VERSION-$OS_VERSION AS anchor_build

RUN apt-get -y update --fix-missing && apt-get -y install --no-install-recommends libudev-dev pkg-config && rm -rf /var/lib/apt/lists/*

ARG ANCHOR_VERSION=0.31.1
# Anchor 1.1.2+ sets workspace `lto = true` + `codegen-units = 1`. rustc 1.92 on aarch64
# SIGTRAPs while LTO-linking that binary (`signal: 5`). Tooling does not need fat LTO.
RUN cargo install --locked --root /opt/solana --git https://github.com/solana-foundation/anchor --tag v$ANCHOR_VERSION --config 'profile.release.lto=false' anchor-cli

FROM rust:$RUST_VERSION-$OS_VERSION AS cargo_expand_build

ARG CARGO_EXPAND_VERSION=1.0.100
RUN cargo install --locked --root /opt/solana cargo-expand --version $CARGO_EXPAND_VERSION

# Pre-build platform-tools for the cache so cargo-build-sbf doesn't download at runtime.
# Adapted from https://github.com/LayerZero-Labs/devtools
FROM rust:${PLATFORM_TOOLS_RUST_VERSION}-$OS_VERSION AS platform_tools_build

ARG PLATFORM_TOOLS_VERSION
ARG TARGETARCH

RUN --mount=type=bind,source=platform-tools-cargo-lock,target=/tmp/platform-tools-cargo-lock <<-EOF
  set -e

  if [ -z "$PLATFORM_TOOLS_VERSION" ]; then
    echo "No PLATFORM_TOOLS_VERSION specified, skipping platform-tools build"
    mkdir -p /opt/platform-tools
    exit 0
  fi

  mkdir -p /opt/platform-tools

  # amd64 always has prebuilt binaries
  if [ "$TARGETARCH" = "amd64" ]; then
    curl -fsSL https://github.com/anza-xyz/platform-tools/releases/download/v${PLATFORM_TOOLS_VERSION}/platform-tools-linux-x86_64.tar.bz2 | tar -xj -C /tmp
    mv /tmp/llvm /tmp/rust /tmp/version.md /opt/platform-tools/
    exit 0
  fi

  # arm64 — check if prebuilt binary exists, otherwise build from source
  HTTP_STATUS=$(curl -sL -o /dev/null -w "%{http_code}" "https://github.com/anza-xyz/platform-tools/releases/download/v${PLATFORM_TOOLS_VERSION}/platform-tools-linux-aarch64.tar.bz2")

  if [ "$HTTP_STATUS" = "200" ]; then
    curl -fsSL https://github.com/anza-xyz/platform-tools/releases/download/v${PLATFORM_TOOLS_VERSION}/platform-tools-linux-aarch64.tar.bz2 | tar -xj -C /tmp
    mv /tmp/llvm /tmp/rust /tmp/version.md /opt/platform-tools/
  else
    echo "No prebuilt arm64 platform-tools for v${PLATFORM_TOOLS_VERSION}, building from source..."
    apt-get -y update --fix-missing
    apt-get -y install --no-install-recommends cmake ninja-build python3 libssl-dev pkg-config
    curl -fsSL https://github.com/anza-xyz/platform-tools/archive/refs/tags/v${PLATFORM_TOOLS_VERSION}.tar.gz | tar -xz -C /tmp
    cd /tmp/platform-tools-${PLATFORM_TOOLS_VERSION}
    # Only clone the latest commit to speed up the build
    sed -i '/^git clone/ s/$/ --depth 1/' build.sh
    # Comment out llvm/lib/python line that causes build failure
    sed -i '/llvm\/lib\/python/ s/^/#/' build.sh
    # Fix uname detection: Linux reports 'aarch64' but build.sh checks for 'arm64'.
    # Fixed upstream in v1.41. Only patch older versions.
    if [ "$PLATFORM_TOOLS_VERSION" != "1.41" ] && [ "$(printf '%s\n' "1.41" "$PLATFORM_TOOLS_VERSION" | sort -V | head -1)" = "$PLATFORM_TOOLS_VERSION" ]; then
      sed -i 's/== "arm64"/== "arm64" || "$(uname -m)" == "aarch64"/' build.sh
    fi
    CARGO_FORK_LOCK_PATCH_DIR="/tmp/platform-tools-cargo-lock/v${PLATFORM_TOOLS_VERSION}"
    if [ -d "$CARGO_FORK_LOCK_PATCH_DIR" ]; then
      sed -i \
        -e "/^pushd cargo$/a git apply $CARGO_FORK_LOCK_PATCH_DIR/git2.patch" \
        -e "/^pushd cargo$/a cp $CARGO_FORK_LOCK_PATCH_DIR/Cargo.lock Cargo.lock" \
        build.sh
      sed -i 's/cargo build --release$/cargo build --release --locked/' build.sh
      grep -qx "git apply $CARGO_FORK_LOCK_PATCH_DIR/git2.patch" build.sh
      grep -qx "cp $CARGO_FORK_LOCK_PATCH_DIR/Cargo.lock Cargo.lock" build.sh
      grep -q 'cargo build --release --locked$' build.sh
    fi
    ./build.sh target
    tar -xf platform-tools-linux-aarch64.tar.bz2
    mv llvm/ rust/ version.md /opt/platform-tools/
  fi
EOF

FROM rust:$RUST_VERSION-$OS_VERSION AS solana_verify_build

ARG SOLANA_VERIFY_VERSION
RUN <<-EOF
  set -e
  if [ -n "$SOLANA_VERIFY_VERSION" ]; then
    apt-get -y update --fix-missing
    apt-get -y install libudev-dev
    cargo install --locked --root /opt/solana solana-verify --version $SOLANA_VERIFY_VERSION
  else
    mkdir -p /opt/solana
  fi
EOF

FROM rust:$RUST_VERSION-$OS_VERSION

ARG SOLANA_VERSION

# Pre-populate platform-tools cache so cargo-build-sbf doesn't download at runtime
# This is critical for arm64 where older platform-tools versions have no prebuilt binaries
ARG PLATFORM_TOOLS_VERSION
COPY --from=platform_tools_build /opt/platform-tools /tmp/platform-tools-staged
RUN <<-EOF
  set -e
  if [ -n "$PLATFORM_TOOLS_VERSION" ] && [ -f /tmp/platform-tools-staged/version.md ]; then
    CACHE_DIR="/root/.cache/solana/v${PLATFORM_TOOLS_VERSION}/platform-tools"
    mkdir -p "$CACHE_DIR"
    cp -r /tmp/platform-tools-staged/* "$CACHE_DIR/"
    echo "Pre-populated platform-tools cache at $CACHE_DIR"
  fi
  rm -rf /tmp/platform-tools-staged
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

RUN <<-EOF
  set -e
  MAJOR_VERSION=$(echo "$SOLANA_VERSION" | cut -d. -f1)
  if [ "$MAJOR_VERSION" -ge 4 ]; then
    PLATFORM_TOOLS_RUST="/root/.cache/solana/v${PLATFORM_TOOLS_VERSION}/platform-tools/rust"
    PLATFORM_TOOLS_RUSTC_VERSION=$("$PLATFORM_TOOLS_RUST/bin/rustc" --version | sed -E 's/^rustc ([0-9]+\.[0-9]+\.[0-9]+).*/\1/')
    rustup toolchain link "${PLATFORM_TOOLS_RUSTC_VERSION}-sbpf-solana-v${PLATFORM_TOOLS_VERSION}" "$PLATFORM_TOOLS_RUST"
  else
    if [ "$MAJOR_VERSION" -ge 2 ]; then
      SBF_SDK=/usr/local/bin/platform-tools-sdk/sbf
    else
      SBF_SDK=/usr/local/bin/sdk/sbf
    fi
    sed -i 's/arm64\*)/arm64*|aarch64*)/' "$SBF_SDK/scripts/install.sh"
    "$SBF_SDK/scripts/install.sh"
  fi
EOF

# Contract workspaces pin the host channel in rust-toolchain.toml with rustfmt and clippy; install
# them here so the first cargo command does not fetch them at runtime (or fail offline).
RUN rustup component add rustfmt clippy

# Install pinned nightly toolchain for rustfmt (unstable formatting options)
# Version passed via --build-arg RUST_NIGHTLY_VERSION from config.ts dependencies
ARG RUST_NIGHTLY_VERSION
RUN if [ -n "$RUST_NIGHTLY_VERSION" ]; then \
      rustup install $RUST_NIGHTLY_VERSION && \
      rustup component add rustfmt clippy --toolchain $RUST_NIGHTLY_VERSION; \
    fi

ARG EXTRA_RUST_TOOLCHAINS_VERSION
RUN <<-EOF
  set -e
  HOST_TRIPLE=$(rustc -vV | sed -n 's/^host: //p')
  for TOOLCHAIN in $EXTRA_RUST_TOOLCHAINS_VERSION; do
    CHANNEL=$(echo "$TOOLCHAIN" | cut -d: -f1)
    COMPONENTS=$(echo "$TOOLCHAIN" | cut -d: -f2 | tr , ' ')
    TARGETS=$(echo "$TOOLCHAIN" | cut -d: -f3 | tr , ' ')
    ALIASES=$(echo "$TOOLCHAIN" | cut -d: -f4 | tr , ' ')
    rustup toolchain install "$CHANNEL" --profile minimal --no-self-update
    if [ -n "$COMPONENTS" ]; then rustup component add --toolchain "$CHANNEL" $COMPONENTS; fi
    if [ -n "$TARGETS" ]; then rustup target add --toolchain "$CHANNEL" $TARGETS; fi
    for ALIAS in $ALIASES; do
      ln -s "$CHANNEL-$HOST_TRIPLE" "$RUSTUP_HOME/toolchains/$ALIAS-$HOST_TRIPLE"
    done
  done
EOF

ENV RUSTUP_AUTO_INSTALL=0

RUN find /usr/local/cargo/bin -maxdepth 1 \( -type f -o -type l \) -exec cp -P {} /usr/local/bin/ \;

COPY --chmod=755 sbf-guard/cargo /opt/sbf-guard/bin/cargo
ENV PATH=/opt/sbf-guard/bin:$PATH

# Verify installation
ARG SOLANA_VERIFY_VERSION
ARG CARGO_BUILD_SBF_VERSION
RUN <<-EOF
  set -e
  anchor --version
  cargo-expand --version
  rustup toolchain list -v
  cargo fmt --version
  cargo clippy --version
  if [ -n "$RUST_NIGHTLY_VERSION" ]; then cargo +${RUST_NIGHTLY_VERSION} fmt --version; fi
  HOST_TRIPLE=$(rustc -vV | sed -n 's/^host: //p')
  for TOOLCHAIN in $EXTRA_RUST_TOOLCHAINS_VERSION; do
    CHANNEL=$(echo "$TOOLCHAIN" | cut -d: -f1)
    cargo +$CHANNEL --version
    for COMPONENT in $(echo "$TOOLCHAIN" | cut -d: -f2 | tr , ' '); do
      rustup component list --toolchain "$CHANNEL" --installed | grep -qx -e "$COMPONENT" -e "$COMPONENT-$HOST_TRIPLE"
    done
    for TARGET in $(echo "$TOOLCHAIN" | cut -d: -f3 | tr , ' '); do
      rustup target list --toolchain "$CHANNEL" --installed | grep -qx "$TARGET"
    done
    for ALIAS in $(echo "$TOOLCHAIN" | cut -d: -f4 | tr , ' '); do
      test "$(cargo +$ALIAS --version)" = "$(cargo +$CHANNEL --version)"
    done
  done
  solana --version
  if [ -n "$CARGO_BUILD_SBF_VERSION" ]; then
    cargo-build-sbf --version
    cargo-build-sbf --version | grep -q "^cargo-build-sbf $CARGO_BUILD_SBF_VERSION\$"
  fi
  if [ -n "$SOLANA_VERIFY_VERSION" ]; then solana-verify --version; fi
  docker --version
  which add_address_to_idl.py
  which cargo
  test "$(command -v cargo)" = /opt/sbf-guard/bin/cargo
EOF

# No entrypoint needed - Docker socket is mounted from host
