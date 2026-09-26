{
  description = "Caliper: see a project's UI parts at true physical device size";

  inputs = {
    nixpkgs.url = "github:NixOS/nixpkgs/nixos-25.11";
    flake-utils.url = "github:numtide/flake-utils";
  };

  outputs = { nixpkgs, flake-utils, ... }:
    flake-utils.lib.eachDefaultSystem (system:
      let
        pkgs = import nixpkgs { inherit system; };
      in
      {
        devShells.default = pkgs.mkShell {
          packages = [
            pkgs.bun
            pkgs.nodejs_24
          ];
          # scripts/verify-browser.mjs drives this browser through playwright-core.
          CHROMIUM = "${pkgs.chromium}/bin/chromium";
        };
      });
}
