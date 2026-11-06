### Changed

- Reporting on the "All workflows" page no longer re-reads its run list after every workflow event. It reads at
  most once per window that grows with the "Runs in Reporting" setting (3 s at 50 runs, 30 s at 500), and not while
  the window is hidden, so a long list no longer slows the app down. "Refresh" still reads at once.
