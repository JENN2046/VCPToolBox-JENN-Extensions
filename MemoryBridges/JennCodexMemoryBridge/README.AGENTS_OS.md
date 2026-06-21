# JennCodexMemoryBridge

Persistent no-live-write Codex/Memory bridge package skeleton.

This package is reviewed source/package content only. It validates manifest shape, relative package paths, redacted fixtures, and a dry-run adapter that returns zero write/read counters.

This package does not contain private memory content, live bridge credentials, vector stores, logs, DB sidecars, LocalState content, or `.agent_board/**`.

Runtime registration, live memory writes, private memory reads, and bridge external writes remain deferred.
