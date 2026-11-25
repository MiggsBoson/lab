#!/usr/bin/env bash
# Approve access requests for the lab: invite each requester as a collaborator (the
# most a personal repository allows: push to main, merge, manage issues, trigger the
# server deploy; not Settings), then thank them and close the request.
#
#   bash tools/approve-access.sh            # go through open requests, asking each time
#   bash tools/approve-access.sh USERNAME   # invite one person directly
#
# Requests are issues labelled "access-request" (see CONTRIBUTING.md).
set -euo pipefail
REPO="MiggsBoson/lab"

invite() {
  gh api -X PUT "repos/$REPO/collaborators/$1" >/dev/null
  echo "Invited $1. They accept with the commands at the end of CONTRIBUTING.md."
}

if [[ $# -ge 1 ]]; then invite "$1"; exit 0; fi

mapfile -t rows < <(gh issue list --repo "$REPO" --label access-request --state open \
  --json number,author,title --jq '.[] | "\(.number)\t\(.author.login)\t\(.title)"')
if [[ ${#rows[@]} -eq 0 ]]; then echo "No open access requests."; exit 0; fi

for row in "${rows[@]}"; do
  IFS=$'\t' read -r num user title <<<"$row"
  read -rp "#$num from $user ($title). Invite? [y/N] " ans </dev/tty
  if [[ $ans == [yY]* ]]; then
    invite "$user"
    gh issue close "$num" --repo "$REPO" --comment "Invite sent. Accept it with the commands at the end of CONTRIBUTING.md. Welcome in!" >/dev/null
  fi
done
