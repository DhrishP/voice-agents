#!/bin/bash

# Navigate to the src directory
cd src

# Generate tree structure using tree command if available
if command -v tree &> /dev/null; then
    tree -I 'node_modules|dist|*.test.*|coverage' --dirsfirst -a
else
    # Fallback to find command if tree is not available
    find . -not \( -name node_modules -prune \) \
           -not \( -name dist -prune \) \
           -not \( -name "*.test.*" -prune \) \
           -not \( -name coverage -prune \) \
           -type d -o -type f | sed -e "s/[^-][^\/]*\// |--/g" -e "s/|\([^ ]\)/|-\1/"
fi
