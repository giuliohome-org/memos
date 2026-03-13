# Build & Deploy (Embedded Frontend)

The Go binary embeds the frontend assets at compile time via `//go:embed` in
`server/router/frontend/`. This means every frontend change requires rebuilding
both the frontend **and** the Go binary.

## Build Steps

```bash
# 1. Build frontend into the Go embed directory
cd web
pnpm release
# Output goes to ../server/router/frontend/dist/

# 2. Build Go binary (embeds the fresh frontend assets)
cd ..
go build -o ./memos ./cmd/memos
```

## Deploy to systemd Service

The production service runs as a systemd unit (`memos.service`) with the binary
at `/usr/local/bin/memos` and data in `/var/lib/memos`.

```bash
# 3. Stop the running service
sudo systemctl stop memos.service

# 4. Copy the new binary
sudo cp ./memos /usr/local/bin/memos

# 5. Restart
sudo systemctl start memos.service

# 6. Verify
systemctl status memos.service
```

## Quick One-Liner

```bash
cd web && pnpm release && cd .. && go build -o ./memos ./cmd/memos && \
  sudo systemctl stop memos.service && \
  sudo cp ./memos /usr/local/bin/memos && \
  sudo systemctl start memos.service
```

## Notes

- The `pnpm release` script is equivalent to:
  `vite build --mode release --outDir=../server/router/frontend/dist --emptyOutDir`
- The regular `pnpm build` outputs to `web/dist/` (wrong location for embedding).
  Always use `pnpm release`.
- The systemd unit file is at `/etc/systemd/system/memos.service`.
