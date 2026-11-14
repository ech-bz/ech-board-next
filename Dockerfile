FROM docker.io/lukemathwalker/cargo-chef:0.1.77-rust-1.94.1-slim-bookworm AS chef
WORKDIR /src
RUN rustup target add wasm32-unknown-unknown

FROM chef AS planner
COPY . .
RUN cargo chef prepare --recipe-path recipe.json

FROM chef AS build
COPY --from=planner /src/recipe.json recipe.json
RUN cargo chef cook --locked --release --recipe-path recipe.json -p ech-board-server
COPY . .
RUN RUSTFLAGS="-C target-feature=+simd128" cargo build --locked -p ech-board-program --target wasm32-unknown-unknown --profile guest
RUN cargo build --locked --release -p ech-board-server

FROM docker.io/library/debian:forky-slim
RUN apt-get update \
    && apt-get install -y --no-install-recommends ca-certificates ffmpeg \
    && rm -rf /var/lib/apt/lists/*
COPY --from=build /src/target/release/ech-board-server /usr/local/bin/ech-board-server
COPY --from=build /src/target/wasm32-unknown-unknown/guest/ech_board_program.wasm /usr/local/share/ech-board/forum.wasm
USER 65532:65532
ENV RUST_LOG=info
EXPOSE 8081
ENTRYPOINT ["/usr/local/bin/ech-board-server"]
CMD ["--config", "/etc/ech-board/config.json"]
