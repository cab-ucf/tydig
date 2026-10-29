# NixOS: inputs.tydig.url = "github:cab-ucf/tydig"; then
# inputs.tydig.nixosModules.default among the system's modules (nixos.nix).
{ outputs = _: { nixosModules.default = ./nixos.nix; }; }
