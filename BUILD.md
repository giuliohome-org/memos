# Build Instructions

Go's `//go:embed` directive in `server/router/frontend/frontend.go` embeds the frontend at **compile time** from `server/router/frontend/dist/`. However, `pnpm build` outputs to `web/dist/` - a separate folder.

You must copy the frontend build to the embed location before building the Go binary.

## Build Order

```bash
# 1. Build frontend
cd web && pnpm build
cd ..

# 2. Copy to embed location
cp -r web/dist server/router/frontend/dist

# 3. Build Go binary (embeds frontend)
go build -o ./build/memos ./cmd/memos

# 4. Stop service, install, restart
sudo systemctl stop memos
sudo cp build/memos /usr/local/bin/memos
sudo systemctl start memos
```

## Troubleshooting

If the browser still shows stale content after deploying, do a hard refresh (Ctrl+Shift+R) to clear cached JS/CSS.
