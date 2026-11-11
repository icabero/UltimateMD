#!/usr/bin/env bash
# Makes apt on the CI's Ubuntu runners fetch Ubuntu over HTTPS, with short
# timeouts and retries. Plain HTTP to the Ubuntu mirrors, Azure's or Ubuntu's
# own, has stopped answering from the runners at times while HTTPS worked, and
# then every package waited 20 seconds until the job timed out.
set -euo pipefail
MIRROR=https://mirrors.edge.kernel.org/ubuntu/
# The runners read their mirror from a list, which names only Azure's.
if [ -f /etc/apt/apt-mirrors.txt ]; then
  echo "$MIRROR" | sudo tee /etc/apt/apt-mirrors.txt > /dev/null
fi
for list in /etc/apt/sources.list /etc/apt/sources.list.d/*.sources /etc/apt/sources.list.d/*.list; do
  [ -f "$list" ] && sudo sed -i -E "s#https?://(azure\.)?archive\.ubuntu\.com/ubuntu/?#${MIRROR}#g; s#http://security\.ubuntu\.com/ubuntu/?#${MIRROR}#g" "$list"
done
printf 'Acquire::Retries "3";\nAcquire::http::Timeout "15";\nAcquire::https::Timeout "15";\n' | sudo tee /etc/apt/apt.conf.d/80-ci-network > /dev/null
sudo apt-get update
