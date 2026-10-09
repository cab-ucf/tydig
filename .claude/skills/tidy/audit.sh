#!/bin/sh
# audit.sh PROJECT TEMPLATE [BRAND]: each file against tydig's template stack
set -e
T=$(cd "$(dirname "$0")/../../../server/templates" && pwd)
p=$1 t=$2 L=
case $t in nih*|nsf*) L=grant ;; esac
for l in $(ls "$T"); do case $t in "$l" | "$l"-*) L="$L $l" ;; esac; done
[ "$3" ] && L="$L brand-$3"
cd "$p"
for l in $L; do (cd "$T/$l" && find . -type f) done | sort -u |
while read -r f; do
  for l in $L; do [ -f "$T/$l/$f" ] && s=$T/$l/$f; done
  if [ ! -e "$f" ]; then echo "missing $f"
  elif cmp -s "$f" "$s"; then echo "same    $f"
  else echo "edited  $f"; fi
done
find . -type f ! -path './.git/*' ! -name .git ! -path './.collab/*' \
  ! -path './out/*' ! -path './build/*' ! -path './docs/*' | sort |
while read -r f; do
  for l in $L; do [ -e "$T/$l/$f" ] && continue 2; done
  case $f in
    *."$t" | *."$t".*) echo "beside  $f" ;;
    *) echo "own     $f" ;;
  esac
done
