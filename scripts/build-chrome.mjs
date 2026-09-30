#!/usr/bin/env -S nix develop -c node
import { build } from "vite"
import config from "../chrome.config.js"

await build({ ...config, configFile: false })
