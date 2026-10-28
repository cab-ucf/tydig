# NixOS: tydig as its own account, kept at the newest signed v* tag hourly.
#   imports = [ ./nixos.nix ];
#   services.tydig.allowedSigners = "ann@ucf.edu ssh-ed25519 AAAA...";
{ config, lib, pkgs, ... }:
let signers = pkgs.writeText "tydig-allowed-signers" config.services.tydig.allowedSigners; in {
  options.services.tydig.allowedSigners = lib.mkOption {
    type = lib.types.lines; default = "";
    description = "Who may sign a release tag, as git's gpg.ssh.allowedSignersFile.";
  };
  config = {
    users.users.tydig = {
      isNormalUser = true; home = "/var/lib/tydig"; createHome = true; homeMode = "700";
      linger = true; autoSubUidGidRange = true; shell = "/run/current-system/sw/bin/nologin";
    };
    virtualisation.podman.enable = true;
    environment.systemPackages = with pkgs; [ just git openssh podman-compose ];
    systemd.services.tydig-update = {
      startAt = "hourly";
      wants = [ "network-online.target" ]; after = [ "network-online.target" ];
      path = [ "/run/wrappers" "/run/current-system/sw" ];
      serviceConfig = { Type = "oneshot"; User = "tydig"; WorkingDirectory = "/var/lib/tydig"; };
      environment.TYDIG_DATA = "/var/lib/tydig/data";
      script = ''
        export XDG_RUNTIME_DIR=/run/user/$(id -u)
        [ -s ${signers} ] || { echo "tydig-update: nothing deployed until" \
          "services.tydig.allowedSigners names who signs releases"; exit 1; }
        [ -d src/.git ] || { mv src/.env .env.old || :; rm -rf src  # an older tydig's copy
          git clone -q https://github.com/cab-ucf/tydig src; mv .env.old src/.env || :; } 2>/dev/null
        cd src && git remote set-url origin https://github.com/cab-ucf/tydig  # no key needed
        git fetch -q --tags --force origin
        tag=$(git tag -l 'v*' --sort=-v:refname | head -1)
        [ -n "$tag" ] && git -c gpg.ssh.allowedSignersFile=${signers} verify-tag "$tag" ||
          { echo "tydig-update: ''${tag:-no v* tag} is not signed by an allowed signer"; exit 1; }
        [ "$(git rev-parse "$tag^{commit}")" = "$(cat .git/deployed 2>/dev/null)" ] ||
          { git checkout -q --detach "$tag" && just && git rev-parse HEAD > .git/deployed; }
      '';
    };
  };
}
