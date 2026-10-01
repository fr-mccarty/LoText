# Remote folders (Connect to Server)

Three bugs that kept Connect to Server from ever working, and how to test it without touching a
real server.

## `-o` values are config lines: quote paths

LoText's SSH files are under `~/Library/Application Support/LoText/ssh/`. Passed unquoted as
`-o ControlPath=…/Application Support/…`, ssh read the value like a config line, stopped at
the space, and failed every connection with *keyword controlpath extra arguments at end of
line*. `UserKnownHostsFile` takes several files separated by spaces, so there it failed
silently. Both are quoted now (`src/main/store/ssh-transport.js`). Check with
`ssh -G -o 'ControlPath="/a b/c"' host | grep controlpath`.

## Naming one key with `-i` drops ssh's default keys

ssh tries `~/.ssh/id_rsa`, `id_ecdsa`, `id_ed25519`, … only when no key is named at all.
Passing `-i` for LoText's own key shut the Mac's keys out, which is why a server Terminal could
reach refused LoText. The standard files that exist are now passed with `-i` ahead of LoText's
(`Keys.identityFiles()`). `ssh -G -i /tmp/x host | grep identityfile` shows the list.

## The save check compared "seconds|size" against "seconds"

The remote script's `write` took `${cur%|*}` (the shortest `|…` suffix removed, so still
`seconds|size`) and compared it with the seconds alone. Every save to a server was refused as
"changed on disk". It is `${now%%|*}` now, and the conflict answer prints the whole stamp so
the alert can carry it. `test/remote-store.test.js` runs the real script through `/bin/sh`.

## Testing against a throwaway sshd

`/usr/sbin/sshd` runs as an ordinary user, on a high port, with its own host key and
`authorized_keys`, and logs in only as that user:

```sh
D=$SCRATCH/sshd; mkdir -p $D/home; ssh-keygen -q -t ed25519 -N '' -f $D/hostkey
cat ~/.ssh/id_ed25519.pub > $D/authorized_keys          # plus the simulator's key line
cat > $D/sshd_config <<CONF
Port 2222
ListenAddress 127.0.0.1
HostKey $D/hostkey
PidFile $D/sshd.pid
AuthorizedKeysFile $D/authorized_keys
StrictModes no
UsePAM no
PasswordAuthentication no
CONF
/usr/sbin/sshd -f $D/sshd_config -E $D/sshd.log
```

The address is `ssh://$USER@127.0.0.1:2222$D/home`. The iOS simulator shares the Mac's network,
so the same address works from `scripts/ios-sim.sh eval`; its key is
`await window.lotext.publicKey()`. The Mac's transport writes the test host into
`~/.ssh/known_hosts`; `ssh-keygen -R '[127.0.0.1]:2222'` takes it out again.

The conflict and recovery questions are the model's own alerts, drawn by iOS; scripted
`ios-sim.sh answer` did not reach them in testing, so the conflict path was checked one level
down, through `lotext.writeText` with a stale stamp.
