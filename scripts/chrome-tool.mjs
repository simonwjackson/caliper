#!/usr/bin/env -S nix develop -c node
import { installChromeTool } from "../src/build/tool.js"

installChromeTool()
