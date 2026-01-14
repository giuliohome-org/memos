# Running Memos as a `systemd` Service

This guide explains how to run the Memos application as a robust `systemd` service on a Linux server. This method ensures the application starts automatically on boot and restarts if it crashes.

## Prerequisites

- A compiled Memos binary.
- A Linux server with `systemd`.
- Administrative (`sudo`) privileges.
- A configured PostgreSQL database.

## 1. Place Files in Standard Directories

System services should run from standard, predictable locations for security and manageability.

### 1.1. Move the Executable

Copy the compiled `memos` binary to `/usr/local/bin/`, a standard directory for user-installed executables.

```bash
sudo cp ./build/memos /usr/local/bin/memos
```

### 1.2. Create the Data Directory

Create a dedicated directory in `/var/lib/` to store application data, such as user uploads and other state information.

```bash
sudo mkdir -p /var/lib/memos
# Grant ownership to the user who will run the service (e.g., 'giulio')
sudo chown -R giulio:giulio /var/lib/memos
```

## 2. Create the `systemd` Service File

Create a service unit file at `/etc/systemd/system/memos.service`. This file tells `systemd` how to manage the Memos process.

```bash
sudo nano /etc/systemd/system/memos.service
```

Paste the following content into the file. **Modify the `User`, `Group`, and `--dsn` string as needed for your environment.**

```ini
[Unit]
Description=Memos Service
# Ensures the service starts after the network is available and the PostgreSQL service is running.
After=network.target postgresql.service
# Adds a hard dependency on the PostgreSQL service.
Requires=postgresql.service

[Service]
# The user and group the service will run as.
# Replace 'giulio' with the appropriate username.
User=giulio
Group=giulio

# The command to start the service, using absolute paths.
# Ensure the --dsn string is correct for your PostgreSQL database.
ExecStart=/usr/local/bin/memos --mode prod --driver postgres --dsn "postgresql://giulio:giulio@localhost:5432/memos_dev?sslmode=disable" --data /var/lib/memos

# Set the working directory to the data directory.
WorkingDirectory=/var/lib/memos

# Automatically restart the service if it fails.
Restart=on-failure
RestartSec=5s

# Use a private temporary directory for added security.
PrivateTmp=true

[Install]
# Enable the service to be started at boot time.
WantedBy=multi-user.target
```

**Note:** The service name for PostgreSQL is usually `postgresql.service`, but it can vary (e.g., `postgresql-14.service`). Adjust the `After=` and `Requires=` lines if your system uses a different name.

The entire `ExecStart` command must be on a single, continuous line.

## 3. Manage the Memos Service

After creating the file, use `systemctl` to control the service.

### 3.1. Reload `systemd`

Make `systemd` aware of the new service file.

```bash
sudo systemctl daemon-reload
```

### 3.2. Enable and Start the Service

Enable the service to start on boot and start it immediately.

```bash
sudo systemctl enable memos
sudo systemctl start memos
```

### 3.3. Check the Status

You can check if the service is running correctly.

```bash
systemctl status memos
```

### 3.4. View Logs

To view the application logs, which are automatically captured by `systemd`, use `journalctl`.

```bash
# View a live stream of logs
journalctl -u memos -f

# View all logs for the service
journalctl -u memos
```

### 3.5. Stop or Restart the Service

To manually stop or restart the service:

```bash
# Stop the service
sudo systemctl stop memos

# Restart the service
sudo systemctl restart memos
```
