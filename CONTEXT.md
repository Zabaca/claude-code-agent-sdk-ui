# Claude Code Agent SDK UI

The layer between the Claude Agent SDK's message stream and a rendered Claude
Code interface.

## Language

**Frame**:
Something that happened agent-side — a token arriving, a tool starting, a Turn
ending. Nobody proposed it; it is an observation.
_Avoid_: Event (reserved below), update, chunk, delta

**Event**:
Something a person or the runtime proposed — send, interrupt, answer a
permission prompt. The counterpart to a Frame: a Frame is observed, an Event is
willed.
_Avoid_: Action, command, message

**Transcript**:
The ordered list of Messages a viewer sees.
_Avoid_: Timeline, feed, history, log

**Message**:
One entry in the Transcript — a person's words, a stretch of the agent's prose,
or a tool call.
_Avoid_: Bubble, entry, item, turn

**Session**:
One resumable conversation with the agent, identified by the SDK's `session_id`.
_Avoid_: Conversation, chat, thread

**Turn**:
One prompt-to-result cycle inside a Session.
_Avoid_: Exchange, round, request

**Thread**:
The line of work opened by a `Task` call, identified by that call's `tool_use`
id. Work done by a sub-agent belongs to a Thread; the agent's own work belongs
to none.
_Avoid_: Sub-agent, child, branch, subtask
