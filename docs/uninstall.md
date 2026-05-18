# Uninstalling pocket-t

One command (reverts everything `install.sh` did, idempotent):

```bash
curl -fsSL https://install.pocket-t.ai/uninstall | sh
# or from a checkout:
bash packages/daemon/scripts/uninstall.sh
```

It:

1. Boots out and removes the LaunchAgent
   (`~/Library/LaunchAgents/app.pocket-t.daemon.plist`).
2. Kills the **isolated** tmux server (`tmux -L pocket-t kill-server`) —
   your own tmux is untouched.
3. Strips the marker-bounded auto-attach snippet from `~/.zshrc` and
   `~/.bashrc`.
4. Removes `~/.pocket-t` (daemon config + the daemon-owned tmux.conf).
5. Offers to remove the binary (`sudo rm -f /usr/local/bin/pocket-t`).

Open a new terminal afterward for a clean shell. To also revoke the
Mac's access, delete the daemon from the web **Settings** screen (or it
will simply show offline).

## Manual removal

If you can't run the script:

```bash
launchctl bootout "gui/$(id -u)/app.pocket-t.daemon" 2>/dev/null
rm -f ~/Library/LaunchAgents/app.pocket-t.daemon.plist
tmux -L pocket-t kill-server 2>/dev/null
# delete the block between the "# ─── pocket-t: auto-attach" and
# "# ─── End pocket-t" markers in ~/.zshrc and ~/.bashrc
rm -rf ~/.pocket-t
sudo rm -f /usr/local/bin/pocket-t
```
