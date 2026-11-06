# Example workflow: Builder

The one example this repository ships. It is a plain graph in the workflow format of
`packages/contracts/src/ipc-workflows.ts`: a manual trigger, one agent that does the work, an approval
step, and a notification. Build the same four nodes on the canvas of a new workflow, or use the JSON as a
reference for the node `fields`.

```text
manual trigger ──▶ Builder agent ──▶ approval ──▶ notify
```

- Run it with **Run** on the card. It starts nothing by itself, so Pause has nothing to hold.
- Turn **Auto-approve** on the card on and the approval step passes at once, with a visible note
  ("Auto-approved by workflow setting."). Leave it off and the run waits for you.
- Bind the agent to a **model seat** (Settings → Agent seats) to get failover when a model is down.

`agentId` is a placeholder: pick your own agent in the node.

```json
{
  "nodes": [
    {
      "id": "trigger-1",
      "kind": "trigger",
      "at": { "x": 0, "y": 0 },
      "fields": { "trigger": "manual", "timezone": "UTC" }
    },
    {
      "id": "builder-1",
      "kind": "agent",
      "at": { "x": 320, "y": 0 },
      "fields": {
        "agentId": "REPLACE_WITH_YOUR_AGENT_ID",
        "task": "Take the task you are given, make the change in the working copy, run the checks and report what changed and what you could not verify."
      }
    },
    {
      "id": "approval-1",
      "kind": "approval",
      "at": { "x": 640, "y": 0 },
      "fields": { "question": "The change is ready. Approve it?" }
    },
    {
      "id": "output-1",
      "kind": "output",
      "at": { "x": 960, "y": 0 },
      "fields": { "target": "notify" }
    }
  ],
  "edges": [
    { "id": "e1", "from": "trigger-1", "to": "builder-1", "type": "text" },
    { "id": "e2", "from": "builder-1", "to": "approval-1", "type": "text" },
    { "id": "e3", "from": "approval-1", "to": "output-1", "type": "text" }
  ],
  "strokes": []
}
```
