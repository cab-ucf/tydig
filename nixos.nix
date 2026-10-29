# NixOS: `imports = [ ./nixos.nix ];` and the hub is the tydig service, no
# checkout: it runs CI's images for the version its link page runs
# (cxn.pub/version) with the compose.yml inside them, as the tydig account
# (rootless podman: a build that escapes holds that account, not yours), and
# tydig-update moves it to a newer one hourly. All of it in /var/lib/tydig.
#   systemctl status tydig; journalctl -fu tydig; tydig link; tydig passwd
{ config, lib, pkgs, ... }:
let
  cfg = config.services.tydig;
  at = ''
    cd /var/lib/tydig; export PATH=/run/wrappers/bin:/run/current-system/sw/bin:$PATH
    export XDG_RUNTIME_DIR=/run/user/$(id -u) TYDIG_DATA=/var/lib/tydig/data
    export TYDIG_PODMAN_SOCK=/run/user/$(id -u)/podman/podman.sock
  '';
  # the image of the version the link page runs (offline: the last), pulled
  pull = pkgs.writeShellScript "tydig-pull" ''
    set -e; ${at}
    get() { sed -n "s/^$1=//p" .env 2>/dev/null | tail -1 | grep . || echo "$2"; }
    v=$(curl -fsS "$(get TYDIG_PAGE https://cxn.pub/)version") && [[ $v =~ ^[0-9a-f]{40}$ ]] && echo $v > version
    img=$(get TYDIG_REGISTRY ghcr.io/cab-ucf)/tydig:$(cat version)-$(get TYDIG_BRAND tydig)
    img=$img-$(podman info -f '{{.Host.Arch}}')
    podman image exists $img || podman pull -q $img >/dev/null
    echo $img
  '';
  tydig = pkgs.writeShellScriptBin "tydig" ''
    [ "$(id -un)" = tydig ] || exec /run/wrappers/bin/sudo -u tydig "$0" "$@"
    ${at}
    case $1 in
      link) cat data/link ;;
      passwd) podman exec "$(podman ps -q -f label=com.docker.compose.service=app)" \
        node server/passwd.mjs ''${2:+"$2"} ;;
      *) echo "tydig link | passwd [EMAIL]; systemctl status tydig; journalctl -fu tydig" >&2; exit 2 ;;
    esac
  '';
in {
  options.services.tydig = {
    settings = lib.mkOption {
      type = with lib.types; attrsOf str;
      default = { };
      example = { TYDIG_BRAND = "ucf"; TYDIG_BIND = "0.0.0.0"; };
      description = "The hub's .env (docs: Run).";
    };
    environmentFile = lib.mkOption {
      type = lib.types.str;
      default = "/var/lib/tydig/env";
      description = "More of it, out of the Nix store (secrets), if it exists; it wins.";
    };
  };
  config = {
    users.users.tydig = {
      isNormalUser = true; home = "/var/lib/tydig"; createHome = true; homeMode = "700";
      linger = true; autoSubUidGidRange = true; shell = "/run/current-system/sw/bin/nologin";
    };
    virtualisation.podman.enable = true;
    environment.systemPackages = [ tydig pkgs.curl pkgs.podman-compose ];
    systemd.services.tydig = {
      wantedBy = [ "multi-user.target" ];
      wants = [ "network-online.target" ]; after = [ "network-online.target" ];
      serviceConfig = {
        User = "tydig"; Restart = "always"; RestartSec = 10;
        ExecStartPre = "+" + pkgs.writeShellScript "tydig-env" ''
          cd /var/lib/tydig; umask 077
          [ -e ${cfg.environmentFile} ] || [ ! -e src/.env ] || cp src/.env ${cfg.environmentFile} # an older nixos.nix's
          cat ${pkgs.writeText "tydig.env" (lib.generators.toKeyValue { } cfg.settings)} > .env
          cat ${cfg.environmentFile} >> .env 2>/dev/null; chown tydig .env
        '';
      };
      script = ''
        ${at}
        [ -S $TYDIG_PODMAN_SOCK ] || { echo "no podman socket yet (tydig's user manager)"; exit 1; }
        mkdir -p data; img=$(${pull})
        podman pod rm -f pod_tydig >/dev/null 2>&1 || : # whatever ran before
        podman rm -f $(podman ps -aq -f label=com.docker.compose.project=tydig) >/dev/null 2>&1 || :
        podman images --format '{{.Repository}}:{{.Tag}}' | grep /tydig: | grep -vxF $img |
          xargs -r podman rmi >/dev/null 2>&1 || : # the versions it replaced
        podman run --rm $img cat compose.yml > compose.yml; echo $img > image
        TYDIG_HUB_IMAGE=$img exec podman-compose -f compose.yml up
      '';
      preStop = "${at} podman-compose -f compose.yml down";
    };
    systemd.services.tydig-update = {
      startAt = "hourly";
      path = [ pkgs.util-linux ];
      serviceConfig.Type = "oneshot";
      script = ''
        img=$(runuser -u tydig -- ${pull})
        [ "$img" = "$(cat /var/lib/tydig/image)" ] || systemctl restart tydig
      '';
    };
  };
}
