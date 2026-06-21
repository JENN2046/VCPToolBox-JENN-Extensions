# JennPhotoStudioPackage

Persistent no-auto-write PhotoStudio source package skeleton.

This package validates manifest shape, relative package paths, sanitized template source, redacted fixtures, and a dry-run adapter that returns zero project-data and external-write counters.

This package does not contain real PhotoStudio project data, media, exports, delivery queues, LocalState content, `.agent_board/**`, credentials, or provider configuration.

Runtime registration, project data reads/writes, external sync/publish, provider calls, and bridge calls remain deferred.
