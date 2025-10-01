#!/usr/bin/env bash
set -e
if grep -Rnw --include=*.{ts,tsx} -e '\bitem\b' apps packages; then echo "Use 'OrderLine' not 'item'"; exit 1; else echo 'Naming OK'; fi