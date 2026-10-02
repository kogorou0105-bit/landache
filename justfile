default:
    @just --list

dev:
    pnpm dev

build:
    pnpm build
    cargo build --workspace

test:
    pnpm test
    cargo test --workspace

