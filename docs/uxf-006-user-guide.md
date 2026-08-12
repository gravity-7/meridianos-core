# MeridianOS Dashboard UXF-006 User Guide

## Search and command palette

Choose **Search** in the application header or press `Ctrl+K` (`Cmd+K` on macOS). Enter at least one character to search authorized routes, tasks, retained runs, and provider labels. Use Up/Down to move through results, Enter to open a result, and Escape to close. The prior control regains focus after close.

Search is scoped to the current tenant/project and role. Empty, overlong, or unsafe input is rejected; normal navigation remains available if search is unavailable.

## Operations and realtime

The operations views show the selected scope and freshness state. If the SSE pilot is enabled, the shell reports reconnecting/degraded states and falls back to polling after repeated failures. Visibility changes pause the stream where appropriate; manual refresh remains available.

## Cloud management

Cloud administrators can preview a policy change, review eligible machines, and explicitly confirm it. A preview does not change machine state. The server, not the browser, decides organization and role scope.

## Keyboard and visual settings

Use visible focus outlines, skip links, and semantic status messages. The layout supports the master-plan viewport matrix and respects reduced-motion and forced-colors preferences. A legacy route remains a supported fallback during migration.
