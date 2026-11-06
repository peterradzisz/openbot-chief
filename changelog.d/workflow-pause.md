### Added

- Pause and resume for workflows on the "All workflows" page: "Pause all" in the header holds every
  workflow at once, and each card has its own pause button and a "Paused" label. A paused workflow
  starts no run from a schedule, webhook, Discord, Telegram or Slack mention or GitHub event; a
  schedule occurrence that comes while it is paused is skipped, not saved for later. A run that is
  already open finishes as before, and Run still starts a run by hand.

### Changed

- After the update every existing workflow starts paused, so the app starts no scheduled run until
  you resume each workflow. New workflows start not paused.
