# Use rust slim image for smaller size while keeping Rust toolchain for contract building
ARG RUST_VERSION=1.89.0
FROM rust:${RUST_VERSION}-slim-bookworm

ARG STELLAR_VERSION=25.1.0

# Install dependencies (slim image needs more explicit packages)
# gosu is used for proper user switching in the entrypoint to support dynamic UID/GID
RUN apt-get update && apt-get install -y \
    build-essential \
    libssl-dev \
    pkg-config \
    git \
    make \
    libdbus-1-dev \
    libudev-dev \
    ca-certificates \
    clang \
    mold \
    gosu \
    && rm -rf /var/lib/apt/lists/*

# Add the wasm32v1-none target for Stellar smart contract compilation
RUN rustup target add wasm32v1-none

# Install sccache for compilation caching (placed in /usr/local/bin to avoid volume shadowing)
RUN cargo install sccache --locked && \
    cp /usr/local/cargo/bin/sccache /usr/local/bin/sccache

# Install cargo-nextest for faster test execution
RUN cargo install cargo-nextest@0.9.128 --locked

# Install the Stellar CLI from source
RUN cargo install --locked stellar-cli@$STELLAR_VERSION

# Verify installation
RUN stellar --version

# Copy binaries to /usr/local/bin so they're accessible regardless of CARGO_HOME
# At runtime, CARGO_HOME will point to /cache/cargo (Docker volume)
RUN cp /usr/local/cargo/bin/stellar /usr/local/bin/ && \
    cp /usr/local/cargo/bin/cargo-nextest /usr/local/bin/

# Ensure binaries are in PATH for all users
# /usr/local/cargo/bin is needed for cargo itself (from rust base image)
ENV PATH="/usr/local/cargo/bin:/usr/local/bin:${PATH}"

# Create cache parent directory
# Subdirectories will be created by entrypoint after volumes are mounted
RUN mkdir -p /cache

# Set up entrypoint for dynamic UID/GID support
COPY entrypoint.sh /usr/local/bin/entrypoint.sh
RUN chmod +x /usr/local/bin/entrypoint.sh

WORKDIR /workspace

ENTRYPOINT ["/usr/local/bin/entrypoint.sh"]
