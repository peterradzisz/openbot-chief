### Added

- Auto-approve now also answers an agent's question. When a workflow with Auto-approve on has an agent that asks
  the owner something, the app answers once with a standing rule ("you know what should be best for the project…
  if still unsure, write the problem in a CI comment and stop"). A second question in the same run gets a firm
  "no more questions, note the problem and stop"; a third is left to you. Questions that ask for a secret are never
  answered, and each answer is kept in the host's database.
