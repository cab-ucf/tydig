# NixOS: tydig as its own account, kept at the latest commit hourly.
#   imports = [ ./nixos.nix ];
{ pkgs, ... }: {
  users.users.tydig = {
    isNormalUser = true; home = "/var/lib/tydig"; createHome = true; homeMode = "700";
    linger = true; autoSubUidGidRange = true; shell = "/run/current-system/sw/bin/nologin";
  };
  virtualisation.podman.enable = true;
  environment.systemPackages = with pkgs; [ just git podman-compose ];
  systemd.services.tydig-update = {
    startAt = "hourly";
    wants = [ "network-online.target" ]; after = [ "network-online.target" ];
    path = [ "/run/wrappers" "/run/current-system/sw" ];
    serviceConfig = { Type = "oneshot"; User = "tydig"; WorkingDirectory = "/var/lib/tydig"; };
    environment.TYDIG_DATA = "/var/lib/tydig/data";
    script = ''
      export XDG_RUNTIME_DIR=/run/user/$(id -u)
      [ -d src/.git ] || { mv src/.env .env.old; rm -rf src  # an older tydig's copy
        git clone -q https://github.com/cab-ucf/tydig src; mv .env.old src/.env; } 2>/dev/null
      cd src && git pull -q --ff-only
      [ "$(git rev-parse HEAD)" = "$(cat .git/deployed 2>/dev/null)" ] ||
        { just && git rev-parse HEAD > .git/deployed; }
    '';
  };
}
