# NixOS: tydig as its own account, at the commit its link page runs (just update).
#   imports = [ ./nixos.nix ];
{ pkgs, ... }: {
  users.users.tydig = {
    isNormalUser = true; home = "/var/lib/tydig"; createHome = true; homeMode = "700";
    linger = true; autoSubUidGidRange = true; shell = "/run/current-system/sw/bin/nologin";
  };
  virtualisation.podman.enable = true;
  environment.systemPackages = with pkgs; [ just git curl podman-compose ];
  systemd.services.tydig-update = {
    startAt = "hourly";
    wants = [ "network-online.target" ]; after = [ "network-online.target" ];
    path = [ "/run/wrappers" "/run/current-system/sw" ];
    serviceConfig = { Type = "oneshot"; User = "tydig"; WorkingDirectory = "/var/lib/tydig"; };
    environment.TYDIG_DATA = "/var/lib/tydig/data";
    script = ''
      export XDG_RUNTIME_DIR=/run/user/$(id -u)
      [ -d src/.git ] || { mv src/.env .env.old || :; rm -rf src  # an older tydig's copy
        git clone -q https://github.com/cab-ucf/tydig src; mv .env.old src/.env || :; } 2>/dev/null
      git -C src remote set-url origin https://github.com/cab-ucf/tydig  # no key needed
      just -f src/Justfile update
    '';
  };
}
