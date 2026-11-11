#!/usr/bin/env bash
# Makes apt on the CI's Ubuntu runners use Ubuntu's own mirror, with short
# timeouts and retries. The Azure mirror they come with sometimes stops
# answering, and then every package waits 20 seconds until the job times out.
set -euo pipefail
for list in /etc/apt/sources.list /etc/apt/sources.list.d/*.sources /etc/apt/sources.list.d/*.list; do
  [ -f "$list" ] && sudo sed -i 's|http://azure.archive.ubuntu.com/ubuntu|http://archive.ubuntu.com/ubuntu|g' "$list"
done
printf 'Acquire::Retries "3";\nAcquire::http::Timeout "15";\nAcquire::https::Timeout "15";\n' | sudo tee /etc/apt/apt.conf.d/80-ci-network > /dev/null
sudo apt-get update
