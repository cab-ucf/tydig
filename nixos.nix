# NixOS: tydig, kept at the latest commit. imports = [ ./nixos.nix ];
{ pkgs, ... }: {
  users.users.tydig = {
    isNormalUser = true; home = "/var/lib/tydig"; createHome = true;
    homeMode = "700"; linger = true; autoSubUidGidRange = true;
    shell = "/run/current-system/sw/bin/nologin";
  };
  virtualisation.podman.enable = true;
  environment.systemPackages = with pkgs; [ just git curl podman-compose ];

  # hourly, and only on a new commit: each deploy restarts the hub
  systemd.services.tydig-update = {
    startAt = "hourly";
    wants = [ "network-online.target" ];
    after = [ "network-online.target" ];
    path = [ "/run/wrappers" "/run/current-system/sw" ];
    serviceConfig = { Type = "oneshot"; StateDirectory = "tydig-git"; };
    script = ''
      cd /var/lib/tydig-git
      [ -d .git ] || git clone -q https://github.com/cab-ucf/tydig .
      git pull -q --ff-only
      h=$(git rev-parse HEAD)
      [ "$h" = "$(cat .git/deployed 2>/dev/null)" ] ||
        { just serve && echo "$h" > .git/deployed; }
    '';
  };
}
