# Build Instructions

Go's `//go:embed` directive in `server/router/frontend/frontend.go` embeds the frontend at **compile time** from `server/router/frontend/dist/`. However, `pnpm build` outputs to `web/dist/` - a separate folder.

You must copy the frontend build contents to the embed location before building the Go binary.

## Build Order

```bash
# 1. Build frontend
cd web && pnpm build
cd ..

# 2. Sync to embed location (ensure the destination is clean and no nested 'dist' is created)
rm -rf server/router/frontend/dist/*
cp -r web/dist/* server/router/frontend/dist/

# 3. Build Go binary (embeds frontend)
go build -o ./build/memos ./cmd/memos

# 4. Stop service, install, restart
sudo systemctl stop memos
sudo cp build/memos /usr/local/bin/memos
sudo systemctl start memos
```

## Troubleshooting

- **Nested Folders**: If you use `cp -r web/dist server/router/frontend/dist`, you might end up with `server/router/frontend/dist/dist/`. Ensure you copy the *contents* (`web/dist/*`).
- **Cache**: If the browser still shows stale content after deploying, do a hard refresh (Ctrl+Shift+R) to clear cached JS/CSS.
```
