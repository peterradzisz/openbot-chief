### Added

- Auto-approve for workflows: each card on the "All workflows" page has an "Auto-approve" switch, and
  an "Auto-approves" label shows while it is on. A run of such a workflow approves each approval step
  it reaches by itself, as Approve does, and the step says "Auto-approved by workflow setting." on the
  canvas. An approval that already waits when you turn it on still waits for you, and turning it off
  stops it. A paused workflow's open run still auto-approves.
- A "Runs in Reporting" setting on the "All workflows" page: Reporting reads the newest 50, 100, 250
  or 500 finished runs. It shows 100 at a time, with "Show more" for the rest.

### Changed

- The app now keeps the newest 500 finished workflow runs of the last 30 days for Reporting, up from
  300.
